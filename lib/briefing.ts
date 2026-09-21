// Generate (and optionally place) a CEO briefing for a given org date and schedule slot.
import { generateDailySummary } from './ai';
import {
  latestCeoCallOn, listActiveEmployees, listResponsesForDate, listResponsesSince, setCeoCallSid, upsertCeoCall,
} from './db';
import { fmtClock, fmtDate } from './time';
import { placeCeoCall } from './twilio';

export async function runBriefing(dateISO: string, slot: string, opts: { call: boolean }) {
  // If there was already a briefing earlier today, only cover what's come in since.
  const previous = await latestCeoCallOn(dateISO);
  const responses = previous ? await listResponsesSince(previous.generated_at) : await listResponsesForDate(dateISO);
  const allToday = previous ? await listResponsesForDate(dateISO) : responses;

  const responded = new Set(allToday.map((r) => r.employee_id));
  const missed = (await listActiveEmployees()).filter((e) => !responded.has(e.id)).map((e) => e.name);

  const label = `${fmtDate(dateISO)}${previous ? `, since the ${fmtClock(previous.slot)} briefing` : ''}`;
  const summary = await generateDailySummary(
    label,
    responses.map((r) => ({ employeeName: r.employee_name, transcript: r.transcript })),
    previous ? [] : missed, // don't nag about absentees twice a day
  );
  const row = await upsertCeoCall(dateISO, slot, summary);
  if (!opts.call) return { row, called: false as const };

  try {
    const sid = await placeCeoCall(row.id);
    await setCeoCallSid(row.id, sid, 'queued');
    return { row, called: true as const, sid };
  } catch (err) {
    await setCeoCallSid(row.id, null, 'failed');
    return { row, called: false as const, error: (err as Error).message };
  }
}
