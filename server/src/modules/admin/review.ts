/**
 * Admin review of authentic-PYQ submissions. Nothing enters the verified collection until an
 * admin approves it here, after the automated checks pass and they confirm they compared the
 * question, answer key and solution with the cited sources.
 */
import type pg from 'pg';
import { many, one, pool, query, tx } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { snapshotQuestion } from './importer.js';
import { answerMatchesKey, normaliseStem } from './validateImport.js';

export interface Check {
  code: string;
  ok: boolean;
  /** Warnings are shown but do not block approval. */
  blocking: boolean;
  message: string;
}

type Db = pg.Pool | pg.PoolClient;

/** Automated pre-publication checks for one question. */
export async function questionChecks(questionId: string, db: Db = pool): Promise<Check[]> {
  const q = await one('SELECT * FROM questions WHERE id = $1', [questionId], db);
  if (!q) throw notFound('Question');
  // Sequential: inside a transaction these share one client, which runs one query at a time.
  const options = await many('SELECT key FROM question_options WHERE question_id = $1', [questionId], db);
  const solution = await one('SELECT * FROM question_solutions WHERE question_id = $1', [questionId], db);
  const sources = await many('SELECT * FROM question_sources WHERE question_id = $1', [questionId], db);
  const checks: Check[] = [];
  const add = (code: string, ok: boolean, message: string, blocking = true) => checks.push({ code, ok, blocking, message });

  const paper = sources.filter((s) => s.kind === 'question_paper');
  add('paper_source', paper.length > 0 && paper.every((s) => s.reference.trim()), paper.length ? `Paper source: ${paper.map((s) => `${s.source_name} (${s.reference || 'no reference'})`).join('; ')}` : 'No question-paper source recorded');
  const key = sources.find((s) => s.kind === 'answer_key');
  add('answer_key_source', !!key?.reference && !!key?.recorded_answer, key ? `Answer key: ${key.source_name} (${key.reference}) gives '${key.recorded_answer ?? '?'}'` : 'No answer-key source recorded');
  if (key?.recorded_answer) {
    const match = answerMatchesKey(q.question_type, q.correct_answer, key.recorded_answer, Number(q.answer_tolerance));
    add('answer_matches_key', match, match ? `Stored answer '${q.correct_answer}' matches the answer key` : `Stored answer '${q.correct_answer}' does not match the answer key ('${key.recorded_answer}')`);
  }
  if (q.question_type === 'MCQ') {
    const keys = options.map((o) => o.key);
    add('answer_valid', keys.length >= 2 && keys.includes(q.correct_answer), keys.includes(q.correct_answer) ? 'Answer is one of the options' : `Answer '${q.correct_answer}' is not one of the options`);
  } else {
    add('answer_valid', options.length === 0 && /^-?\d+(\.\d+)?$|^[A-Za-z0-9]+$/.test(q.correct_answer.trim()), 'TITA answer is a number or short code with no options');
  }
  const missingDistractors =
    q.question_type === 'MCQ' && solution ? options.map((o) => o.key).filter((k) => k !== q.correct_answer && !solution.distractors?.[k]) : [];
  add(
    'solution_complete',
    !!solution?.learn_md?.trim() && !!solution?.verification_md?.trim() && missingDistractors.length === 0,
    !solution?.learn_md?.trim()
      ? 'No step-by-step solution'
      : !solution.verification_md?.trim()
        ? 'Solution has no final-answer verification step'
        : missingDistractors.length
          ? `No explanation for wrong option(s) ${missingDistractors.join(', ')}`
          : 'Solution has steps, a verification step and explanations for every wrong option',
  );
  add('paper_fields', !!q.exam_year && !!q.question_number, q.exam_year && q.question_number ? `CAT ${q.exam_year}${q.exam_slot ? ` slot ${q.exam_slot}` : ''}, ${q.section_id} question ${q.question_number}` : 'Exam year or question number missing');
  if (!q.exam_slot) add('slot_recorded', false, 'No slot recorded. Fine only if the paper had a single slot.', false);

  const dup = await one(
    `SELECT external_id FROM questions WHERE id <> $1 AND btrim(regexp_replace(lower(stem_md), '[^a-z0-9]+', ' ', 'g')) = $2 LIMIT 1`,
    [questionId, normaliseStem(q.stem_md)],
    db,
  );
  add('not_duplicate', !dup, dup ? `Same text as ${dup.external_id}` : 'No other question has the same text');

  if (q.passage_id || q.dilr_set_id) {
    const table = q.passage_id ? 'passages' : 'dilr_sets';
    const g = await one(`SELECT external_id, origin, exam_year, exam_slot, source_reference FROM ${table} WHERE id = $1`, [q.passage_id ?? q.dilr_set_id], db);
    const ok = !!g && g.origin === 'authentic_pyq' && g.exam_year === q.exam_year && g.exam_slot === q.exam_slot && !!g.source_reference?.trim();
    add('group_ready', ok, ok ? `${q.passage_id ? 'Passage' : 'DILR set'} ${g!.external_id} is from the same paper and has a source` : `${q.passage_id ? 'Passage' : 'DILR set'} must be an authentic PYQ from the same paper with a source reference`);
  }
  return checks;
}

