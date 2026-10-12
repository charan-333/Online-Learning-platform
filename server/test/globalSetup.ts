import pg from 'pg';

/** Recreates the test database schema from migrations and seeds reference + sample content. */
export default async function setup() {
  process.env.NODE_ENV = 'test';
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://cat100:cat100@localhost:5432/cat100_test';
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  const { migrateUp, migrateDown } = await import('../src/db/migrate.js');
  await migrateUp(url);
  // Exercise rollback once so the down migrations stay valid, then re-apply.
  await migrateDown(url);
  await migrateDown(url);
  await migrateUp(url);
  const { seedAll } = await import('../src/seed/seed.js');
  await seedAll();
  const { pool } = await import('../src/db/pool.js');
  await pool.end();
}
