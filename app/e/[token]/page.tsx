import { notFound } from 'next/navigation';
import { RescheduleForm } from '@/components/RescheduleForm';
import { ScheduleForm } from '@/components/ScheduleForm';
import { EmployeeTask } from '@/components/TaskNotes';
import { getEmployeeByToken, listMissedCallsNeedingAction, listPendingCallbacks, listResponsesForEmployee } from '@/lib/db';
import { viewerFor } from '@/lib/access';
import { latestPublishedNote, listNotesVisible, listTasksVisible } from '@/lib/tasks';
import { ORG_TZ } from '@/lib/env';
import { fmtClock, fmtDateTime, fmtDays, tzLabel } from '@/lib/time';

export const dynamic = 'force-dynamic';

function localInputValue(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: ORG_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
}

export default async function EmployeePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const emp = await getEmployeeByToken(token);
  if (!emp) notFound();

  const viewer = viewerFor(emp);
  const [responses, missed, pending, tasks, note] = await Promise.all([
    listResponsesForEmployee(emp.id), listMissedCallsNeedingAction(emp.id),
    listPendingCallbacks(emp.id), listTasksVisible(viewer, { assignedTo: emp.id }), latestPublishedNote(emp.id),
  ]);
  // Notes are fetched through the same visibility filter as the tasks themselves.
  const notesByTask = new Map(await Promise.all(
    tasks.map(async (t) => [t.id, await listNotesVisible(viewer, t.id)] as const),
  ));
  const now = Date.now();
  const tz = tzLabel();
  const openCount = tasks.filter((t) => t.status !== 'done').length;

  return (
    <main className="page">
      <header className="top">
        <h1>{emp.name}</h1>
        <p className="who">
          {emp.call_days.length
            ? <>We call you at {fmtClock(emp.call_time)}, {fmtDays(emp.call_days).toLowerCase()}.</>
            : <>Your check-in calls are paused.</>}{' '}
          <a href="#schedule">Change</a>
        </p>
      </header>

      {note && (
        <section className="from-john">
          <h2>From John</h2>
          <p className="briefing" style={{ fontSize: '1.15rem' }}>{note.body}</p>
        </section>
      )}

      {missed.length > 0 && (
        <section style={{ marginBottom: '2rem' }}>
          {missed.map((c) => (
            <div key={c.id} className="notice">
              <p><strong>We couldn&apos;t reach you {fmtDateTime(c.scheduled_at)}.</strong> Pick a time and we&apos;ll call again.</p>
              <RescheduleForm token={token} callId={c.id}
                minLocal={localInputValue(new Date(now + 15 * 60000))}
                maxLocal={localInputValue(new Date(now + 3 * 86400000))}
                tzLabel={tz} />
            </div>
          ))}
        </section>
      )}

      {pending.map((c) => (
        <div key={c.id} className="notice ok">A callback is scheduled for {fmtDateTime(c.scheduled_callback_at!)}.</div>
      ))}

      <section className="block" id="tasks">
        <h2>Your tasks <span className="count">{openCount} open</span></h2>
        {tasks.length === 0 && <p className="muted">Nothing has been assigned to you yet.</p>}
        {tasks.map((t) => <EmployeeTask key={t.id} token={token} task={t} notes={notesByTask.get(t.id) ?? []} />)}
      </section>

      <section className="block" id="schedule">
        <h2>Your call schedule</h2>
        <div className="panel">
          <ScheduleForm token={token} days={emp.call_days} time={emp.call_time} tz={tz} />
        </div>
      </section>

      <section className="block">
        <h2>Your check-ins <span className="count">{responses.length}</span></h2>
        <p className="muted small">These are recorded as spoken and can&apos;t be edited.</p>
        {responses.length === 0 && <p className="muted">No check-ins recorded yet. Your first call comes at your next scheduled time.</p>}
        {responses.map((r) => (
          <div key={r.id} className="entry">
            <div className="meta"><span>{fmtDateTime(r.submitted_at)}</span></div>
            <div className="body">{r.transcript}</div>
          </div>
        ))}
      </section>
    </main>
  );
}