const blockers = (checks: Check[]) => checks.filter((c) => c.blocking && !c.ok);

export interface Confirmation {
  paperSource: boolean;
  answerKey: boolean;
  solution: boolean;
}

function requireConfirmation(c: Confirmation) {
  if (!c.paperSource || !c.answerKey || !c.solution) {
    throw badRequest('Confirm that you compared the question with the paper, the answer with the answer key, and checked the solution');
  }
}

async function approveOne(c: pg.PoolClient, q: any, actor: string, note: string, publish: boolean) {
  await snapshotQuestion(c, q.id, actor);
  await query(
    `UPDATE questions SET source_verification = 'verified', answer_key_verification = 'verified', solution_verification = 'verified',
       review_status = 'approved', reviewed_by = $2, reviewed_at = now(), review_note = $3,
       status = CASE WHEN $4 THEN 'published' ELSE status END, version = version + 1, updated_at = now()
     WHERE id = $1`,
    [q.id, actor, note, publish],
    c,
  );
  await query('UPDATE question_sources SET verified_by = $2, verified_at = now() WHERE question_id = $1', [q.id, actor], c);
  await audit(actor, 'question.review_approved', 'question', q.id, { note, publish, external_id: q.external_id }, c);
}

/** Approves a standalone question. Questions in a passage or set are approved with their group. */
export async function approveQuestion(questionId: string, actor: string, body: { confirm: Confirmation; note: string; publish: boolean }) {
  requireConfirmation(body.confirm);
  return tx(async (c) => {
    const q = await one('SELECT * FROM questions WHERE id = $1 FOR UPDATE', [questionId], c);
    if (!q) throw notFound('Question');
    if (q.origin !== 'authentic_pyq') throw badRequest('Only questions labelled as authentic CAT PYQs go through review');
    if (q.review_status !== 'pending') throw conflict(`This question is ${q.review_status}, not pending review`);
    if (q.passage_id || q.dilr_set_id) throw badRequest('This question belongs to a passage or DILR set. Approve the whole group.');
    const failed = blockers(await questionChecks(questionId, c));
    if (failed.length) throw badRequest(`Cannot approve: ${failed.map((f) => f.message).join('; ')}`);
    await approveOne(c, q, actor, body.note, body.publish);
    return one('SELECT id, status, review_status, source_verification, answer_key_verification, solution_verification FROM questions WHERE id = $1', [questionId], c);
  });
}

const groupTable = (kind: 'passage' | 'dilr_set') => (kind === 'passage' ? { table: 'passages', column: 'passage_id' } : { table: 'dilr_sets', column: 'dilr_set_id' });

