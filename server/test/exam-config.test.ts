import { afterAll, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool.js';
import { marksFor } from '../src/domain/scoring.js';
import { signUp, type Client } from './helpers.js';

/*
 * The CAT 2024 pattern seeded by the app is real data with honest sources (none of which verify
 * it). Every other pattern and source below is a TEST FIXTURE, named as such and deleted afterwards.
 */
const answerOf = async (id: string) => (await query('SELECT correct_answer FROM questions WHERE id = $1', [id])).rows[0].correct_answer as string;
const FIXTURE_V2 = {
  year: 2024, name: 'TEST FIXTURE pattern v2 (not a real CAT pattern)', totalDurationMin: 30, sectionalLock: true, sourceNote: 'Test fixture',
  sections: [
    { sectionId: 'QA', position: 1, durationMin: 10, questionCount: 6, mcqCorrect: 4, mcqWrong: -2, titaCorrect: 2, titaWrong: -1 },
    { sectionId: 'DILR', position: 2, durationMin: 10, questionCount: 4, mcqCorrect: 4, mcqWrong: -2, titaCorrect: 2, titaWrong: -1 },
    { sectionId: 'VARC', position: 3, durationMin: 10, questionCount: 4, mcqCorrect: 4, mcqWrong: -2, titaCorrect: 2, titaWrong: -1 },
  ],
};
const OFFICIAL_FIXTURE = { kind: 'official', title: 'TEST FIXTURE official notice', publisher: 'Fixture publisher', url: 'https://example.org/fixture-notice.pdf', accessedOn: '2026-10-12', supports: 'Fixture: marking scheme' };

let admin: Client;
let learner: Client;
let v1Id: string;
const fixtureConfigs: string[] = [];

afterAll(async () => {
  if (v1Id) {
    await query('UPDATE exam_configs SET is_active = false WHERE is_active');
    await query('UPDATE exam_configs SET is_active = true WHERE id = $1', [v1Id]);
  }
  await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[admin?.id, learner?.id].filter(Boolean)]);
  await query('DELETE FROM mock_tests WHERE exam_config_id = ANY($1::uuid[])', [fixtureConfigs]);
  await query('DELETE FROM exam_configs WHERE id = ANY($1::uuid[])', [fixtureConfigs]);
});

/** Answers every question in the open section in turn: correct, wrong, left blank. Returns the expected score. */
async function answerSection(c: Client, state: any) {
  const attemptId = state.attempt.id;
  const section = state.sections[state.attempt.currentSection];
  let expected = 0;
  const seen = { correct: 0, wrong: 0, unanswered: 0 };
  for (const [i, q] of section.questions.entries()) {
    const right = await answerOf(q.id);
    const mode = (['correct', 'wrong', 'unanswered'] as const)[i % 3];
    const give = mode === 'correct' ? right : mode === 'wrong' ? (q.question_type === 'MCQ' ? q.options.map((o: any) => o.key).find((k: string) => k !== right) : '987654') : null;
    if (give !== null) expect((await c.put(`/api/mocks/attempts/${attemptId}/responses/${q.id}`, { answer: give, timeSpentSec: 5 })).status).toBe(200);
    const m = marksFor({ question_type: q.question_type, correct_answer: right, answer_tolerance: 0, marks_correct: Number(q.marksCorrect), marks_wrong: Number(q.marksWrong) } as any, give);
    expect(m.status).toBe(mode);
    seen[mode]++;
    expected += m.marks;
  }
  return { expected, seen, count: section.questions.length };
}

