import type pg from 'pg';
import { many, one, pool, query, tx } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { HISTORICAL_ORIGINS, type PassageItem, type QuestionItem, type SetItem } from './importSchema.js';
import type { ImportFormat } from './importFormats.js';
import { normaliseStem, pyqKey, shingles, validateItems, type ExistingContent, type Issue } from './validateImport.js';

export async function loadExisting(db: pg.Pool | pg.PoolClient = pool): Promise<ExistingContent> {
  const [topics, subs, passages, sets, questions] = await Promise.all([
    many('SELECT id, section_id FROM topics', [], db),
    many('SELECT id FROM subtopics', [], db),
    many('SELECT external_id, origin, exam_year, exam_slot FROM passages', [], db),
    many('SELECT external_id, origin, exam_year, exam_slot FROM dilr_sets', [], db),
    many('SELECT external_id, stem_md, origin, exam_year, exam_slot, section_id, question_number FROM questions', [], db),
  ]);
  const groupMeta = new Map<string, { origin: string; examYear: number | null; examSlot: number | null }>();
  for (const g of [...passages, ...sets]) groupMeta.set(g.external_id, { origin: g.origin, examYear: g.exam_year, examSlot: g.exam_slot });
  return {
    pyqNumbers: new Map(
      questions
        .filter((q) => q.origin === 'authentic_pyq' && q.question_number && q.exam_year)
        .map((q) => [pyqKey(q.exam_year, q.exam_slot, q.section_id, q.question_number), q.external_id]),
    ),
    stemShingles: new Map(questions.map((q) => [q.external_id, shingles(q.stem_md)])),
    groupMeta,
    topicIds: new Set(topics.map((t) => t.id)),
    topicSection: new Map(topics.map((t) => [t.id, t.section_id])),
    subtopicIds: new Set(subs.map((s) => s.id)),
    passageIds: new Set(passages.map((p) => p.external_id)),
    setIds: new Set(sets.map((s) => s.external_id)),
    questionIds: new Set(questions.map((q) => q.external_id)),
    stemHashes: new Map(questions.map((q) => [normaliseStem(q.stem_md), q.external_id])),
  };
}

export async function snapshotQuestion(client: pg.PoolClient | pg.Pool, questionId: string, actorId: string | null) {
  const q = await one('SELECT * FROM questions WHERE id = $1', [questionId], client);
  if (!q) return;
  const options = await many('SELECT key, text_md FROM question_options WHERE question_id = $1 ORDER BY key', [questionId], client);
  const solution = await one('SELECT * FROM question_solutions WHERE question_id = $1', [questionId], client);
  const sources = await many('SELECT * FROM question_sources WHERE question_id = $1 ORDER BY created_at', [questionId], client);
  const { search, ...rest } = q;
  await query(
    'INSERT INTO question_versions(question_id, version, snapshot, changed_by) VALUES ($1,$2,$3,$4) ON CONFLICT (question_id, version) DO NOTHING',
    [questionId, q.version, { question: rest, options, solution, sources }, actorId],
    client,
  );
}

const groupVerification = (origin: string) => (HISTORICAL_ORIGINS.has(origin) ? 'unverified' : 'not_applicable');

/** Stores the previous state of a passage or set before it changes. */
async function snapshotGroup(c: pg.PoolClient, type: 'passage' | 'dilr_set', row: any, actorId: string | null) {
  await query('INSERT INTO group_versions(group_type, group_id, snapshot, changed_by) VALUES ($1,$2,$3,$4)', [type, row.id, row, actorId], c);
}

/** True when a re-import changes what a passage or set says or where it is said to come from. */
const groupChanged = (prev: any, g: PassageItem | SetItem) =>
  prev.body_md !== g.body ||
  prev.title !== g.title ||
  prev.origin !== g.origin ||
  prev.exam_year !== (g.examYear ?? null) ||
  prev.exam_slot !== (g.examSlot ?? null) ||
  prev.source_name !== (g.source?.name ?? '') ||
  prev.source_reference !== (g.source?.reference ?? '');

/** A changed PYQ passage or set sends its questions back to review: learners must not see unreviewed text. */
async function requeueGroupQuestions(c: pg.PoolClient, column: 'passage_id' | 'dilr_set_id', groupId: string, actorId: string | null) {
  const qs = await many(`SELECT id FROM questions WHERE ${column} = $1 AND origin = 'authentic_pyq' AND review_status <> 'pending'`, [groupId], c);
  for (const q of qs) {
    await snapshotQuestion(c, q.id, actorId);
    await query(
      `UPDATE questions SET review_status = 'pending', source_verification = 'unverified', answer_key_verification = 'unverified',
         status = CASE WHEN status = 'published' THEN 'unpublished' ELSE status END, version = version + 1, updated_at = now() WHERE id = $1`,
      [q.id],
      c,
    );
    await audit(actorId, 'question.review_required', 'question', q.id, { reason: 'its passage or set changed in an import' }, c);
  }
}

