import postgres from 'postgres';

/** SSL is required by every managed provider; allow ?sslmode=disable for local dev only. */
export function makeSql(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set');
  const ssl = /sslmode=disable/.test(url) ? false : 'require';
  return postgres(url, { ssl, max: 5, idle_timeout: 20 });
}
