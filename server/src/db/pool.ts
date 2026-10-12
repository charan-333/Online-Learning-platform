import pg from 'pg';
import { databaseUrl } from '../config.js';

// numeric -> JS number (scores and marks are small, bounded values)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// int8 (count(*)) -> number
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// date -> 'YYYY-MM-DD' string, never shifted by timezone
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });

export type Db = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool) {
  return db.query<T>(text, params);
}

export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool): Promise<T | undefined> {
  const r = await db.query<T>(text, params);
  return r.rows[0];
}

export async function many<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const r = await db.query<T>(text, params);
  return r.rows;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
