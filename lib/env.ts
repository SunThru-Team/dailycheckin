export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing environment variable ${name}`);
  return v;
}
export const ORG_TZ = process.env.ORG_TIMEZONE ?? 'America/New_York';
export const EDIT_WINDOW_MINUTES = 20;
