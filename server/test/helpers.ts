import request from 'supertest';
import { createApp } from '../src/app.js';
import { createUser } from '../src/modules/auth/service.js';
import { query } from '../src/db/pool.js';

export const app = createApp();
let counter = 0;

export interface Client {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  id: string;
  email: string;
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  del: (url: string, body?: object) => request.Test;
}

export async function signUp(opts: { admin?: boolean } = {}): Promise<Client> {
  const email = `user${Date.now()}${counter++}@test.local`;
  const password = 'correct horse battery';
  const agent = request.agent(app);
  if (opts.admin) {
    await createUser(email, password, 'Admin', 'admin');
  } else {
    const r = await agent.post('/api/auth/register').send({ email, password, displayName: 'Tester' });
    if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.body)}`);
  }
  const login = await agent.post('/api/auth/login').send({ email, password });
  const csrf = login.body.csrfToken;
  const c: Client = {
    agent,
    csrf,
    id: login.body.user.id,
    email,
    get: (u) => agent.get(u),
    post: (u, b) => agent.post(u).set('x-csrf-token', csrf).send(b ?? {}),
    put: (u, b) => agent.put(u).set('x-csrf-token', csrf).send(b ?? {}),
    patch: (u, b) => agent.patch(u).set('x-csrf-token', csrf).send(b ?? {}),
    del: (u, b) => agent.delete(u).set('x-csrf-token', csrf).send(b ?? {}),
  };
  return c;
}

export async function questionId(externalId: string): Promise<string> {
  const r = await query('SELECT id FROM questions WHERE external_id = $1', [externalId]);
  return r.rows[0].id;
}

export async function correctAnswer(externalId: string): Promise<string> {
  const r = await query('SELECT correct_answer FROM questions WHERE external_id = $1', [externalId]);
  return r.rows[0].correct_answer;
}
