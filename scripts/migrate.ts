import { readFileSync } from 'node:fs';
import { makeSql } from '../lib/pg';

const sql = makeSql();

async function main() {
  const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await sql.unsafe(schema);
  console.log('Schema applied.');
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
