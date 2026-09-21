// Usage: DATABASE_URL=... npx tsx scripts/seed.ts "Jane Doe" +15551234567 jane@sunthru.co
import { randomBytes } from 'node:crypto';
import { makeSql } from '../lib/pg';

const [name, phone, email] = process.argv.slice(2);
if (!name || !phone) {
  console.error('Usage: tsx scripts/seed.ts "<name>" <E.164 phone> [email]');
  process.exit(1);
}
const sql = makeSql();

async function main() {
  const token = randomBytes(24).toString('base64url');
  const [row] = await sql`
    INSERT INTO employees (name, phone_number, email, access_token)
    VALUES (${name}, ${phone}, ${email ?? null}, ${token})
    RETURNING id, access_token`;
  const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';
  console.log(`Added employee #${row.id}. Their dashboard link:\n${base}/e/${row.access_token}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
