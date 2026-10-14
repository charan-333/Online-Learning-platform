import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from '../src/db/migrate.js';

/*
 * Applies migration 003 to a database holding data written under migration 002, and checks
 * that no learner data changes and that an old "authentic PYQ" goes back to review.
 * Uses its own throwaway database; all rows are test fixtures.
 */
const base = process.env.TEST_DATABASE_URL ?? 'postgres://cat100:cat100@localhost:5432/cat100_test';
const DB = 'cat100_migration_test';
const url = base.replace(/\/[^/]+$/, `/${DB}`);

async function admin(sql: string) {
  const c = new pg.Client({ connectionString: base });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

let db: pg.Client;
const ids: Record<string, string> = {};

const LEARNER_TABLES = ['users', 'user_profiles', 'question_attempts', 'user_topic_mastery', 'bookmarks', 'revision_items', 'mock_tests', 'mock_attempts', 'mock_test_questions', 'password_reset_tokens'];
async function snapshot() {
  const out: Record<string, unknown> = {};
  for (const t of LEARNER_TABLES) out[t] = (await db.query(`SELECT to_jsonb(x) - 'search' AS r FROM ${t} x ORDER BY to_jsonb(x)::text`)).rows.map((r) => r.r);
  return out;
}
/** Only the columns that existed under 002, so a later migration's new columns do not count as changes. */
async function snapshot002(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of LEARNER_TABLES) {
    const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [t])).rows.map((r) => r.column_name);
    out[t] = cols;
  }
  return out;
}

beforeAll(async () => {
  await admin(`DROP DATABASE IF EXISTS ${DB}`);
  await admin(`CREATE DATABASE ${DB}`);
  expect(await migrateUp(url, { to: '002_solution_reveals' })).toEqual(['001_init', '002_solution_reveals']);
  db = new pg.Client({ connectionString: url });
  await db.connect();
  const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
  await db.query("INSERT INTO sections(id, name, position) VALUES ('QA', 'Quantitative Aptitude', 3)");
  await db.query("INSERT INTO topics(id, section_id, area, name, position) VALUES ('qa-fixture', 'QA', 'Arithmetic', 'Fixture topic', 1)");
  ids.user = (await one("INSERT INTO users(email, password_hash) VALUES ('learner@fixture.test', 'x') RETURNING id")).id;
  await db.query('INSERT INTO user_profiles(user_id, display_name) VALUES ($1, $2)', [ids.user, 'Fixture learner']);
  ids.practice = (await one(
    `INSERT INTO questions(external_id, section_id, topic_id, question_type, difficulty, stem_md, correct_answer, estimated_time_sec, origin, source_verification, solution_verification, status)
     VALUES ('fx-mig-practice', 'QA', 'qa-fixture', 'TITA', 'easy', 'TEST FIXTURE practice question', '4', 60, 'original_practice', 'not_applicable', 'verified', 'published') RETURNING id`,
  )).id;
  // Stored as an "authentic PYQ" under the older rule (paper source only, no answer-key check).
  ids.pyq = (await one(
    `INSERT INTO questions(external_id, section_id, topic_id, question_type, difficulty, stem_md, correct_answer, estimated_time_sec, origin, exam_year, exam_slot, source_verification, solution_verification, status)
     VALUES ('fx-mig-pyq', 'QA', 'qa-fixture', 'TITA', 'medium', 'TEST FIXTURE old PYQ row', '7', 60, 'authentic_pyq', 2022, 1, 'verified', 'verified', 'published') RETURNING id`,
  )).id;
  await db.query("INSERT INTO question_sources(question_id, source_name, reference) VALUES ($1, 'Fixture paper', 'Fixture Q1')", [ids.pyq]);
  for (const q of [ids.practice, ids.pyq]) {
    await db.query('INSERT INTO question_attempts(user_id, question_id, answer, is_correct, time_taken_sec) VALUES ($1, $2, $3, $4, 42)', [ids.user, q, '4', q === ids.practice]);
  }
  await db.query("INSERT INTO user_topic_mastery(user_id, topic_id, score, state, attempts_count, correct_count) VALUES ($1, 'qa-fixture', 37.5, 'learning', 2, 1)", [ids.user]);
  await db.query('INSERT INTO bookmarks(user_id, question_id) VALUES ($1, $2)', [ids.user, ids.pyq]);
  await db.query("INSERT INTO revision_items(user_id, item_type, ref_id, topic_id, due_at) VALUES ($1, 'question', $2, 'qa-fixture', now() + interval '1 day')", [ids.user, ids.pyq]);
  ids.config = (await one("INSERT INTO exam_configs(year, name, total_duration_min) VALUES (2024, 'Fixture pattern', 120) RETURNING id")).id;
  await db.query("INSERT INTO exam_config_sections VALUES ($1, 'QA', 1, 40, 22, 3, -1, 3, 0)", [ids.config]);
  ids.test = (await one("INSERT INTO mock_tests(owner_id, title, kind, exam_config_id) VALUES ($1, 'Fixture test', 'sectional', $2) RETURNING id", [ids.user, ids.config])).id;
  const sec = await one("INSERT INTO mock_test_sections(mock_test_id, section_id, position, duration_sec) VALUES ($1, 'QA', 1, 2400) RETURNING id", [ids.test]);
  await db.query('INSERT INTO mock_test_questions VALUES ($1, $2, 1, 3, 0)', [sec.id, ids.practice]);
  await db.query("INSERT INTO mock_attempts(mock_test_id, user_id, status, submitted_at, submit_reason, raw_score) VALUES ($1, $2, 'submitted', now(), 'manual', 3)", [ids.test, ids.user]);
  await db.query("INSERT INTO password_reset_tokens(user_id, token_hash, expires_at) VALUES ($1, 'fixture-hash', now() + interval '1 hour')", [ids.user]);
});

