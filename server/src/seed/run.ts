import { pool } from '../db/pool.js';
import { migrateUp } from '../db/migrate.js';
import { seedAll } from './seed.js';
import { createUser } from '../modules/auth/service.js';
import { one } from '../db/pool.js';

async function main() {
  await migrateUp();
  await seedAll();
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
