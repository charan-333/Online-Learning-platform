import { pool } from '../db/pool.js';
import { migrateUp } from '../db/migrate.js';
import { ensureCat2024Pattern, seedAll } from './seed.js';
import { createUser } from '../modules/auth/service.js';
import { one, tx } from '../db/pool.js';

// --if-empty: used on every production start. Applies migrations, seeds reference content
// only into an empty database, and creates the admin account if it does not exist yet.
const ifEmpty = process.argv.includes('--if-empty');

async function main() {
  const applied = await migrateUp();
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
  const seeded = await one('SELECT 1 FROM topics LIMIT 1');
  if (ifEmpty && seeded) {
    console.log('Content already present; skipped seeding.');
    await tx((c) => ensureCat2024Pattern(c)); // attaches pattern sources added after the first deploy
  } else await seedAll();
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    const existing = await one('SELECT id FROM users WHERE email = $1', [email]);
    if (!existing) {
      await createUser(email, password, 'Admin', 'admin');
      console.log(`Created admin ${email}`);
    }
  } else {
    console.log('No SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD set; skipped admin creation.');
  }
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
