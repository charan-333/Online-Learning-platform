import crypto from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool.js';
import { pickQuestions } from '../src/services/recommend.js';
import { questionId, signUp, type Client } from './helpers.js';

/*
 * TEST FIXTURES ONLY. Every item below is invented for these tests, says so in its text, and is
 * deleted afterwards. None of it is a CAT question, a CAT answer key or a real source.
 */
const PAPER = { source_name: 'Fixture paper (not a real CAT paper)', exam_year: '2022', exam_slot: '1' };
const KEY = 'Fixture answer key (not a real CAT key)';
const solution = (verification = 'Fixture check of the final answer.') => ({ solution_learn: 'Fixture working.', solution_hints: 'First hint || Second hint', solution_verification: verification });

const csvRows: Record<string, string>[] = [
  { record_type: 'passage', external_id: 'fx-pyq-p1', origin: 'authentic_pyq', title: 'TEST FIXTURE passage', domain: 'Fixture', difficulty: 'medium',
    body: 'TEST FIXTURE passage body, invented for automated tests. It is not from any CAT paper.', ...PAPER, source_reference: 'Fixture VARC passage 1' },
  { record_type: 'question', external_id: 'fx-pyq-v1', origin: 'authentic_pyq', section: 'VARC', topic: 'varc-rc-inference', type: 'MCQ', difficulty: 'medium',
    stem: 'TEST FIXTURE inference question one?', option_a: 'Fixture A', option_b: 'Fixture B', option_c: 'Fixture C', option_d: 'Fixture D', answer: 'C',
    estimated_time_sec: '90', ...PAPER, question_number: '1', passage: 'fx-pyq-p1', position: '1', source_reference: 'Fixture VARC Q1',
    answer_key_name: KEY, answer_key_reference: 'Fixture key VARC Q1', answer_key_answer: 'C', ...solution(), distractor_a: 'Fixture why A is wrong', distractor_b: 'Fixture why B is wrong', distractor_d: 'Fixture why D is wrong' },
  { record_type: 'question', external_id: 'fx-pyq-v2', origin: 'authentic_pyq', section: 'VARC', topic: 'varc-rc-main-idea', type: 'MCQ', difficulty: 'medium',
    stem: 'TEST FIXTURE main idea question two?', option_a: 'Fixture main A', option_b: 'Fixture main B', option_c: 'Fixture main C', option_d: 'Fixture main D', answer: 'A',
    estimated_time_sec: '90', ...PAPER, question_number: '2', passage: 'fx-pyq-p1', position: '2', source_reference: 'Fixture VARC Q2',
    answer_key_name: KEY, answer_key_reference: 'Fixture key VARC Q2', answer_key_answer: 'A', ...solution(), distractor_b: 'Fixture B', distractor_c: 'Fixture C', distractor_d: 'Fixture D' },
  { record_type: 'question', external_id: 'fx-pyq-q1', origin: 'authentic_pyq', section: 'QA', topic: 'qa-percentages', type: 'TITA', difficulty: 'medium',
    stem: 'TEST FIXTURE: what is 15% of 80?', answer: '12', estimated_time_sec: '60', ...PAPER, question_number: '5', source_reference: 'Fixture QA Q5',
    answer_key_name: KEY, answer_key_reference: 'Fixture key QA Q5', answer_key_answer: '12', ...solution() },
  { record_type: 'question', external_id: 'fx-pyq-q2', origin: 'authentic_pyq', section: 'QA', topic: 'qa-percentages', type: 'MCQ', difficulty: 'medium',
    stem: 'TEST FIXTURE: a price rises from 50 to 60. By what percent did it rise?', option_a: '10%', option_b: '20%', option_c: '25%', option_d: '30%', answer: 'B',
    estimated_time_sec: '60', ...PAPER, question_number: '6', source_reference: 'Fixture QA Q6',
    answer_key_name: KEY, answer_key_reference: 'Fixture key QA Q6', answer_key_answer: 'B', ...solution(), distractor_a: 'Fixture A', distractor_c: 'Fixture C' },
  { record_type: 'question', external_id: 'fx-rec-q1', origin: 'reconstructed', section: 'QA', topic: 'qa-percentages', type: 'TITA', difficulty: 'easy',
    stem: 'TEST FIXTURE reconstruction: what is 5% of 80?', answer: '4', estimated_time_sec: '45', ...PAPER, question_number: '7',
    source_name: 'Fixture recollection (not a real source)', source_reference: 'Fixture memory of QA Q7', solution_learn: '0.05 × 80 = 4' },
];

