import { one, query, tx } from '../../db/pool.js';
import { hashPassword } from '../../lib/auth.js';

export async function createUser(email: string, password: string, displayName: string, role: 'learner' | 'admin' = 'learner') {
  const hash = await hashPassword(password);
  return tx(async (c) => {
    const u = await one('INSERT INTO users(email, password_hash, role) VALUES ($1,$2,$3) RETURNING id, email, role, created_at', [email, hash, role], c);
    await query('INSERT INTO user_profiles(user_id, display_name) VALUES ($1,$2)', [u!.id, displayName], c);
    return u!;
  });
}
