import type pg from 'pg';
import { many, one, pool, query, tx } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import type { PassageItem, QuestionItem, SetItem } from './importSchema.js';
import { normaliseStem, validateItems, type ExistingContent } from './validateImport.js';

export async function loadExisting(db: pg.Pool | pg.PoolClient = pool): Promise<ExistingContent> {
  const [topics, subs, passages, sets, questions] = await Promise.all([
    many('SELECT id, section_id FROM topics', [], db),
    many('SELECT id FROM subtopics', [], db),
    many('SELECT external_id FROM passages', [], db),
    many('SELECT external_id FROM dilr_sets', [], db),
    many('SELECT external_id, stem_md FROM questions', [], db),
  ]);
  return {
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
  const { search, ...rest } = q;
  await query(
    'INSERT INTO question_versions(question_id, version, snapshot, changed_by) VALUES ($1,$2,$3,$4) ON CONFLICT (question_id, version) DO NOTHING',
    [questionId, q.version, { question: rest, options, solution }, actorId],
    client,
  );
}

async function upsertPassage(c: pg.PoolClient, p: PassageItem) {
  const words = p.body.split(/\s+/).filter(Boolean).length;
  const r = await one(
    `INSERT INTO passages(external_id, title, domain, difficulty, body_md, central_argument, structure_md, purpose_tone, vocabulary_md, origin, exam_year, exam_slot, word_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (external_id) DO UPDATE SET title=EXCLUDED.title, domain=EXCLUDED.domain, difficulty=EXCLUDED.difficulty, body_md=EXCLUDED.body_md,
       central_argument=EXCLUDED.central_argument, structure_md=EXCLUDED.structure_md, purpose_tone=EXCLUDED.purpose_tone, vocabulary_md=EXCLUDED.vocabulary_md,
       origin=EXCLUDED.origin, exam_year=EXCLUDED.exam_year, exam_slot=EXCLUDED.exam_slot, word_count=EXCLUDED.word_count
     RETURNING id`,
    [p.externalId, p.title, p.domain, p.difficulty, p.body, p.centralArgument, p.structure, p.purposeTone, p.vocabulary, p.origin, p.examYear ?? null, p.examSlot ?? null, words],
    c,
  );
  return r!.id as string;
}

async function upsertSet(c: pg.PoolClient, s: SetItem) {
  const r = await one(
    `INSERT INTO dilr_sets(external_id, title, set_type, difficulty, body_md, structure_md, deductions_md, selection_md, origin, exam_year, exam_slot, estimated_time_sec)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (external_id) DO UPDATE SET title=EXCLUDED.title, set_type=EXCLUDED.set_type, difficulty=EXCLUDED.difficulty, body_md=EXCLUDED.body_md,
       structure_md=EXCLUDED.structure_md, deductions_md=EXCLUDED.deductions_md, selection_md=EXCLUDED.selection_md, origin=EXCLUDED.origin,
       exam_year=EXCLUDED.exam_year, exam_slot=EXCLUDED.exam_slot, estimated_time_sec=EXCLUDED.estimated_time_sec
     RETURNING id`,
    [s.externalId, s.title, s.setType, s.difficulty, s.body, s.structure, s.deductions, s.selection, s.origin, s.examYear ?? null, s.examSlot ?? null, s.estimatedTimeSec],
    c,
  );
  return r!.id as string;
}

async function upsertQuestion(c: pg.PoolClient, q: QuestionItem, opts: { publish: boolean; actorId: string | null }) {
  const passageId = q.passage ? (await one('SELECT id FROM passages WHERE external_id = $1', [q.passage], c))?.id : null;
  const setId = q.set ? (await one('SELECT id FROM dilr_sets WHERE external_id = $1', [q.set], c))?.id : null;
  const isPyq = q.origin === 'authentic_pyq';
  const sourceVerification = isPyq ? (q.sourceVerified ? 'verified' : 'unverified') : 'not_applicable';
  const solutionVerification = q.solutionVerified ? 'verified' : 'unverified';
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
         source_verification=$19, solution_verification=$20, status = CASE WHEN $21 THEN 'published' ELSE status END, version = version + 1, updated_at = now()
       WHERE id = $1`,
      [id, q.section, q.topic, q.subtopic ?? null, passageId, setId, q.position ?? null, q.type, q.difficulty, q.stem, q.answer.trim(), q.tolerance ?? 0, q.estimatedTimeSec, q.origin,
       q.examYear ?? null, q.examSlot ?? null, marksCorrect, marksWrong, sourceVerification, solutionVerification, opts.publish],
      c,
    );
    await query('DELETE FROM question_options WHERE question_id = $1', [id], c);
    await query('DELETE FROM question_tags WHERE question_id = $1', [id], c);
  } else {
    const r = await one(
      `INSERT INTO questions(external_id, section_id, topic_id, subtopic_id, passage_id, dilr_set_id, position_in_group, question_type, difficulty, stem_md, correct_answer,
         answer_tolerance, estimated_time_sec, origin, exam_year, exam_slot, marks_correct, marks_wrong, source_verification, solution_verification, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
      [q.externalId, q.section, q.topic, q.subtopic ?? null, passageId, setId, q.position ?? null, q.type, q.difficulty, q.stem, q.answer.trim(), q.tolerance ?? 0, q.estimatedTimeSec,
       q.origin, q.examYear ?? null, q.examSlot ?? null, marksCorrect, marksWrong, sourceVerification, solutionVerification, opts.publish ? 'published' : 'draft'],
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
  await query('DELETE FROM question_sources WHERE question_id = $1', [id], c);
  for (const src of q.sources ?? []) {
    await query(
      'INSERT INTO question_sources(question_id, source_name, reference, url, license_note, verified_by, verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, src.name, src.reference, src.url ?? null, src.license, q.sourceVerified ? opts.actorId : null, q.sourceVerified ? new Date() : null],
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
}

/** Validates then (unless dryRun) writes all valid items in one transaction and records an import job. */
export async function runImport(rawItems: unknown[], opts: ImportOptions) {
  const existing = await loadExisting();
  const { issues, valid } = validateItems(rawItems, existing);
  const rejectedIdx = new Set(issues.filter((i) => i.severity === 'error').map((i) => i.index));
  let status: 'validated' | 'imported' | 'failed' = 'validated';
  if (!opts.dryRun && valid.length) {
    try {
      await tx(async (c) => {
        for (const { item } of valid) if (item.kind === 'passage') await upsertPassage(c, item);
        for (const { item } of valid) if (item.kind === 'dilr_set') await upsertSet(c, item);
        for (const { item } of valid) if (item.kind === 'question') await upsertQuestion(c, item, { publish: !!opts.publish, actorId: opts.actorId });
      });
      status = 'imported';
    } catch (e) {
      status = 'failed';
      issues.push({ index: -1, severity: 'error', code: 'database', message: (e as Error).message });
    }
  }
  const job = await one(
    `INSERT INTO content_import_jobs(created_by, filename, status, dry_run, total, accepted, rejected, report)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [opts.actorId, opts.filename ?? '', status, !!opts.dryRun, rawItems.length, status === 'failed' ? 0 : valid.length, rejectedIdx.size, JSON.stringify(issues)],
  );
  if (!opts.dryRun) await audit(opts.actorId, 'content.import', 'import_job', job!.id, { total: rawItems.length, accepted: valid.length, status });
  return job!;
}
