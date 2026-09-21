import { ORG_TZ } from './env';

/** YYYY-MM-DD for a moment, in the organization's time zone. */
export function orgDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ORG_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

export function fmtDateTime(d: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ORG_TZ, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(d));
}

export function fmtDate(d: Date | string): string {
  // DATE columns come back as 'YYYY-MM-DD' strings; treat them as calendar dates, not instants.
  const s = typeof d === 'string' ? d : orgDate(d);
  const [y, m, day] = s.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, day)));
}

export function fmtTime(d: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ORG_TZ, hour: 'numeric', minute: '2-digit',
  }).format(new Date(d));
}

export function isWeekday(d: Date = new Date()): boolean {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: ORG_TZ, weekday: 'short' }).format(d);
  return !['Sat', 'Sun'].includes(wd);
}
