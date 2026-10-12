import pg from 'pg';
import { databaseUrl } from '../config.js';

/**
 * Drops and recreates the public schema. Refuses to run unless the database name
 * ends in _test or _e2e, so it cannot wipe a development or production database.
 */
async function main() {
  const name = new URL(databaseUrl).pathname.slice(1);
  if (!/_(test|e2e)$/.test(name)) throw new Error(`Refusing to reset database "${name}": only *_test or *_e2e databases can be reset.`);
  const c = new pg.Client({ connectionString: databaseUrl });
  await c.connect();
  await c.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await c.end();
  console.log(`Reset ${name}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