function toCsv(rows: Record<string, string>[]) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v = '') => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
}
const CSV = toCsv(csvRows);

const JSONL = [
  { kind: 'dilr_set', externalId: 'fx-pyq-s1', title: 'TEST FIXTURE set', setType: 'arrangement', difficulty: 'medium', body: 'TEST FIXTURE set body, invented for tests.',
    origin: 'authentic_pyq', examYear: 2022, examSlot: 1, source: { name: PAPER.source_name, reference: 'Fixture DILR set 1' } },
  { kind: 'question', externalId: 'fx-pyq-d1', section: 'DILR', topic: 'dilr-lr-arrangements', type: 'TITA', difficulty: 'medium', stem: 'TEST FIXTURE: how many seats are empty?',
    answer: '3', estimatedTimeSec: 120, origin: 'authentic_pyq', examYear: 2022, examSlot: 1, questionNumber: 1, set: 'fx-pyq-s1', position: 1,
    sources: [{ name: PAPER.source_name, reference: 'Fixture DILR Q1' }], answerKey: { name: KEY, reference: 'Fixture key DILR Q1', answer: '3' },
    solution: { learn: 'Fixture working.', verification: 'Fixture check.' } },
].map((x) => JSON.stringify(x)).join('\n');

const CONFIRM = { confirm: { paperSource: true, answerKey: true, solution: true }, note: 'Fixture review' };
const PYQ_IDS = ['fx-pyq-v1', 'fx-pyq-v2', 'fx-pyq-q1', 'fx-pyq-q2', 'fx-pyq-d1'];
const row = async (externalId: string) =>
  (await query('SELECT status, review_status, source_verification, answer_key_verification, solution_verification, version FROM questions WHERE external_id = $1', [externalId])).rows[0];
const groupId = async (table: 'passages' | 'dilr_sets', externalId: string) => (await query(`SELECT id FROM ${table} WHERE external_id = $1`, [externalId])).rows[0].id as string;

let admin: Client;
let learner: Client;
const users: string[] = [];
let fixtureConfigId: string | null = null;

afterAll(async () => {
  await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
  await query("DELETE FROM questions WHERE external_id LIKE 'fx-%'");
  await query("DELETE FROM passages WHERE external_id LIKE 'fx-%'");
  await query("DELETE FROM dilr_sets WHERE external_id LIKE 'fx-%'");
  if (fixtureConfigId) {
    await query('DELETE FROM mock_tests WHERE exam_config_id = $1', [fixtureConfigId]);
    await query('DELETE FROM exam_configs WHERE id = $1', [fixtureConfigId]);
  }
});

