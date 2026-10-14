import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { databaseUrl } from '../config.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

function migrationNames() {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.up.sql'))
    .map((f) => f.replace('.up.sql', ''))
    .sort();
}

/** Applies pending migrations in order, each inside its own transaction. `to` stops after that migration. */
export async function migrateUp(url = databaseUrl, opts: { to?: string } = {}) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const done: string[] = [];
    for (const name of migrationNames()) {
      if (opts.to && name > opts.to) break;
      if (applied.has(name)) continue;
      const sql = fs.readFileSync(path.join(dir, `${name}.up.sql`), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        done.push(name);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${name} failed: ${(e as Error).message}`);
      }
    }
    return done;
  } finally {
    await client.end();
  }
}

/** Rolls back the most recent migration. */
export async function migrateDown(url = databaseUrl) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const last = (await client.query('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')).rows[0]?.name;
    if (!last) return null;
    const sql = fs.readFileSync(path.join(dir, `${last}.down.sql`), 'utf8');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('DELETE FROM schema_migrations WHERE name = $1', [last]);
    await client.query('COMMIT');
    return last;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cmd = process.argv[2] ?? 'up';
  (cmd === 'down' ? migrateDown().then((n) => console.log(n ? `Rolled back ${n}` : 'Nothing to roll back')) : migrateUp().then((d) => console.log(d.length ? `Applied: ${d.join(', ')}` : 'Up to date'))).catch(
    (e) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}
