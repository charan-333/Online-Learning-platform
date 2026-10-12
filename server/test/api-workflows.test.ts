import { describe, expect, it } from 'vitest';
import { query } from '../src/db/pool.js';
import { correctAnswer, questionId, signUp, type Client } from './helpers.js';

const answerFor = async (id: string) => (await query('SELECT correct_answer FROM questions WHERE id = $1', [id])).rows[0].correct_answer as string;

describe('daily lesson', () => {
  it('builds a lesson, enforces practice before completion, and writes a report', async () => {
    const c = await signUp();
    const r = await c.get('/api/lessons/daily?minutes=30');
    expect(r.status).toBe(200);
    const lesson = r.body;
    expect(lesson.minutes).toBe(30);
    expect(lesson.topic).toBeTruthy();
    const blocks = lesson.plan.blocks as any[];
    expect(blocks.length).toBeGreaterThan(1);
    // same day returns the same lesson (no duplicates)
    expect((await c.get('/api/lessons/daily?minutes=30')).body.id).toBe(lesson.id);

    const practice = blocks.find((b) => (b.type === 'practice' || b.type === 'timed_challenge') && b.questionIds?.length);
    if (practice) {
      const early = await c.post(`/api/lessons/${lesson.id}/progress`, { blockKey: practice.key });
      expect(early.body.blockDone).toBe(false);
    }
    let last: any;
    for (const b of blocks) {
      for (const qid of b.questionIds ?? []) {
        const a = await c.post(`/api/questions/${qid}/attempts`, { answer: await answerFor(qid), timeTakenSec: 40, context: 'lesson', contextId: lesson.id });
        expect(a.status).toBe(201);
      }
      last = await c.post(`/api/lessons/${lesson.id}/progress`, { blockKey: b.key });
      expect(last.body.blockDone).toBe(true);
    }
    expect(last.body.completed).toBe(true);
    expect(last.body.report).toBeTruthy();
    const list = await c.get('/api/lessons');
    expect(list.body.items[0].status).toBe('completed');
  });

  it('does not expose another learner\'s lesson', async () => {
    const a = await signUp();
    const b = await signUp();
    const l = await a.get('/api/lessons/daily');
    expect((await b.get(`/api/lessons/${l.body.id}`)).status).toBe(404);
    expect((await b.post(`/api/lessons/${l.body.id}/progress`, { blockKey: 'x' })).status).toBe(404);
  });
});

describe('spaced revision', () => {
  it('queues wrong answers and schedules reviews by grade', async () => {
    const c = await signUp();
    const id = await questionId('c100-qa-avg-001');
    const ans = await correctAnswer('c100-qa-avg-001');
    const wrong = ['A', 'B', 'C', 'D'].find((k) => k !== ans)!;
    await c.post(`/api/questions/${id}/attempts`, { answer: wrong, timeTakenSec: 50 });
    const items = await query('SELECT id, interval_days FROM revision_items WHERE user_id = $1', [c.id]);
    expect(items.rows.length).toBeGreaterThan(0);
    // make it due now
    await query("UPDATE revision_items SET due_at = now() - interval '1 minute' WHERE user_id = $1", [c.id]);
    const due = await c.get('/api/revision/due');
    expect(due.body.items.length).toBeGreaterThan(0);
    const item = due.body.items[0];
    const good = await c.post(`/api/revision/${item.id}/review`, { grade: 2 });
    expect(good.status).toBe(200);
    expect(good.body.interval_days).toBeGreaterThanOrEqual(1);
    const afterDue = await c.get('/api/revision/due');
    expect(afterDue.body.items.find((i: any) => i.id === item.id)).toBeUndefined();
    const other = await signUp();
    expect((await other.post(`/api/revision/${item.id}/review`, { grade: 3 })).status).toBe(404);
  });

  it('adds formula cards to the queue without duplicates', async () => {
    const c = await signUp();
    const f = await c.get('/api/formulas');
    const fid = f.body.items[0].id;
    expect((await c.post('/api/revision/items', { itemType: 'formula', refId: fid })).status).toBe(201);
    expect((await c.post('/api/revision/items', { itemType: 'formula', refId: fid })).status).toBe(201);
    const n = await query("SELECT count(*)::int AS n FROM revision_items WHERE user_id = $1 AND item_type = 'formula'", [c.id]);
    expect(n.rows[0].n).toBe(1);
  });
});

