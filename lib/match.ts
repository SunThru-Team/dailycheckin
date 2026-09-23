import type { Priority, ResponseWithName } from './db';

const STOP = new Set(['the','a','an','and','or','of','to','for','in','on','with','by','at','from','is','are','be','this','that','our','we','it','as','up','new','get']);

function keywords(p: Priority): string[] {
  return `${p.title} ${p.description ?? ''}`
    .toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/, ''));
}

/**
 * Cheap, deterministic side-by-side matcher for the comparison view: which employees' recent
 * updates mention words from each priority. Good enough at this data volume; the chatbot handles
 * the nuanced version. Returns matches per priority with the sentences that hit.
 */
export function matchPrioritiesToUpdates(priorities: Priority[], updates: ResponseWithName[]) {
  return priorities.map((p) => {
    const kws = keywords(p);
    const byEmployee = new Map<string, { date: string; snippet: string }[]>();
    for (const u of updates) {
      const sentences = u.transcript.split(/(?<=[.!?])\s+/);
      const hits = sentences.filter((s) => { const l = s.toLowerCase(); return kws.some((k) => l.includes(k)); });
      if (hits.length) {
        const arr = byEmployee.get(u.employee_name) ?? [];
        arr.push({ date: u.date, snippet: hits.slice(0, 2).join(' ') });
        byEmployee.set(u.employee_name, arr);
      }
    }
    return { priority: p, keywords: kws, matches: [...byEmployee.entries()].map(([name, hits]) => ({ name, hits: hits.slice(0, 3) })) };
  });
}
