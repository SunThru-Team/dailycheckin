import { ORG_TZ } from './env';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_NAMES = DOW;

function parts(d: Date) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: ORG_TZ, hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { y: g('year'), m: g('month'), d: g('day'), h: Number(g('hour')) % 24, min: Number(g('minute')), wd: g('weekday') };
}

/** Org-local "now": date string, day-of-week (0=Sun), minutes since midnight. */
export function orgNow(d: Date = new Date()) {
  const p = parts(d);
  return { date: `${p.y}-${p.m}-${p.d}`, dow: DOW.indexOf(p.wd), minutes: p.h * 60 + p.min };
}

/** YYYY-MM-DD for a moment, in the organization's time zone. */
export const orgDate = (d: Date = new Date()) => orgNow(d).date;

export const isWeekday = (d: Date = new Date()) => { const w = orgNow(d).dow; return w >= 1 && w <= 5; };

/** 'HH:MM[:SS]' → minutes since midnight. */
export const timeToMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

/** 'HH:MM:SS' → '8:00 AM'. */
export function fmtClock(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function fmtDays(days: number[]) {
  const s = [...days].sort();
  if (s.join() === '1,2,3,4,5') return 'Weekdays';
  if (s.join() === '0,1,2,3,4,5,6') return 'Every day';
  if (s.length === 0) return 'Never';
  return s.map((d) => DOW[d]).join(', ');
}

export function fmtDateTime(d: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ORG_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(d));
}

export function fmtDate(d: Date | string): string {
  const s = typeof d === 'string' ? d : orgDate(d);
  const [y, m, day] = s.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, day)));
}

export function fmtTime(d: Date | string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: ORG_TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(d));
}

export function tzLabel() {
  return new Intl.DateTimeFormat('en-US', { timeZone: ORG_TZ, timeZoneName: 'short' })
    .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? ORG_TZ;
}
