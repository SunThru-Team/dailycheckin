import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAdminToken } from '@/lib/auth';
import { listCallableEmployees, listCeoCalls, listResponsesForDate } from '@/lib/db';
import { fmtClock, fmtDate, fmtTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function DayPage({ params }: { params: Promise<{ token: string; date: string }> }) {
  const { token, date } = await params;
  if (!isAdminToken(token) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const [responses, employees, briefings] = await Promise.all([
    listResponsesForDate(date), listCallableEmployees(), listCeoCalls(60),
  ]);
  const dayBriefings = briefings.filter((b) => b.call_date === date).sort((a, b) => a.slot.localeCompare(b.slot));
  const responded = new Set(responses.map((r) => r.employee_id));
  const missing = employees.filter((e) => !responded.has(e.id));

  return (
    <>
      <header className="top">
        <p className="small"><Link href={`/x/${token}`}>← Briefing</Link></p>
        <h2 style={{ fontFamily: "var(--serif)", fontSize: "1.6rem", fontWeight: 500 }}>{fmtDate(date)}</h2>
        <p className="who">{responses.length} check-in{responses.length === 1 ? '' : 's'}{missing.length > 0 && <> — no response from {missing.map((e) => e.name).join(', ')}</>}</p>
      </header>

      {dayBriefings.map((b) => (
        <section key={b.id} style={{ marginBottom: '1.5rem' }}>
          <div className="briefing-date">{fmtClock(b.slot)} briefing{b.status ? ` — call ${b.status}` : ''}</div>
          <div className="briefing">{b.summary_text}</div>
        </section>
      ))}

      <section className="block">
        <h2>Transcripts</h2>
        {responses.length === 0 && <p className="muted">No check-ins were recorded on this day.</p>}
        {responses.map((r) => (
          <div key={r.id} className="entry">
            <div className="meta"><strong style={{ color: 'var(--ink)' }}>{r.employee_name}</strong><span>{fmtTime(r.submitted_at)}</span>{r.edited_at && <span>edited by employee</span>}</div>
            <div className="body">{r.transcript}</div>
          </div>
        ))}
      </section>
    </>
  );
}
