import { timingSafeEqual } from 'node:crypto';
import { env } from './env';

export function isAdminToken(token: string): boolean {
  const expected = env('ADMIN_TOKEN');
  const a = Buffer.from(token), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vercel Cron sends Authorization: Bearer <CRON_SECRET>. */
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  return req.headers.get('authorization') === `Bearer ${secret}`;
}