describe('versioned exam patterns', () => {
  it('seeds the CAT 2024 pattern as version 1, active and unverified, with its sources recorded', async () => {
    admin = await signUp({ admin: true });
    learner = await signUp();
    const list = await admin.get('/api/admin/exam-configs');
    expect(list.status).toBe(200);
    const v1 = list.body.items.find((c: any) => c.year === 2024 && c.version === 1);
    v1Id = v1.id;
    expect(v1).toMatchObject({ is_active: true, status: 'unverified', name: 'CAT 2024 pattern', total_duration_min: 120, sectional_lock: true, editable: false });
    expect(v1.label).toBe('CAT 2024 pattern (version 1, unverified)');
    expect(v1.fields.every((f: any) => f.status === 'unverified')).toBe(true);
    expect(v1.sources.map((s: any) => [s.kind, s.publisher])).toEqual([
      ['official', 'Indian Institute of Management Lucknow (iiml.ac.in)'],
      ['secondary', 'Wikipedia'],
    ]);
    expect(v1.sections.map((s: any) => [s.section_id, s.duration_min, s.question_count, Number(s.mcq_correct), Number(s.mcq_wrong), Number(s.tita_correct), Number(s.tita_wrong)])).toEqual([
      ['VARC', 40, 24, 3, -1, 3, 0],
      ['DILR', 40, 22, 3, -1, 3, 0],
      ['QA', 40, 22, 3, -1, 3, 0],
    ]);
    expect(list.body.items.filter((c: any) => c.is_active)).toHaveLength(1);
  });

  it('tells learners which pattern is in use, whether it is verified, and whether it matches their exam year', async () => {
    await learner.patch('/api/profile', { examYear: 2026 });
    const p = await learner.get('/api/mocks/pattern');
    expect(p.body.active).toMatchObject({ year: 2024, version: 1, status: 'unverified' });
    expect(p.body).toMatchObject({ examYear: 2026, matchesExamYear: false, forExamYear: null });
    await learner.patch('/api/profile', { examYear: 2024 });
    expect((await learner.get('/api/mocks/pattern')).body.matchesExamYear).toBe(true);
  });

  it('refuses to verify a setting against a secondary source and never edits the active version in place', async () => {
    const v1 = (await admin.get('/api/admin/exam-configs')).body.items.find((c: any) => c.id === v1Id);
    const secondary = v1.sources.find((s: any) => s.kind === 'secondary');
    const r = await admin.post(`/api/admin/exam-configs/${v1Id}/verify`, { verify: { marking_correct: secondary.id } });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/only be verified against an official source/);
    const edit = await admin.patch(`/api/admin/exam-configs/${v1Id}`, { ...FIXTURE_V2, name: 'changed' });
    expect(edit.status).toBe(409);
    expect((await learner.get('/api/admin/exam-configs')).status).toBe(403);
  });

  it('adds a new version, verifies settings field by field, then freezes and activates it while old tests keep their pattern', async () => {
    const before = await learner.post('/api/mocks', { kind: 'full' });
    expect(before.status).toBe(201);
    expect(before.body.exam_config_id).toBe(v1Id);
    expect(before.body.description).toBe('Timing and marking follow CAT 2024 pattern (version 1, unverified).');

    const created = await admin.post('/api/admin/exam-configs', { ...FIXTURE_V2, supersedesId: v1Id });
    expect(created.status).toBe(201);
    const v2Id = created.body.id;
    fixtureConfigs.push(v2Id);
    expect(created.body).toMatchObject({ version: 2, is_active: false, status: 'unverified', editable: true, supersedes_id: v1Id });
    expect((await admin.post('/api/admin/exam-configs', { ...FIXTURE_V2, totalDurationMin: 99 })).status).toBe(400);

    const renamed = await admin.patch(`/api/admin/exam-configs/${v2Id}`, { ...FIXTURE_V2, name: 'TEST FIXTURE pattern v2b (not a real CAT pattern)' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('TEST FIXTURE pattern v2b (not a real CAT pattern)');

    const src = await admin.post(`/api/admin/exam-configs/${v2Id}/sources`, OFFICIAL_FIXTURE);
    expect(src.status).toBe(201);
    const verified = await admin.post(`/api/admin/exam-configs/${v2Id}/verify`, { verify: { marking_correct: src.body.id, marking_mcq_wrong: src.body.id } });
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ status: 'partially_verified', editable: false });
    expect(verified.body.fields.find((f: any) => f.key === 'marking_correct')).toMatchObject({ status: 'verified', sourceId: src.body.id });
    expect((await admin.patch(`/api/admin/exam-configs/${v2Id}`, FIXTURE_V2)).status).toBe(409);
    expect((await admin.del(`/api/admin/exam-configs/${v2Id}/sources/${src.body.id}`)).status).toBe(409);

    const active = await admin.post(`/api/admin/exam-configs/${v2Id}/activate`);
    expect(active.body).toMatchObject({ is_active: true, label: 'TEST FIXTURE pattern v2b (not a real CAT pattern) (version 2, partially verified)' });
    const configs = (await admin.get('/api/admin/exam-configs')).body.items;
    expect(configs.filter((c: any) => c.is_active).map((c: any) => c.id)).toEqual([v2Id]);
    expect(configs.find((c: any) => c.id === v1Id).sections).toHaveLength(3);

    const after = await learner.post('/api/mocks', { kind: 'full' });
    expect(after.body.exam_config_id).toBe(v2Id);
    const sections = (await query('SELECT section_id, duration_sec FROM mock_test_sections WHERE mock_test_id = $1 ORDER BY position', [after.body.id])).rows;
    expect(sections).toEqual([
      { section_id: 'QA', duration_sec: 600 },
      { section_id: 'DILR', duration_sec: 600 },
      { section_id: 'VARC', duration_sec: 600 },
    ]);
    const marks = async (testId: string) =>
      (await query(
        `SELECT DISTINCT q.question_type, mq.marks_correct::float AS c, mq.marks_wrong::float AS w FROM mock_test_questions mq
           JOIN mock_test_sections s ON s.id = mq.mock_test_section_id JOIN questions q ON q.id = mq.question_id WHERE s.mock_test_id = $1 ORDER BY 1`,
        [testId],
      )).rows;
    expect(await marks(after.body.id)).toEqual([{ question_type: 'MCQ', c: 4, w: -2 }, { question_type: 'TITA', c: 2, w: -1 }]);
    expect(await marks(before.body.id)).toEqual([{ question_type: 'MCQ', c: 3, w: -1 }, { question_type: 'TITA', c: 3, w: 0 }]);
    const qa = (await query("SELECT count(*)::int AS n FROM mock_test_questions mq JOIN mock_test_sections s ON s.id = mq.mock_test_section_id WHERE s.mock_test_id = $1 AND s.section_id = 'QA'", [after.body.id])).rows[0];
    expect(qa.n).toBe(6);

    const p = await learner.get('/api/mocks/pattern');
    expect(p.body.active).toMatchObject({ id: v2Id, version: 2, status: 'partially_verified' });
  });

  it('scores +3 / −1 / 0 under version 1 and the custom marks under version 2, with unanswered questions at zero', async () => {
    const tests = (await learner.get('/api/mocks')).body.tests.filter((t: any) => t.kind === 'full' && !t.platform);
    expect(tests.map((t: any) => t.pattern_version).sort()).toEqual([1, 2]);
    for (const t of tests) {
      const start = await learner.post(`/api/mocks/${t.id}/start`);
      expect(start.body.test.examPattern.version).toBe(t.pattern_version);
      const { expected, seen, count } = await answerSection(learner, start.body);
      expect(seen.correct + seen.wrong + seen.unanswered).toBe(count);
      const sub = await learner.post(`/api/mocks/attempts/${start.body.attempt.id}/submit`);
      expect(Number(sub.body.raw_score)).toBe(expected);
      const an = (await learner.get(`/api/mocks/attempts/${start.body.attempt.id}/analysis`)).body.summary;
      const first = an.sections[0];
      expect(first).toMatchObject({ correct: seen.correct, wrong: seen.wrong });
      expect(Number(first.score)).toBe(expected);
      // Every question in the later, unopened sections counts as unanswered and scores nothing.
      for (const s of an.sections.slice(1)) expect(Number(s.score)).toBe(0);
    }
  });

  it('runs each section on its own clock and submits when the last one runs out', async () => {
    const t = (await learner.post('/api/mocks', { kind: 'full' })).body;
    const start = await learner.post(`/api/mocks/${t.id}/start`);
    const attemptId = start.body.attempt.id;
    const deadline = new Date(start.body.attempt.deadline).getTime() - new Date(start.body.attempt.startedAt).getTime();
    expect(Math.round(deadline / 1000)).toBe(600);
    expect(start.body.sections.map((s: any) => s.locked)).toEqual([false, true, true]);
    const shift = (min: number) =>
      query(`UPDATE mock_attempts SET started_at = started_at - make_interval(mins => $2), section_started_at = section_started_at - make_interval(mins => $2) WHERE id = $1`, [attemptId, min]);
    await shift(11);
    const s1 = (await learner.get(`/api/mocks/attempts/${attemptId}`)).body;
    expect(s1.attempt).toMatchObject({ status: 'in_progress', currentSection: 1 });
    expect(s1.sections.map((s: any) => s.locked)).toEqual([true, false, true]);
    await shift(10);
    expect((await learner.get(`/api/mocks/attempts/${attemptId}`)).body.attempt.currentSection).toBe(2);
    await shift(10);
    const done = (await learner.get(`/api/mocks/attempts/${attemptId}`)).body.attempt;
    expect(done).toMatchObject({ status: 'submitted', submitReason: 'timeout' });
  });

  it('keeps patterns for other years separate and offers the one matching the learner\'s exam year', async () => {
    const other = await admin.post('/api/admin/exam-configs', { ...FIXTURE_V2, year: 2025, name: 'TEST FIXTURE 2025 pattern (not a real CAT pattern)' });
    expect(other.status).toBe(201);
    fixtureConfigs.push(other.body.id);
    expect(other.body).toMatchObject({ year: 2025, version: 1, is_active: false });
    await learner.patch('/api/profile', { examYear: 2025 });
    const p = (await learner.get('/api/mocks/pattern')).body;
    expect(p.active.year).toBe(2024);
    expect(p).toMatchObject({ examYear: 2025, matchesExamYear: false });
    expect(p.forExamYear).toMatchObject({ year: 2025, status: 'unverified' });
    const audit = (await query("SELECT action FROM audit_logs WHERE entity_type = 'exam_config' AND entity_id = ANY($1::text[])", [fixtureConfigs])).rows.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['exam_config.create', 'exam_config.update', 'exam_config.source_add', 'exam_config.verify', 'exam_config.activate']));
  });
});