afterAll(async () => {
  await db?.end();
  await admin(`DROP DATABASE IF EXISTS ${DB}`);
});

describe('migration 003 on existing data', () => {
  let before: Record<string, unknown>;
  let columns002: Record<string, unknown[]>;

  it('applies without changing any learner data', async () => {
    before = await snapshot();
    columns002 = await snapshot002();
    expect(await migrateUp(url)).toEqual(['003_provenance_exam_versions_email']);
    const after = await snapshot();
    for (const t of LEARNER_TABLES) {
      const strip = (rows: any) => rows.map((r: any) => Object.fromEntries(Object.entries(r).filter(([k]) => (columns002[t] as string[]).includes(k))));
      expect(strip(after[t]), t).toEqual(before[t]);
    }
  });

  it('keeps practice questions as they were and sends the old PYQ back to review with an audit record', async () => {
    const rows = (await db.query('SELECT external_id, origin, status, review_status, source_verification, answer_key_verification, exam_year FROM questions ORDER BY external_id')).rows;
    expect(rows).toEqual([
      { external_id: 'fx-mig-practice', origin: 'original_practice', status: 'published', review_status: 'not_required', source_verification: 'not_applicable', answer_key_verification: 'not_applicable', exam_year: null },
      { external_id: 'fx-mig-pyq', origin: 'authentic_pyq', status: 'unpublished', review_status: 'pending', source_verification: 'verified', answer_key_verification: 'unverified', exam_year: 2022 },
    ]);
    const audit = (await db.query("SELECT action, details FROM audit_logs WHERE entity_id = $1", [ids.pyq])).rows;
    expect(audit).toEqual([{ action: 'question.review_required', details: expect.objectContaining({ previous_status: 'published' }) }]);
    // The database now refuses to publish it until it is approved with a verified answer key.
    await expect(db.query("UPDATE questions SET status = 'published' WHERE id = $1", [ids.pyq])).rejects.toThrow(/questions_published_pyq_verified/);
    const sources = (await db.query('SELECT kind FROM question_sources WHERE question_id = $1', [ids.pyq])).rows;
    expect(sources).toEqual([{ kind: 'question_paper' }]);
  });

  it('turns the stored exam pattern into active version 1 and keeps tests linked to it', async () => {
    const cfg = (await db.query('SELECT year, version, is_active, field_status FROM exam_configs')).rows;
    expect(cfg).toEqual([{ year: 2024, version: 1, is_active: true, field_status: {} }]);
    expect((await db.query('SELECT exam_config_id FROM mock_tests WHERE id = $1', [ids.test])).rows[0].exam_config_id).toBe(ids.config);
    await expect(db.query("INSERT INTO exam_configs(year, version, name, total_duration_min, is_active) VALUES (2025, 1, 'x', 120, true)")).rejects.toThrow(/exam_configs_one_active/);
  });

  it('rolls back and re-applies cleanly with learner data intact', async () => {
    expect(await migrateDown(url)).toBe('003_provenance_exam_versions_email');
    const down = await snapshot();
    expect(down.question_attempts).toEqual(before.question_attempts);
    expect(down.mock_attempts).toEqual(before.mock_attempts);
    expect(down.revision_items).toEqual(before.revision_items);
    expect(await migrateUp(url)).toEqual(['003_provenance_exam_versions_email']);
    const again = (await db.query('SELECT count(*)::int AS n FROM question_attempts')).rows[0].n;
    expect(again).toBe(2);
  });
});
