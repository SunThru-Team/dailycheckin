import { notFound } from 'next/navigation';
import { EditWindow } from '@/components/EditWindow';
import { RescheduleForm } from '@/components/RescheduleForm';
import { ScheduleForm } from '@/components/ScheduleForm';
import { setMyTaskStatusAction } from './actions';
import {
  getEmployeeByToken, listMissedCallsNeedingAction, listPendingCallbacks,
  listResponsesForEmployee, listTasksForEmployee,
} from '@/lib/db';
import { ORG_TZ } from '@/lib/env';
import { fmtClock, fmtDate, fmtDateTime, fmtDays, tzLabel } from '@/lib/time';

export const dynamic = 'force-dynamic';

function localInputValue(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: ORG_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
}

const TASK_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In progress', done: 'Done' };

export default async function EmployeePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const emp = await getEmployeeByToken(token);
  if (!emp) notFound();

  const [responses, missed, pending, tasks] = await Promise.all([
    listResponsesForEmployee(emp.id), listMissedCallsNeedingAction(emp.id),
    listPendingCallbacks(emp.id), listTasksForEmployee(emp.id),
  ]);
  const now = Date.now();
  const latest = responses[0];
  const latestEditable = latest && new Date(latest.edit_locked_at).getTime() > now;
  const tz = tzLabel();

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

      {latestEditable && (
        <section style={{ marginBottom: '2rem' }}>
          <h2>Today&apos;s update</h2>
          <div className="panel">
            <p className="muted small">Recorded {fmtDateTime(latest.submitted_at)}</p>
            <EditWindow token={token} responseId={latest.id} transcript={latest.transcript}
              lockedAtISO={new Date(latest.edit_locked_at).toISOString()} />
          </div>
        </section>
      )}

      <section className="block" id="tasks">
        <h2>Your tasks <span className="count">{tasks.filter((t) => t.status !== 'done').length} open</span></h2>
        {tasks.length === 0 && <p className="muted">Nothing has been assigned to you yet.</p>}
        {tasks.map((t) => (
          <div key={t.id} className="entry">
            <div className="meta">
              {t.priority_title && <span>Priority: {t.priority_title}</span>}
              {t.due_date && <span>Due {fmtDate(t.due_date)}</span>}
              <span className={`chip ${t.status === 'done' ? 'ok' : t.status === 'in_progress' ? 'accent' : ''}`}>{TASK_LABEL[t.status]}</span>
            </div>
            <div className="body">{t.description}</div>
            <form action={setMyTaskStatusAction} className="actions">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="taskId" value={t.id} />
              {(['open', 'in_progress', 'done'] as const).filter((s) => s !== t.status).map((s) => (
                <button key={s} className="quiet" name="status" value={s} type="submit">Mark {TASK_LABEL[s].toLowerCase()}</button>
              ))}
            </form>
          </div>
        ))}
      </section>

      <section className="block" id="schedule">
        <h2>Your call schedule</h2>
        <div className="panel">
          <ScheduleForm token={token} days={emp.call_days} time={emp.call_time} tz={tz} />
        </div>
      </section>

      <section className="block">
        <h2>Past updates <span className="count">{responses.length}</span></h2>
        {responses.length === 0 && <p className="muted">No check-ins recorded yet. Your first call comes at your next scheduled time.</p>}
        {responses.filter((r) => !(latestEditable && r.id === latest.id)).map((r) => (
          <div key={r.id} className="entry">
            <div className="meta">
              <span>{fmtDateTime(r.submitted_at)}</span>
              {r.edited_at && <span>edited</span>}
            </div>
            <div className="body">{r.transcript}</div>
          </div>
        ))}
      </section>
    </main>
  );
}
