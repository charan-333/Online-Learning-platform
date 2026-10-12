import { query, type Db, pool } from '../db/pool.js';

export async function audit(actorId: string | null, action: string, entityType: string, entityId: string | null, details: object = {}, db: Db = pool) {
  await query('INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)', [actorId, action, entityType, entityId, details], db);
}