async function upsertPassage(c: pg.PoolClient, p: PassageItem, actorId: string | null) {
  const words = p.body.split(/\s+/).filter(Boolean).length;
  const prev = await one('SELECT * FROM passages WHERE external_id = $1', [p.externalId], c);
  if (prev) await snapshotGroup(c, 'passage', prev, actorId);
  const r = await one(
    `INSERT INTO passages(external_id, title, domain, difficulty, body_md, central_argument, structure_md, purpose_tone, vocabulary_md, origin, exam_year, exam_slot, word_count,
                          source_name, source_reference, source_url, source_verification)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (external_id) DO UPDATE SET title=EXCLUDED.title, domain=EXCLUDED.domain, difficulty=EXCLUDED.difficulty, body_md=EXCLUDED.body_md,
       central_argument=EXCLUDED.central_argument, structure_md=EXCLUDED.structure_md, purpose_tone=EXCLUDED.purpose_tone, vocabulary_md=EXCLUDED.vocabulary_md,
       origin=EXCLUDED.origin, exam_year=EXCLUDED.exam_year, exam_slot=EXCLUDED.exam_slot, word_count=EXCLUDED.word_count,
       source_name=EXCLUDED.source_name, source_reference=EXCLUDED.source_reference, source_url=EXCLUDED.source_url,
       source_verification = CASE WHEN passages.body_md = EXCLUDED.body_md AND passages.title = EXCLUDED.title AND passages.origin = EXCLUDED.origin
                                   AND passages.exam_year IS NOT DISTINCT FROM EXCLUDED.exam_year AND passages.exam_slot IS NOT DISTINCT FROM EXCLUDED.exam_slot
                                   AND passages.source_name = EXCLUDED.source_name AND passages.source_reference = EXCLUDED.source_reference
                                  THEN passages.source_verification ELSE EXCLUDED.source_verification END,
       updated_at = now()
     RETURNING id, source_verification`,
    [p.externalId, p.title, p.domain, p.difficulty, p.body, p.centralArgument, p.structure, p.purposeTone, p.vocabulary, p.origin, p.examYear ?? null, p.examSlot ?? null, words,
     p.source?.name ?? '', p.source?.reference ?? '', p.source?.url ?? null, groupVerification(p.origin)],
    c,
  );
  if (prev && groupChanged(prev, p)) await requeueGroupQuestions(c, 'passage_id', r!.id, actorId);
  return r!.id as string;
}

async function upsertSet(c: pg.PoolClient, s: SetItem, actorId: string | null) {
  const prev = await one('SELECT * FROM dilr_sets WHERE external_id = $1', [s.externalId], c);
  if (prev) await snapshotGroup(c, 'dilr_set', prev, actorId);
  const r = await one(
    `INSERT INTO dilr_sets(external_id, title, set_type, difficulty, body_md, structure_md, deductions_md, selection_md, origin, exam_year, exam_slot, estimated_time_sec,
                           source_name, source_reference, source_url, source_verification)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (external_id) DO UPDATE SET title=EXCLUDED.title, set_type=EXCLUDED.set_type, difficulty=EXCLUDED.difficulty, body_md=EXCLUDED.body_md,
       structure_md=EXCLUDED.structure_md, deductions_md=EXCLUDED.deductions_md, selection_md=EXCLUDED.selection_md, origin=EXCLUDED.origin,
       exam_year=EXCLUDED.exam_year, exam_slot=EXCLUDED.exam_slot, estimated_time_sec=EXCLUDED.estimated_time_sec,
       source_name=EXCLUDED.source_name, source_reference=EXCLUDED.source_reference, source_url=EXCLUDED.source_url,
       source_verification = CASE WHEN dilr_sets.body_md = EXCLUDED.body_md AND dilr_sets.title = EXCLUDED.title AND dilr_sets.origin = EXCLUDED.origin
                                   AND dilr_sets.exam_year IS NOT DISTINCT FROM EXCLUDED.exam_year AND dilr_sets.exam_slot IS NOT DISTINCT FROM EXCLUDED.exam_slot
                                   AND dilr_sets.source_name = EXCLUDED.source_name AND dilr_sets.source_reference = EXCLUDED.source_reference
                                  THEN dilr_sets.source_verification ELSE EXCLUDED.source_verification END,
       updated_at = now()
     RETURNING id`,
    [s.externalId, s.title, s.setType, s.difficulty, s.body, s.structure, s.deductions, s.selection, s.origin, s.examYear ?? null, s.examSlot ?? null, s.estimatedTimeSec,
     s.source?.name ?? '', s.source?.reference ?? '', s.source?.url ?? null, groupVerification(s.origin)],
    c,
  );
  if (prev && groupChanged(prev, s)) await requeueGroupQuestions(c, 'dilr_set_id', r!.id, actorId);
  return r!.id as string;
}

