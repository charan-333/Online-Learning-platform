import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { flushBackground } from '../src/lib/background.js';
import { outbox } from '../src/lib/mailer.js';
import { query } from '../src/db/pool.js';
import { app, correctAnswer, questionId, signUp } from './helpers.js';

describe('auth and security', () => {
  it('registers, rejects weak passwords and duplicate emails, and logs in/out', async () => {
    const weak = await request(app).post('/api/auth/register').send({ email: 'weak@test.local', password: 'short', displayName: 'W' });
    expect(weak.status).toBe(400);
    const c = await signUp();
    const dup = await request(app).post('/api/auth/register').send({ email: c.email, password: 'another long password', displayName: 'D' });
    expect(dup.status).toBe(409);
    const bad = await request(app).post('/api/auth/login').send({ email: c.email, password: 'wrong password here' });
    expect(bad.status).toBe(401);
    const me = await c.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(c.email);
    expect(me.body.profile.exam_year).toBeTypeOf('number');
    expect((await c.post('/api/auth/logout')).status).toBe(204);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('stores passwords as scrypt hashes, never plaintext', async () => {
    const c = await signUp();
    const row = (await query('SELECT password_hash FROM users WHERE id = $1', [c.id])).rows[0];
    expect(row.password_hash).toMatch(/^scrypt\$/);
    expect(row.password_hash).not.toContain('correct horse');
  });

  it('requires authentication for API routes', async () => {
    expect((await request(app).get('/api/questions')).status).toBe(401);
    expect((await request(app).get('/api/analytics/overview')).status).toBe(401);
  });

  it('rejects state-changing requests without the CSRF token', async () => {
    const c = await signUp();
    const r = await c.agent.post('/api/notes').send({ body: 'no token' });
    expect(r.status).toBe(403);
    const ok = await c.post('/api/notes', { body: 'with token' });
    expect(ok.status).toBe(201);
  });

  it('resets a password via a single-use emailed token and signs out other sessions', async () => {
    const c = await signUp();
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@test.local' });
    expect(unknown.status).toBe(200);
    const r = await request(app).post('/api/auth/forgot-password').send({ email: c.email });
    expect(r.body.message).toBe(unknown.body.message); // no account enumeration
    await flushBackground(); // the email is sent after the response
    const mail = [...outbox].reverse().find((m) => m.to === c.email)!;
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
    const reset = await request(app).post('/api/auth/reset-password').send({ token, password: 'a brand new password' });
    expect(reset.status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    const again = await request(app).post('/api/auth/reset-password').send({ token, password: 'yet another password' });
    expect(again.status).toBe(400);
    const login = await request(app).post('/api/auth/login').send({ email: c.email, password: 'a brand new password' });
    expect(login.status).toBe(200);
  });

  it('blocks learners from admin routes', async () => {
    const c = await signUp();
    expect((await c.get('/api/admin/questions')).status).toBe(403);
    expect((await c.post('/api/admin/questions/import', { items: [{}] })).status).toBe(403);
  });
});

describe('question bank and attempts', () => {
  it('lists published questions with filters and honest origin facets', async () => {
    const c = await signUp();
    const all = await c.get('/api/questions?pageSize=100');
    expect(all.status).toBe(200);
    expect(all.body.items.filter((q: any) => q.external_id.startsWith('c100-'))).toHaveLength(65);
    const qa = await c.get('/api/questions?section=QA&difficulty=easy&pageSize=100');
    expect(qa.body.items.every((q: any) => q.section_id === 'QA' && q.difficulty === 'easy')).toBe(true);
    const pyq = await c.get('/api/questions?origin=authentic_pyq');
    expect(pyq.body.total).toBe(0);
    const facets = await c.get('/api/questions/facets');
    expect(facets.body.origins.every((o: any) => o.origin !== 'authentic_pyq')).toBe(true);
    expect(facets.body.years).toEqual([]);
  });

  it('does not expose the answer or solution before an attempt', async () => {
    const c = await signUp();
    const id = await questionId('c100-qa-pct-001');
    const q = await c.get(`/api/questions/${id}`);
    expect(q.status).toBe(200);
    expect(JSON.stringify(q.body)).not.toMatch(/correct_answer|correctAnswer/);
    expect((await c.get(`/api/questions/${id}/solution`)).status).toBe(403);
    const hints = await c.get(`/api/questions/${id}/hints`);
    expect(hints.status).toBe(200);
  });

  it('records an attempt, updates mastery, logs errors, and filters by result', async () => {
    const c = await signUp();
    const id = await questionId('c100-qa-pct-001');
    const wrong = await c.post(`/api/questions/${id}/attempts`, { answer: 'A', timeTakenSec: 30, confidence: 3, mistakeType: 'conceptual_gap' });
    expect(wrong.status).toBe(201);
    expect(wrong.body.correct).toBe(false);
    expect(wrong.body.correctAnswer).toBe('B');
    expect(wrong.body.errorLogId).toBeTruthy();
    expect(wrong.body.mastery.state).toBe('learning');

    const sol = await c.get(`/api/questions/${id}/solution`);
    expect(sol.status).toBe(200);
    expect(sol.body.solution.learn_md).toBeTruthy();
    expect(sol.body.correct_answer).toBe('B');

    const errs = await c.get('/api/errors');
    expect(errs.body.items.some((e: any) => e.question_id === id && e.category === 'conceptual_gap')).toBe(true);

    const incorrect = await c.get('/api/questions?result=incorrect');
    expect(incorrect.body.items.map((q: any) => q.id)).toEqual([id]);
    const prev = await c.get('/api/questions?previouslyIncorrect=true');
    expect(prev.body.total).toBe(1);

    const right = await c.post(`/api/questions/${id}/attempts`, { answer: 'B', timeTakenSec: 25 });
    expect(right.body.correct).toBe(true);
    const hist = await c.get(`/api/questions/${id}/history`);
    expect(hist.body.items).toHaveLength(2);
    const corr = await c.get('/api/questions?result=correct');
    expect(corr.body.total).toBe(1);

    const reflect = await c.patch(`/api/questions/attempts/${wrong.body.attemptId}`, { understood: true, mistakeType: 'misread_question' });
    expect(reflect.status).toBe(200);
  });

  it('accepts TITA answers with formatting differences', async () => {
    const c = await signUp();
    const id = await questionId('c100-qa-pct-002');
    const ans = await correctAnswer('c100-qa-pct-002');
    const r = await c.post(`/api/questions/${id}/attempts`, { answer: ` ${ans} `, timeTakenSec: 60 });
    expect(r.body.correct).toBe(true);
  });

  it('records a reveal and excludes later attempts from mastery evidence', async () => {
    const c = await signUp();
    const id = await questionId('c100-qa-pct-001');
    expect((await c.get(`/api/questions/${id}/solution?reveal=true`)).status).toBe(200);
    await c.post(`/api/questions/${id}/attempts`, { answer: 'B', timeTakenSec: 10 });
    const h = await c.get(`/api/questions/${id}/history`);
    expect(h.body.items[0].solution_seen_first).toBe(true);
  });

  it('isolates learners from each other (no IDOR)', async () => {
    const a = await signUp();
    const b = await signUp();
    const id = await questionId('c100-qa-pct-001');
    const att = await a.post(`/api/questions/${id}/attempts`, { answer: 'A', timeTakenSec: 30 });
    const note = await a.post('/api/notes', { body: 'private note', questionId: id });
    expect((await b.patch(`/api/questions/attempts/${att.body.attemptId}`, { understood: true })).status).toBe(404);
    expect((await b.patch(`/api/notes/${note.body.id}`, { body: 'hijack' })).status).toBe(404);
    expect((await b.del(`/api/notes/${note.body.id}`)).status).toBe(404);
    expect((await b.get('/api/notes')).body.items).toHaveLength(0);
    expect((await b.get('/api/errors')).body.items).toHaveLength(0);
    expect((await b.patch(`/api/errors/${att.body.errorLogId}`, { rootCause: 'x' })).status).toBe(404);
    expect((await b.get(`/api/questions/${id}/history`)).body.items).toHaveLength(0);
  });

  it('bookmarks and notes round-trip', async () => {
    const c = await signUp();
    const id = await questionId('c100-qa-avg-001');
    expect((await c.post(`/api/questions/${id}/bookmark`)).status).toBe(201);
    expect((await c.get('/api/questions?bookmarked=true')).body.total).toBe(1);
    expect((await c.get('/api/bookmarks')).body.items[0].id).toBe(id);
    await c.del(`/api/questions/${id}/bookmark`);
    expect((await c.get('/api/bookmarks')).body.items).toHaveLength(0);

    const n = await c.post('/api/notes', { body: 'weighted average trick', topicId: 'qa-averages' });
    expect(n.status).toBe(201);
    expect((await c.post('/api/notes', { body: 'two links', topicId: 'qa-averages', questionId: id })).status).toBe(400);
    const found = await c.get('/api/notes?q=weighted');
    expect(found.body.items).toHaveLength(1);
    expect((await c.patch(`/api/notes/${n.body.id}`, { body: 'edited' })).body.body).toBe('edited');
    expect((await c.del(`/api/notes/${n.body.id}`)).status).toBe(204);
  });

  it('search finds topics, questions and formulas', async () => {
    const c = await signUp();
    const r = await c.get('/api/search?q=percentage');
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body).toLowerCase()).toContain('percent');
  });
});

describe('syllabus', () => {
  it('serves sections, topics, prerequisites and formulas', async () => {
    const c = await signUp();
    const s = await c.get('/api/sections');
    expect(s.body.items.map((x: any) => x.id).sort()).toEqual(['DILR', 'QA', 'VARC']);
    const t = await c.get('/api/topics?section=QA');
    expect(t.body.items.length).toBeGreaterThan(30);
    const pre = await c.get('/api/topics/qa-profit-loss/prerequisites');
    expect(pre.status).toBe(200);
    expect(JSON.stringify(pre.body)).toContain('qa-percentages');
    const f = await c.get('/api/formulas');
    expect(f.body.items.length).toBeGreaterThan(20);
  });
});

describe('account', () => {
  it('exports and deletes the account after password confirmation', async () => {
    const c = await signUp();
    const id = await questionId('c100-qa-pct-001');
    await c.post(`/api/questions/${id}/attempts`, { answer: 'B', timeTakenSec: 20 });
    const ex = await c.get('/api/account/export');
    expect(ex.status).toBe(200);
    expect(JSON.stringify(ex.body)).not.toContain('password_hash');
    expect((await c.del('/api/account', { password: 'wrong password', confirm: 'DELETE' })).status).toBe(400);
    expect((await c.del('/api/account', { password: 'correct horse battery', confirm: 'DELETE' })).status).toBe(204);
    const gone = await query('SELECT count(*)::int AS n FROM question_attempts WHERE user_id = $1', [c.id]);
    expect(gone.rows[0].n).toBe(0);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });
});