describe('diagnostic and study plan', () => {
  async function takeDiagnostic(c: Client) {
    const d = await c.get('/api/diagnostic');
    expect(d.status).toBe(200);
    expect(d.body.questions.length).toBeGreaterThan(5);
    const responses = [];
    for (const q of d.body.questions) responses.push({ questionId: q.id, answer: await answerFor(q.id), timeTakenSec: 60 });
    return c.post('/api/diagnostic/submit', { responses });
  }

  it('scores the diagnostic per section and creates a plan', async () => {
    const c = await signUp();
    await c.patch('/api/profile', { workdayMinutes: 60, weekendMinutes: 120 });
    const r = await takeDiagnostic(c);
    expect(r.status).toBe(200);
    expect(r.body.sections.map((s: any) => s.sectionId).sort()).toEqual(['DILR', 'QA', 'VARC']);
    expect(r.body.overallAccuracy).toBe(100);
    expect(r.body.caveat).toMatch(/starting point/);
    expect(r.body.planId).toBeTruthy();
    // retake inside 7 days is refused
    expect((await takeDiagnostic(c)).status).toBe(409);

    const plan = await c.get('/api/plans/current');
    expect(plan.body.plan.id).toBe(r.body.planId);
    expect(plan.body.tasks.length).toBeGreaterThan(0);
    const today = await c.get('/api/plans/today');
    expect(today.body.minimumViable.minutes).toBe(20);
  });

  it('rejects diagnostic responses for questions outside the diagnostic', async () => {
    const c = await signUp();
    const d = await c.get('/api/diagnostic');
    const inDiag = new Set(d.body.questions.map((q: any) => q.id));
    const all = await c.get('/api/questions?pageSize=100');
    const outside = all.body.items.find((q: any) => !inDiag.has(q.id));
    expect((await c.post('/api/diagnostic/submit', { responses: [{ questionId: outside.id, answer: 'A', timeTakenSec: 5 }] })).status).toBe(400);
  });

  it('moves missed tasks forward without duplicating them', async () => {
    const c = await signUp();
    const p = await c.post('/api/plans/generate', {});
    expect(p.status).toBe(201);
    const before = await query("SELECT count(*)::int AS n, coalesce(sum(minutes),0)::int AS m FROM study_plan_tasks WHERE plan_id = $1", [p.body.id]);
    // pretend yesterday's learn task was missed
    const t = (await query("SELECT id FROM study_plan_tasks WHERE plan_id = $1 AND task_type IN ('learn','practice') ORDER BY scheduled_date, position LIMIT 1", [p.body.id])).rows[0];
    await query("UPDATE study_plan_tasks SET scheduled_date = current_date - 1 WHERE id = $1", [t.id]);
    const cur = await c.get('/api/plans/current');
    expect(cur.status).toBe(200);
    const after = await query("SELECT count(*)::int AS n, coalesce(sum(minutes),0)::int AS m FROM study_plan_tasks WHERE plan_id = $1", [p.body.id]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const moved = (await query('SELECT scheduled_date, status FROM study_plan_tasks WHERE id = $1', [t.id])).rows[0];
    expect(moved.status).toBe('pending');
    expect(moved.scheduled_date >= new Date().toISOString().slice(0, 10)).toBe(true);
    // a learner can mark a task done, but not someone else's plan
    expect((await c.patch(`/api/plans/${p.body.id}`, { taskId: t.id, status: 'done' })).body.status).toBe('done');
    const other = await signUp();
    expect((await other.patch(`/api/plans/${p.body.id}`, { taskId: t.id, status: 'skipped' })).status).toBe(404);
  });
});

describe('mock tests', () => {
  it('runs the sample sectional-lock test end to end with scoring and honest analysis', async () => {
    const c = await signUp();
    const list = await c.get('/api/mocks');
    const sample = list.body.tests.find((t: any) => t.title === 'Sample test in CAT format');
    expect(sample.sections).toEqual(['VARC', 'DILR', 'QA']);
    const start = await c.post(`/api/mocks/${sample.id}/start`);
    expect(start.status).toBe(201);
    const attemptId = start.body.attempt.id;
    expect(start.body.sections[1].locked).toBe(true);
    expect(JSON.stringify(start.body)).not.toContain('correct_answer');
    // resume returns the same attempt
    expect((await c.post(`/api/mocks/${sample.id}/start`)).body.attempt.id).toBe(attemptId);
    // practice route refuses questions in the open test, solutions are locked
    const firstQ = start.body.sections[0].questions[0].id;
    expect((await c.post(`/api/questions/${firstQ}/attempts`, { answer: 'A', timeTakenSec: 1 })).status).toBe(403);
    expect((await c.get(`/api/questions/${firstQ}/solution?reveal=true`)).status).toBe(403);
    // locked section cannot be answered
    const dilrQ = start.body.sections[1].questions[0].id;
    expect((await c.put(`/api/mocks/attempts/${attemptId}/responses/${dilrQ}`, { answer: 'A' })).status).toBe(403);

    // VARC: answer first two correctly, third wrong (if MCQ), flag one
    const varc = start.body.sections[0].questions;
    const expected = { correct: 0, wrong: 0 };
    let score = 0;
    for (const [i, q] of varc.slice(0, 3).entries()) {
      const ans = await answerFor(q.id);
      const wrong = q.question_type === 'MCQ' ? ['A', 'B', 'C', 'D'].find((k) => k !== ans)! : null;
      const give = i < 2 || !wrong ? ans : wrong;
      const r = await c.put(`/api/mocks/attempts/${attemptId}/responses/${q.id}`, { answer: give, timeSpentSec: 60, flagged: i === 0 });
      expect(r.status).toBe(200);
      if (give === ans) (expected.correct++, (score += Number(q.marksCorrect)));
      else (expected.wrong++, (score += Number(q.marksWrong)));
    }
    expect((await c.post(`/api/mocks/attempts/${attemptId}/next-section`)).body.currentSection).toBe(1);
    // VARC is now closed
    expect((await c.put(`/api/mocks/attempts/${attemptId}/responses/${varc[0].id}`, { answer: 'A' })).status).toBe(403);
    await c.post(`/api/mocks/attempts/${attemptId}/next-section`);
    expect((await c.post(`/api/mocks/attempts/${attemptId}/next-section`)).status).toBe(400);

    const sub = await c.post(`/api/mocks/attempts/${attemptId}/submit`);
    expect(sub.body.status).toBe('submitted');
    expect(sub.body.submit_reason).toBe('manual');
    expect(Number(sub.body.raw_score)).toBe(score);
    const an = await c.get(`/api/mocks/attempts/${attemptId}/analysis`);
    const s = an.body.summary;
    expect(s.totals.correct).toBe(expected.correct);
    expect(s.totals.wrong).toBe(expected.wrong);
    expect(s.percentile).toBeNull();
    expect(s.percentileNote).toMatch(/No percentile/);
    expect(s.questions.every((q: any) => q.classification)).toBe(true);
    // after submission, solutions open and practice is allowed again
    expect((await c.get(`/api/questions/${varc[0].id}/solution`)).status).toBe(200);
    // other learners cannot read the attempt
    const other = await signUp();
    expect((await other.get(`/api/mocks/attempts/${attemptId}`)).status).toBe(404);
    expect((await other.get(`/api/mocks/attempts/${attemptId}/analysis`)).status).toBe(404);
    // submitting twice is harmless
    expect((await c.post(`/api/mocks/attempts/${attemptId}/submit`)).body.status).toBe('submitted');
    expect((await c.put(`/api/mocks/attempts/${attemptId}/responses/${varc[0].id}`, { answer: 'A' })).status).toBe(409);
  });

  it('auto-advances sections and auto-submits when time runs out', async () => {
    const c = await signUp();
    const t = await c.post('/api/mocks', { kind: 'sectional', sections: ['QA'], questionCount: 4, durationMin: 5 });
    expect(t.status).toBe(201);
    const start = await c.post(`/api/mocks/${t.body.id}/start`);
    const attemptId = start.body.attempt.id;
    const q = start.body.sections[0].questions[0];
    await c.put(`/api/mocks/attempts/${attemptId}/responses/${q.id}`, { answer: await answerFor(q.id), timeSpentSec: 30 });
    await query("UPDATE mock_attempts SET started_at = started_at - interval '2 hours', section_started_at = section_started_at - interval '2 hours' WHERE id = $1", [attemptId]);
    const state = await c.get(`/api/mocks/attempts/${attemptId}`);
    expect(state.body.attempt.status).toBe('submitted');
    expect(state.body.attempt.submitReason).toBe('timeout');
    const an = await c.get(`/api/mocks/attempts/${attemptId}/analysis`);
    expect(an.body.summary.totals.correct).toBe(1);
  });

  it('refuses a previous-year paper when no verified PYQs exist', async () => {
    const c = await signUp();
    const r = await c.post('/api/mocks', { kind: 'pyq_paper', year: 2023, slot: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/No verified PYQs/);
  });
});

describe('analytics', () => {
  it('starts empty and reflects real attempts only', async () => {
    const c = await signUp();
    const empty = await c.get('/api/analytics/overview');
    expect(empty.body.attempts.total).toBe(0);
    expect(empty.body.headline.testPerformance).toBeNull();
    const id = await questionId('c100-qa-pct-001');
    await c.post(`/api/questions/${id}/attempts`, { answer: 'B', timeTakenSec: 30, timed: true });
    await c.post(`/api/questions/${id}/attempts`, { answer: 'A', timeTakenSec: 30 });
    const o = await c.get('/api/analytics/overview');
    expect(o.body.attempts.total).toBe(2);
    expect(o.body.attempts.accuracy).toBe(50);
    expect(o.body.attempts.timedAccuracy).toBe(100);
    expect(o.body.attempts.untimedAccuracy).toBe(0);
    const topics = await c.get('/api/analytics/topics');
    expect(topics.status).toBe(200);
    expect((await c.get('/api/analytics/errors')).status).toBe(200);
  });
});

describe('strategy drills', () => {
  it('scores a selection against the optimal expected-value choice', async () => {
    const c = await signUp();
    const d = await c.post('/api/strategy/drills', { section: 'QA', count: 8 });
    expect(d.status).toBe(201);
    const total = d.body.items.reduce((s: number, i: any) => s + i.estimatedSec, 0);
    expect(d.body.budgetSec).toBeLessThan(total);
    const r = await c.post(`/api/strategy/drills/${d.body.id}/submit`, { chosen: d.body.items.slice(0, 2).map((i: any) => i.id) });
    expect(r.status).toBe(200);
    expect(r.body.optimal.ids.length).toBeGreaterThan(0);
    expect((await c.post(`/api/strategy/drills/${d.body.id}/submit`, { chosen: [] })).status).toBe(409);
  });
});

describe('tutor', () => {
  it('answers offline from platform content and labels the provider', async () => {
    const c = await signUp();
    const st = await c.get('/api/tutor/status');
    expect(st.body.aiEnabled).toBe(false);
    const s = await c.post('/api/tutor/sessions', { contextType: 'topic', contextId: 'qa-percentages' });
    const m = await c.post(`/api/tutor/sessions/${s.body.id}/messages`, { content: 'How do successive percentage changes work?' });
    expect(m.status).toBe(201);
    expect(m.body.message.provider).toBe('offline');
    expect(m.body.message.content.length).toBeGreaterThan(20);
    const other = await signUp();
    expect((await other.get(`/api/tutor/sessions/${s.body.id}`)).status).toBe(404);
    expect((await other.post(`/api/tutor/sessions/${s.body.id}/messages`, { content: 'hi' })).status).toBe(404);
  });

  it('does not leak an unattempted question\'s answer through the tutor', async () => {
    const c = await signUp();
    const id = await questionId('c100-qa-pct-002');
    const ans = await correctAnswer('c100-qa-pct-002');
    const s = await c.post('/api/tutor/sessions', { contextType: 'question', contextId: id });
    const m = await c.post(`/api/tutor/sessions/${s.body.id}/messages`, { content: 'What is the answer?' });
    expect(JSON.stringify(m.body.message.grounding)).not.toContain('learn_md');
    expect(m.body.message.content).not.toMatch(new RegExp(`answer is\\s*\\**${ans}\\b`, 'i'));
  });
});

describe('admin content management', () => {
  const item = (id: string, over: Record<string, unknown> = {}) => ({
    kind: 'question', externalId: id, section: 'QA', topic: 'qa-percentages', type: 'TITA', difficulty: 'easy',
    stem: `Admin test stem ${id}: what is 20% of 50?`, answer: '10', estimatedTimeSec: 40, origin: 'original_practice',
    solution: { learn: '0.2 × 50 = 10', hints: ['Convert to a decimal'], verification: '10/50 = 0.2' }, ...over,
  });

  it('dry-runs, imports as draft, edits with versioning, and publishes', async () => {
    const admin = await signUp({ admin: true });
    const learner = await signUp();
    const dry = await admin.post('/api/admin/questions/import', { items: [item('adm-q-1'), { kind: 'question' }], dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body.accepted).toBe(1);
    expect(dry.body.rejected).toBe(1);
    expect((await query("SELECT count(*)::int AS n FROM questions WHERE external_id = 'adm-q-1'")).rows[0].n).toBe(0);

    const imp = await admin.post('/api/admin/questions/import', { items: [item('adm-q-1')] });
    expect(imp.status).toBe(201);
    const qid = await questionId('adm-q-1');
    // drafts are invisible to learners
    expect((await learner.get(`/api/questions/${qid}`)).status).toBe(404);

    const edit = await admin.patch(`/api/admin/questions/${qid}`, { stem: 'Admin test stem adm-q-1: what is 20% of 60?', answer: '12' });
    expect(edit.status).toBe(200);
    const detail = await admin.get(`/api/admin/questions/${qid}`);
    expect(detail.body.versions.length).toBeGreaterThan(0);

    expect((await admin.post(`/api/admin/questions/${qid}/verify`, { solution: 'verified' })).status).toBe(200);
    expect((await admin.post(`/api/admin/questions/${qid}/status`, { status: 'published' })).status).toBe(200);
    expect((await learner.get(`/api/questions/${qid}`)).status).toBe(200);
    const audit = await admin.get('/api/admin/audit');
    expect(audit.body.items.some((a: any) => a.entity_id === qid || a.entity_id === 'adm-q-1')).toBe(true);
  });

  it('only publishes an authentic PYQ after its source is verified', async () => {
    const admin = await signUp({ admin: true });
    const src = [{ name: 'Test paper (fixture, not a real CAT paper)', reference: 'Fixture Q1' }];
    const r = await admin.post('/api/admin/questions/import', { items: [item('adm-pyq-ok', { origin: 'authentic_pyq', examYear: 2022, examSlot: 1, sources: src })] });
    expect(r.body.accepted).toBe(1);
    const qid = await questionId('adm-pyq-ok');
    await admin.post(`/api/admin/questions/${qid}/verify`, { solution: 'verified' });
    expect((await admin.post(`/api/admin/questions/${qid}/status`, { status: 'published' })).status).toBe(400);
    expect((await admin.post(`/api/admin/questions/${qid}/verify`, { source: 'verified' })).status).toBe(200);
    expect((await admin.post(`/api/admin/questions/${qid}/status`, { status: 'published' })).status).toBe(200);
    // remove the fixture so it never sits in the bank as a published "PYQ"
    await query('DELETE FROM questions WHERE id = $1', [qid]);
  });

  it('refuses to import an authentic PYQ without provenance', async () => {
    const admin = await signUp({ admin: true });
    const r = await admin.post('/api/admin/questions/import', { items: [item('adm-pyq-1', { origin: 'authentic_pyq', examYear: 2022 })] });
    expect(r.body.accepted).toBe(0);
    expect(JSON.stringify(r.body)).toContain('missing_provenance');
  });

  it('rejects uploads that are not real images', async () => {
    const admin = await signUp({ admin: true });
    const bad = await admin.post('/api/admin/uploads', { filename: 'x.png', dataBase64: Buffer.from('<script>alert(1)</script>').toString('base64') });
    expect(bad.status).toBe(400);
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const ok = await admin.post('/api/admin/uploads', { filename: 'fig.png', dataBase64: png.toString('base64') });
    expect(ok.status).toBe(201);
    expect(ok.body.path).toMatch(/^\/uploads\/[0-9a-f]{24}\.png$/);
    const learner = await signUp();
    expect((await learner.post('/api/admin/uploads', { filename: 'fig.png', dataBase64: png.toString('base64') })).status).toBe(403);
  });
});