describe('authentic PYQ ingestion and review', () => {
  it('imports a CSV paper extract and a JSON Lines DILR set into the review queue without publishing them', async () => {
    admin = await signUp({ admin: true });
    learner = await signUp();
    users.push(admin.id, learner.id);

    const dry = await admin.post('/api/admin/questions/import-file', { format: 'csv', content: CSV, filename: 'fixture.csv', dryRun: true, publish: true });
    expect(dry.status).toBe(200);
    expect(dry.body.accepted).toBe(6);
    expect((await query("SELECT count(*)::int AS n FROM questions WHERE external_id LIKE 'fx-%'")).rows[0].n).toBe(0);

    const r = await admin.post('/api/admin/questions/import-file', { format: 'csv', content: CSV, filename: 'fixture.csv', publish: true });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'imported', accepted: 6, format: 'csv', file_sha256: crypto.createHash('sha256').update(CSV).digest('hex') });
    const warnings = r.body.report.filter((i: any) => i.code === 'review_blocker');
    expect(warnings.map((i: any) => i.externalId)).toEqual(['fx-pyq-q2']);

    const set = await admin.post('/api/admin/questions/import-file', { format: 'jsonl', content: JSONL, filename: 'fixture.jsonl', publish: true });
    expect(set.status).toBe(201);
    expect(set.body).toMatchObject({ accepted: 2, format: 'jsonl' });

    for (const id of PYQ_IDS) {
      expect(await row(id)).toMatchObject({ status: 'draft', review_status: 'pending', source_verification: 'unverified', answer_key_verification: 'unverified' });
    }
    expect(await row('fx-rec-q1')).toMatchObject({ status: 'published', review_status: 'not_required', source_verification: 'unverified' });

    const sources = (await query("SELECT s.kind, s.source_name, s.reference, s.recorded_answer FROM question_sources s JOIN questions q ON q.id = s.question_id WHERE q.external_id = 'fx-pyq-q1' ORDER BY s.kind")).rows;
    expect(sources).toEqual([
      { kind: 'answer_key', source_name: KEY, reference: 'Fixture key QA Q5', recorded_answer: '12' },
      { kind: 'question_paper', source_name: PAPER.source_name, reference: 'Fixture QA Q5', recorded_answer: null },
    ]);
    const passage = (await query("SELECT origin, exam_year, exam_slot, source_name, source_reference, source_verification FROM passages WHERE external_id = 'fx-pyq-p1'")).rows[0];
    expect(passage).toEqual({ origin: 'authentic_pyq', exam_year: 2022, exam_slot: 1, source_name: PAPER.source_name, source_reference: 'Fixture VARC passage 1', source_verification: 'unverified' });
    const job = (await query("SELECT q.import_job_id = j.id AS linked FROM questions q JOIN content_import_jobs j ON j.id = q.import_job_id WHERE q.external_id = 'fx-pyq-d1'")).rows[0];
    expect(job.linked).toBe(true);
  });

  it('never shows a PYQ awaiting review to learners, and the database refuses to publish one', async () => {
    const q1 = await questionId('fx-pyq-q1');
    expect((await learner.get(`/api/questions/${q1}`)).status).toBe(404);
    const verified = await learner.get('/api/questions?provenance=verified_pyq&pageSize=100');
    expect(verified.body.items.filter((i: any) => i.external_id.startsWith('fx-'))).toEqual([]);
    const passages = await learner.get('/api/passages');
    expect(passages.body.items.some((p: any) => p.external_id === 'fx-pyq-p1')).toBe(false);
    expect((await learner.get(`/api/passages/${await groupId('passages', 'fx-pyq-p1')}`)).status).toBe(404);
    expect((await learner.get(`/api/dilr-sets/${await groupId('dilr_sets', 'fx-pyq-s1')}`)).status).toBe(404);

    const historical = await learner.get('/api/questions?provenance=unverified_historical&pageSize=100');
    const rec = historical.body.items.find((i: any) => i.external_id === 'fx-rec-q1');
    expect(rec).toMatchObject({ provenance: 'unverified_historical', origin: 'reconstructed', exam_year: 2022 });

    await expect(query("UPDATE questions SET status = 'published' WHERE id = $1", [q1])).rejects.toThrow(/questions_published_pyq_verified/);
    await expect(
      query("UPDATE questions SET status = 'published', review_status = 'approved', source_verification = 'verified', solution_verification = 'verified' WHERE id = $1", [q1]),
    ).rejects.toThrow(/questions_published_pyq_verified/);
    expect((await admin.post(`/api/admin/questions/${q1}/status`, { status: 'published' })).status).toBe(400);
  });

  it('runs automated checks and blocks approval until they pass and the reviewer confirms', async () => {
    const queue = await admin.get('/api/admin/review');
    expect(queue.status).toBe(200);
    const units = queue.body.units.filter((u: any) => u.questions.some((q: any) => q.external_id.startsWith('fx-')));
    const byKey = Object.fromEntries(units.map((u: any) => [u.kind === 'question' ? u.questions[0].external_id : u.group.external_id, u]));
    expect(Object.keys(byKey).sort()).toEqual(['fx-pyq-p1', 'fx-pyq-q1', 'fx-pyq-q2', 'fx-pyq-s1']);
    expect(byKey['fx-pyq-p1'].questions.map((q: any) => q.external_id)).toEqual(['fx-pyq-v1', 'fx-pyq-v2']);
    expect(byKey['fx-pyq-p1'].ready).toBe(true);
    expect(byKey['fx-pyq-q2'].ready).toBe(false);
    const failing = byKey['fx-pyq-q2'].questions[0].checks.find((c: any) => !c.ok && c.blocking);
    expect(failing).toMatchObject({ code: 'solution_complete', message: 'No explanation for wrong option(s) D' });

    const q2 = await questionId('fx-pyq-q2');
    const blocked = await admin.post(`/api/admin/review/questions/${q2}/approve`, CONFIRM);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/No explanation for wrong option\(s\) D/);

    const q1 = await questionId('fx-pyq-q1');
    const unconfirmed = await admin.post(`/api/admin/review/questions/${q1}/approve`, { confirm: { paperSource: true, answerKey: false, solution: true } });
    expect(unconfirmed.status).toBe(400);
    const v1 = await questionId('fx-pyq-v1');
    const single = await admin.post(`/api/admin/review/questions/${v1}/approve`, CONFIRM);
    expect(single.status).toBe(400);
    expect(single.body.error.message).toMatch(/Approve the whole group/);
    expect((await learner.post(`/api/admin/review/questions/${q1}/approve`, CONFIRM)).status).toBe(403);

    const fix = await admin.patch(`/api/admin/questions/${q2}`, { solution: { distractors: { A: 'Fixture A', C: 'Fixture C', D: 'Fixture D' } } });
    expect(fix.body.reviewRequired).toBe(true);
    const detail = await admin.get(`/api/admin/questions/${q2}`);
    expect(detail.body.checks.filter((c: any) => c.blocking && !c.ok)).toEqual([]);
  });

  it('approves standalone questions and whole groups, records who did it, and labels them verified', async () => {
    const q1 = await questionId('fx-pyq-q1');
    const ok = await admin.post(`/api/admin/review/questions/${q1}/approve`, CONFIRM);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'published', review_status: 'approved', source_verification: 'verified', answer_key_verification: 'verified', solution_verification: 'verified' });
    expect((await admin.post(`/api/admin/review/questions/${q1}/approve`, CONFIRM)).status).toBe(409);
    expect((await admin.post(`/api/admin/review/questions/${await questionId('fx-pyq-q2')}/approve`, CONFIRM)).status).toBe(200);

    const passageId = await groupId('passages', 'fx-pyq-p1');
    const group = await admin.post(`/api/admin/review/groups/passage/${passageId}/approve`, CONFIRM);
    expect(group.status).toBe(200);
    expect(group.body.approved).toBe(2);
    const setId = await groupId('dilr_sets', 'fx-pyq-s1');
    expect((await admin.post(`/api/admin/review/groups/dilr_set/${setId}/approve`, CONFIRM)).body.approved).toBe(1);

    const pub = await learner.get(`/api/questions/${q1}`);
    expect(pub.status).toBe(200);
    expect(pub.body.provenance).toBe('verified_pyq');
    expect(pub.body.sources.map((s: any) => s.kind)).toEqual(['question_paper']);
    expect(JSON.stringify(pub.body)).not.toContain(KEY);
    const listed = await learner.get('/api/questions?provenance=verified_pyq&pageSize=100');
    expect(listed.body.items.filter((i: any) => i.external_id.startsWith('fx-')).map((i: any) => i.external_id).sort()).toEqual([...PYQ_IDS].sort());
    expect(listed.body.items.every((i: any) => i.provenance === 'verified_pyq')).toBe(true);
    const passages = await learner.get('/api/passages');
    expect(passages.body.items.find((p: any) => p.external_id === 'fx-pyq-p1')).toMatchObject({ provenance: 'verified_pyq', question_count: 2 });

    const audit = (await query("SELECT action FROM audit_logs WHERE entity_id = $1 OR entity_id = $2 ORDER BY created_at", [q1, passageId])).rows.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['question.review_approved', 'passage.review_approved']));
    expect((await query('SELECT count(*)::int AS n FROM question_versions WHERE question_id = $1', [q1])).rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await query('SELECT count(*)::int AS n FROM group_versions WHERE group_id = $1', [passageId])).rows[0].n).toBe(1);
    const reviewed = (await query('SELECT reviewed_by FROM questions WHERE id = $1', [q1])).rows[0];
    expect(reviewed.reviewed_by).toBe(admin.id);
  });

  it('prefers verified PYQs in practice selection, mocks and revision', async () => {
    const fresh = await signUp();
    users.push(fresh.id);
    const pyqs = [await questionId('fx-pyq-q1'), await questionId('fx-pyq-q2')];
    const picked = await pickQuestions(fresh.id, 'qa-percentages', 1200);
    expect(picked.slice(0, 2).sort()).toEqual([...pyqs].sort());
    expect(picked.length).toBeGreaterThan(2);

    const topic = await fresh.post('/api/mocks', { kind: 'topic', topics: ['qa-percentages'] });
    expect(topic.status).toBe(201);
    const start = await fresh.post(`/api/mocks/${topic.body.id}/start`);
    const qs = start.body.sections[0].questions;
    expect(qs.slice(0, 2).map((q: any) => q.id).sort()).toEqual([...pyqs].sort());
    expect(qs.slice(0, 2).every((q: any) => q.provenance === 'verified_pyq')).toBe(true);
    expect(qs.slice(2).every((q: any) => q.provenance !== 'verified_pyq')).toBe(true);
    await fresh.post(`/api/mocks/attempts/${start.body.attempt.id}/submit`);

    await fresh.post(`/api/questions/${pyqs[0]}/attempts`, { answer: '99', timeTakenSec: 30 });
    await query("UPDATE revision_items SET due_at = now() - interval '1 minute' WHERE user_id = $1", [fresh.id]);
    const due = await fresh.get('/api/revision/due');
    const item = due.body.items.find((i: any) => i.refId === pyqs[0]);
    expect(item.question).toMatchObject({ provenance: 'verified_pyq', examYear: 2022, examSlot: 1 });
  });

  it("times and scores a previous-year paper with that year's own pattern, in paper order", async () => {
    const cfg = await admin.post('/api/admin/exam-configs', {
      year: 2022, name: 'TEST FIXTURE pattern (not a real CAT pattern)', totalDurationMin: 120, sectionalLock: true,
      sections: [
        { sectionId: 'VARC', position: 1, durationMin: 40, questionCount: 24, mcqCorrect: 3, mcqWrong: -1, titaCorrect: 3, titaWrong: 0 },
        { sectionId: 'DILR', position: 2, durationMin: 40, questionCount: 20, mcqCorrect: 3, mcqWrong: -1, titaCorrect: 3, titaWrong: 0 },
        { sectionId: 'QA', position: 3, durationMin: 40, questionCount: 22, mcqCorrect: 3, mcqWrong: -1, titaCorrect: 3, titaWrong: 0 },
      ],
    });
    expect(cfg.status).toBe(201);
    fixtureConfigId = cfg.body.id;
    expect(cfg.body).toMatchObject({ is_active: false, status: 'unverified', version: 1 });

    const paper = await learner.post('/api/mocks', { kind: 'pyq_paper', year: 2022, slot: 1 });
    expect(paper.status).toBe(201);
    expect(paper.body.exam_config_id).toBe(fixtureConfigId);
    expect(paper.body.description).toContain('TEST FIXTURE pattern (not a real CAT pattern) (version 1, unverified)');
    const start = await learner.post(`/api/mocks/${paper.body.id}/start`);
    expect(start.body.test.examPattern).toMatchObject({ year: 2022, status: 'unverified' });
    const ids = (await query(
      `SELECT s.section_id, q.external_id FROM mock_test_questions mq JOIN mock_test_sections s ON s.id = mq.mock_test_section_id
         JOIN questions q ON q.id = mq.question_id WHERE s.mock_test_id = $1 ORDER BY s.position, mq.position`,
      [paper.body.id],
    )).rows.map((r) => `${r.section_id}:${r.external_id}`);
    expect(ids).toEqual(['VARC:fx-pyq-v1', 'VARC:fx-pyq-v2', 'DILR:fx-pyq-d1', 'QA:fx-pyq-q1', 'QA:fx-pyq-q2']);
    await learner.post(`/api/mocks/attempts/${start.body.attempt.id}/submit`);
  });

  it('sends an edited or re-imported PYQ back to review and out of learners\' view', async () => {
    const q1 = await questionId('fx-pyq-q1');
    const before = await row('fx-pyq-q1');
    const versionsBefore = (await query('SELECT count(*)::int AS n FROM question_versions WHERE question_id = $1', [q1])).rows[0].n;
    const edit = await admin.patch(`/api/admin/questions/${q1}`, { stem: 'TEST FIXTURE (edited): what is 15% of 80?' });
    expect(edit.body.reviewRequired).toBe(true);
    expect(await row('fx-pyq-q1')).toMatchObject({ status: 'unpublished', review_status: 'pending', source_verification: 'unverified', answer_key_verification: 'unverified', version: before.version + 1 });
    expect((await query('SELECT count(*)::int AS n FROM question_versions WHERE question_id = $1', [q1])).rows[0].n).toBe(versionsBefore + 1);
    expect((await learner.get(`/api/questions/${q1}`)).status).toBe(404);

    // A tag-only style edit to a non-PYQ does not touch review.
    const rec = await questionId('fx-rec-q1');
    expect((await admin.patch(`/api/admin/questions/${rec}`, { difficulty: 'medium' })).body.reviewRequired).toBe(false);

    const again = await admin.post('/api/admin/questions/import-file', { format: 'jsonl', content: JSONL, filename: 'fixture.jsonl' });
    expect(again.status).toBe(201);
    expect(await row('fx-pyq-d1')).toMatchObject({ status: 'unpublished', review_status: 'pending' });
    const setId = await groupId('dilr_sets', 'fx-pyq-s1');
    expect((await admin.post(`/api/admin/review/groups/dilr_set/${setId}/approve`, CONFIRM)).body.approved).toBe(1);
    expect(await row('fx-pyq-d1')).toMatchObject({ status: 'published', review_status: 'approved' });
  });

  it('rejects a submission only with a reason and keeps it hidden', async () => {
    const q1 = await questionId('fx-pyq-q1');
    expect((await admin.post('/api/admin/review/reject', { questionIds: [q1], note: ' ' })).status).toBe(400);
    const r = await admin.post('/api/admin/review/reject', { questionIds: [q1], note: 'Fixture: wording differs from the paper' });
    expect(r.body.rejected).toBe(1);
    const rejected = await admin.get('/api/admin/review?status=rejected');
    expect(rejected.body.units.some((u: any) => u.questions.some((q: any) => q.id === q1 && q.review_note === 'Fixture: wording differs from the paper'))).toBe(true);
    expect((await admin.post(`/api/admin/review/questions/${q1}/approve`, CONFIRM)).status).toBe(409);
    expect((await learner.get(`/api/questions/${q1}`)).status).toBe(404);
  });

  it('keeps the 65 original-practice questions labelled as original practice', async () => {
    const seeded = (await query(
      "SELECT origin, review_status, source_verification, answer_key_verification, exam_year, status, count(*)::int AS n FROM questions WHERE external_id LIKE 'c100-%' GROUP BY 1, 2, 3, 4, 5, 6",
    )).rows;
    expect(seeded).toEqual([{ origin: 'original_practice', review_status: 'not_required', source_verification: 'not_applicable', answer_key_verification: 'not_applicable', exam_year: null, status: 'published', n: 65 }]);
    let page = 1;
    const seen: any[] = [];
    for (;;) {
      const r = await learner.get(`/api/questions?provenance=practice&pageSize=100&page=${page}`);
      seen.push(...r.body.items);
      if (seen.length >= r.body.total) break;
      page++;
    }
    const c100 = seen.filter((i) => i.external_id.startsWith('c100-'));
    expect(c100).toHaveLength(65);
    expect(c100.every((i) => i.provenance === 'original_practice')).toBe(true);
  });
});