/** Approves a passage or DILR set together with all its pending questions, or nothing. */
export async function approveGroup(kind: 'passage' | 'dilr_set', groupId: string, actor: string, body: { confirm: Confirmation; note: string; publish: boolean }) {
  requireConfirmation(body.confirm);
  const { table, column } = groupTable(kind);
  return tx(async (c) => {
    const g = await one(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [groupId], c);
    if (!g) throw notFound(kind === 'passage' ? 'Passage' : 'DILR set');
    if (g.origin !== 'authentic_pyq') throw badRequest('Only passages and sets labelled as authentic CAT PYQs go through review');
    if (!g.source_reference?.trim()) throw badRequest('Add a source reference for the passage or set before approving');
    const qs = await many(`SELECT * FROM questions WHERE ${column} = $1 FOR UPDATE`, [groupId], c);
    const pending = qs.filter((q) => q.review_status === 'pending');
    if (!pending.length) throw conflict('Nothing in this group is pending review');
    const problems: string[] = [];
    for (const q of pending) for (const f of blockers(await questionChecks(q.id, c))) problems.push(`${q.external_id}: ${f.message}`);
    if (problems.length) throw badRequest(`Cannot approve: ${problems.join('; ')}`);
    await query(`INSERT INTO group_versions(group_type, group_id, snapshot, changed_by) VALUES ($1,$2,$3,$4)`, [kind, groupId, g, actor], c);
    await query(`UPDATE ${table} SET source_verification = 'verified', updated_at = now() WHERE id = $1`, [groupId], c);
    for (const q of pending) await approveOne(c, q, actor, body.note, body.publish);
    await audit(actor, `${kind}.review_approved`, kind, groupId, { questions: pending.map((q) => q.external_id), note: body.note, publish: body.publish }, c);
    return { id: groupId, approved: pending.length };
  });
}

export async function rejectQuestions(questionIds: string[], actor: string, note: string) {
  if (!note.trim()) throw badRequest('Say why the submission was rejected');
  return tx(async (c) => {
    for (const id of questionIds) {
      const q = await one('SELECT id, origin, review_status FROM questions WHERE id = $1 FOR UPDATE', [id], c);
      if (!q) throw notFound('Question');
      if (q.origin !== 'authentic_pyq') throw badRequest('Only authentic-PYQ submissions go through review');
      await query(
        `UPDATE questions SET review_status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3,
           source_verification = 'unverified', answer_key_verification = 'unverified',
           status = CASE WHEN status = 'published' THEN 'unpublished' ELSE status END, updated_at = now()
         WHERE id = $1`,
        [id, actor, note],
        c,
      );
      await audit(actor, 'question.review_rejected', 'question', id, { note }, c);
    }
    return { rejected: questionIds.length };
  });
}

/** The review queue: standalone questions and whole passages/sets with anything pending or rejected. */
export async function reviewQueue(status: 'pending' | 'rejected' | 'approved') {
  const rows = await many(
    `SELECT q.id, q.external_id, q.section_id, q.topic_id, q.question_type, q.exam_year, q.exam_slot, q.question_number, q.status, q.review_status,
            q.review_note, q.reviewed_at, q.passage_id, q.dilr_set_id, q.updated_at, left(q.stem_md, 200) AS stem_preview, j.filename AS import_filename
       FROM questions q LEFT JOIN content_import_jobs j ON j.id = q.import_job_id
      WHERE q.origin = 'authentic_pyq' AND q.review_status = $1
      ORDER BY q.exam_year DESC, q.exam_slot NULLS FIRST, q.section_id, q.question_number NULLS LAST, q.external_id
      LIMIT 500`,
    [status],
  );
  const units: any[] = [];
  const groups = new Map<string, any>();
  for (const r of rows) {
    const checks = await questionChecks(r.id);
    const item = { ...r, checks, ready: blockers(checks).length === 0 };
    const gid = r.passage_id ?? r.dilr_set_id;
    if (!gid) {
      units.push({ kind: 'question', id: r.id, ready: item.ready, questions: [item] });
      continue;
    }
    let unit = groups.get(gid);
    if (!unit) {
      const kind = r.passage_id ? 'passage' : 'dilr_set';
      const g = await one(
        `SELECT id, external_id, title, origin, exam_year, exam_slot, source_name, source_reference, source_url, source_verification, left(body_md, 400) AS body_preview
           FROM ${kind === 'passage' ? 'passages' : 'dilr_sets'} WHERE id = $1`,
        [gid],
      );
      unit = { kind, id: gid, group: g, questions: [] as any[], ready: true };
      groups.set(gid, unit);
      units.push(unit);
    }
    unit.questions.push(item);
    unit.ready = unit.ready && item.ready;
  }
  return { status, units };
}