async function upsertQuestion(c: pg.PoolClient, q: QuestionItem, opts: { publish: boolean; actorId: string | null; jobId: string }) {
  const passageId = q.passage ? (await one('SELECT id FROM passages WHERE external_id = $1', [q.passage], c))?.id : null;
  const setId = q.set ? (await one('SELECT id FROM dilr_sets WHERE external_id = $1', [q.set], c))?.id : null;
  const isPyq = q.origin === 'authentic_pyq';
  // Authentic PYQs always enter the review queue unverified and unpublished, whatever the file says.
  const sourceVerification = isPyq ? 'unverified' : HISTORICAL_ORIGINS.has(q.origin) ? 'unverified' : 'not_applicable';
  const answerKeyVerification = isPyq ? 'unverified' : 'not_applicable';
  const solutionVerification = !isPyq && q.solutionVerified ? 'verified' : 'unverified';
  const reviewStatus = isPyq ? 'pending' : 'not_required';
  const publish = opts.publish && !isPyq;
  const marksCorrect = q.marksCorrect ?? 3;
  const marksWrong = q.marksWrong ?? (q.type === 'MCQ' ? -1 : 0);
  const existing = await one('SELECT id FROM questions WHERE external_id = $1', [q.externalId], c);
  let id: string;
  if (existing) {
    await snapshotQuestion(c, existing.id, opts.actorId);
    id = existing.id;
    await query(
      `UPDATE questions SET section_id=$2, topic_id=$3, subtopic_id=$4, passage_id=$5, dilr_set_id=$6, position_in_group=$7, question_type=$8, difficulty=$9,
         stem_md=$10, correct_answer=$11, answer_tolerance=$12, estimated_time_sec=$13, origin=$14, exam_year=$15, exam_slot=$16, marks_correct=$17, marks_wrong=$18,
         source_verification=$19, solution_verification=$20,
         status = CASE WHEN $21 THEN 'published' WHEN $24 AND status = 'published' THEN 'unpublished' ELSE status END,
         question_number=$22, answer_key_verification=$23, review_status=$25, reviewed_by = NULL, reviewed_at = NULL, import_job_id=$26,
         version = version + 1, updated_at = now()
       WHERE id = $1`,
      [id, q.section, q.topic, q.subtopic ?? null, passageId, setId, q.position ?? null, q.type, q.difficulty, q.stem, q.answer.trim(), q.tolerance ?? 0, q.estimatedTimeSec, q.origin,
       q.examYear ?? null, q.examSlot ?? null, marksCorrect, marksWrong, sourceVerification, solutionVerification, publish, q.questionNumber ?? null, answerKeyVerification,
       isPyq, reviewStatus, opts.jobId],
      c,
    );
    await query('DELETE FROM question_options WHERE question_id = $1', [id], c);
    await query('DELETE FROM question_tags WHERE question_id = $1', [id], c);
  } else {
    const r = await one(
      `INSERT INTO questions(external_id, section_id, topic_id, subtopic_id, passage_id, dilr_set_id, position_in_group, question_type, difficulty, stem_md, correct_answer,
         answer_tolerance, estimated_time_sec, origin, exam_year, exam_slot, marks_correct, marks_wrong, source_verification, solution_verification, status,
         question_number, answer_key_verification, review_status, import_job_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`,
      [q.externalId, q.section, q.topic, q.subtopic ?? null, passageId, setId, q.position ?? null, q.type, q.difficulty, q.stem, q.answer.trim(), q.tolerance ?? 0, q.estimatedTimeSec,
       q.origin, q.examYear ?? null, q.examSlot ?? null, marksCorrect, marksWrong, sourceVerification, solutionVerification, publish ? 'published' : 'draft',
       q.questionNumber ?? null, answerKeyVerification, reviewStatus, opts.jobId],
      c,
    );
    id = r!.id;
  }
  for (const [key, text] of Object.entries(q.options ?? {})) {
    await query('INSERT INTO question_options(question_id, key, text_md) VALUES ($1,$2,$3)', [id, key, text], c);
  }
  if (q.solution) {
    const s = q.solution;
    await query(
      `INSERT INTO question_solutions(question_id, concepts_tested, prerequisites, learn_md, exam_method_md, hints, verification_md, common_mistakes_md, distractors, alternative_md, advanced_md)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (question_id) DO UPDATE SET concepts_tested=EXCLUDED.concepts_tested, prerequisites=EXCLUDED.prerequisites, learn_md=EXCLUDED.learn_md,
         exam_method_md=EXCLUDED.exam_method_md, hints=EXCLUDED.hints, verification_md=EXCLUDED.verification_md, common_mistakes_md=EXCLUDED.common_mistakes_md,
         distractors=EXCLUDED.distractors, alternative_md=EXCLUDED.alternative_md, advanced_md=EXCLUDED.advanced_md, updated_at=now()`,
      [id, s.conceptsTested, s.prerequisites, s.learn, s.examMethod, s.hints, s.verification, s.commonMistakes, s.distractors, s.alternative ?? '', s.advanced ?? ''],
      c,
    );
  }
  // Sources are replaced by the file's; the previous ones are kept in the version snapshot.
  await query('DELETE FROM question_sources WHERE question_id = $1', [id], c);
  const verifiedNow = !isPyq && q.sourceVerified;
  for (const src of q.sources ?? []) {
    await query(
      'INSERT INTO question_sources(question_id, source_name, reference, url, license_note, kind, accessed_on, verified_by, verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, src.name, src.reference, src.url ?? null, src.license, src.kind, src.accessedOn ?? null, verifiedNow ? opts.actorId : null, verifiedNow ? new Date() : null],
      c,
    );
  }
  if (q.answerKey) {
    await query(
      "INSERT INTO question_sources(question_id, source_name, reference, url, kind, recorded_answer, accessed_on) VALUES ($1,$2,$3,$4,'answer_key',$5,$6)",
      [id, q.answerKey.name, q.answerKey.reference, q.answerKey.url ?? null, q.answerKey.answer.trim(), q.answerKey.accessedOn ?? null],
      c,
    );
  }
  for (const tag of q.tags ?? []) {
    const t = await one('INSERT INTO tags(name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [tag], c);
    await query('INSERT INTO question_tags(question_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, t!.id], c);
  }
  return id;
}

export interface ImportOptions {
  dryRun?: boolean;
  publish?: boolean;
  actorId: string | null;
  filename?: string;
  format?: ImportFormat;
  fileSha256?: string;
  /** Source line per item, from the file parser. */
  lines?: number[];
  /** Problems found while parsing the file, before validation. */
  parseIssues?: Issue[];
}

/** Validates then (unless dryRun) writes all valid items in one transaction and records an import job. */
export async function runImport(rawItems: unknown[], opts: ImportOptions) {
  const existing = await loadExisting();
  const { issues, valid } = validateItems(rawItems, existing);
  for (const i of issues) {
    const line = opts.lines?.[i.index];
    if (line) i.line = line;
  }
  issues.unshift(...(opts.parseIssues ?? []));
  const rejectedIdx = new Set(issues.filter((i) => i.severity === 'error' && i.index >= 0).map((i) => i.index));
  const job = await one(
    `INSERT INTO content_import_jobs(created_by, filename, status, dry_run, total, accepted, rejected, report, format, file_sha256)
     VALUES ($1,$2,'validated',$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [opts.actorId, opts.filename ?? '', !!opts.dryRun, rawItems.length, valid.length, rejectedIdx.size, JSON.stringify(issues), opts.format ?? 'json', opts.fileSha256 ?? null],
  );
  if (!opts.dryRun && valid.length) {
    let status: 'imported' | 'failed' = 'imported';
    try {
      await tx(async (c) => {
        for (const { item } of valid) if (item.kind === 'passage') await upsertPassage(c, item, opts.actorId);
        for (const { item } of valid) if (item.kind === 'dilr_set') await upsertSet(c, item, opts.actorId);
        for (const { item } of valid) if (item.kind === 'question') await upsertQuestion(c, item, { publish: !!opts.publish, actorId: opts.actorId, jobId: job!.id });
      });
    } catch (e) {
      status = 'failed';
      issues.push({ index: -1, severity: 'error', code: 'database', message: (e as Error).message });
    }
    await query('UPDATE content_import_jobs SET status = $2, accepted = $3, report = $4 WHERE id = $1', [job!.id, status, status === 'failed' ? 0 : valid.length, JSON.stringify(issues)]);
    await audit(opts.actorId, 'content.import', 'import_job', job!.id, { total: rawItems.length, accepted: valid.length, status, format: opts.format ?? 'json', fileSha256: opts.fileSha256 ?? null });
  }
  return (await one('SELECT * FROM content_import_jobs WHERE id = $1', [job!.id]))!;
}
