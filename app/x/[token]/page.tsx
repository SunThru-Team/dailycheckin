import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PriorityChat } from '@/components/PriorityChat';
import { ScheduleFields } from '@/components/ScheduleFields';
import {
  addCeoScheduleAction, archivePriorityAction, createPriorityAction, createTaskAction, deleteTaskAction,
  removeCeoScheduleAction, setEmployeeScheduleAction, setTaskStatusAction, updatePriorityAction,
} from './actions';
import { isAdminToken } from '@/lib/auth';
import {
  getPriorities, getRecentResponses, listActiveEmployees, listCeoCalls, listCeoSchedules, listResponseDates, listTasks,
} from '@/lib/db';
import { matchPrioritiesToUpdates } from '@/lib/match';
import { DAY_NAMES, fmtClock, fmtDate, fmtDays, orgDate, tzLabel } from '@/lib/time';

export const dynamic = 'force-dynamic';

const TASK_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In progress', done: 'Done' };

export default async function ExecPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isAdminToken(token)) notFound();

  const [briefings, dates, priorities, tasks, employees, recent, ceoSchedules] = await Promise.all([
    listCeoCalls(30), listResponseDates(30), getPriorities(), listTasks(), listActiveEmployees(), getRecentResponses(14), listCeoSchedules(),
  ]);
  const tz = tzLabel();
  const today = orgDate();
  const latest = briefings[0];
  const todayCount = dates.find((d) => d.date === today)?.count ?? 0;
  const comparison = matchPrioritiesToUpdates(priorities, recent);
  const base = `/x/${token}`;

  return (
    <main className="page wide">
      <header className="top">
        <h1>Team briefing</h1>
        <p className="who">
          {fmtDate(today)} — {todayCount} of {employees.length} check-ins in so far.{' '}
          {todayCount > 0 && <Link href={`${base}/day/${today}`}>Read today&apos;s transcripts</Link>}
        </p>
        <nav className="jump">
          <a href="#briefing">Briefing</a><a href="#priorities">Priorities</a><a href="#tasks">Tasks</a>
          <a href="#compare">Priorities vs. reported work</a><a href="#ask">Ask</a><a href="#schedule">Schedule</a><a href="#history">History</a>
        </nav>
      </header>

      <div className="two-col">
        <div>
          <section id="briefing">
            {latest ? (
              <>
                <div className="briefing-date">
                  {fmtClock(latest.slot)} briefing, {fmtDate(latest.call_date)}
                  {latest.status && <> — call {latest.status}</>}
                  {' '}<Link href={`${base}/day/${latest.call_date}`}>transcripts</Link>
                </div>
                <div className="briefing">{latest.summary_text}</div>
              </>
            ) : (
              <p className="muted">No briefing yet. The first one is generated at the end of the first weekday with check-ins, and will appear here as well as being read to you by phone.</p>
            )}
          </section>

          <section className="block" id="compare">
            <h2>Priorities vs. reported work <span className="count">last 14 days</span></h2>
            {priorities.length === 0 && <p className="muted">Add a priority to see who has reported work on it.</p>}
            <div className="compare">
              {comparison.map(({ priority, matches }) => (
                <div key={priority.id} className="row2">
                  <div>
                    <h3>{priority.title}</h3>
                    {priority.deadline && <div className="muted small">Deadline {fmtDate(priority.deadline)}</div>}
                    {priority.description && <div className="small" style={{ marginTop: '.25rem' }}>{priority.description}</div>}
                  </div>
                  <div>
                    {matches.length === 0
                      ? <p className="muted small">No check-in in the last two weeks mentions this. Worth asking about.</p>
                      : matches.map((m) => (
                        <p key={m.name} className="hit">
                          <span className="name">{m.name}</span>
                          {m.hits.map((h, i) => <span key={i}> <span className="muted">({fmtDate(h.date)})</span> {h.snippet}</span>)}
                        </p>
                      ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="muted small" style={{ marginTop: '.75rem' }}>Matches are by keyword from the priority title and description. For judgement calls, ask below.</p>
          </section>

          <section className="block" id="ask">
            <h2>Ask about alignment</h2>
            <PriorityChat token={token} />
          </section>

          <section className="block" id="schedule">
            <h2>Call schedule <span className="count">{tz}</span></h2>
            <div className="table-wrap">
              <table className="sched">
                <thead>
                  <tr><th>Employee</th><th>Time</th>{DAY_NAMES.map((d) => <th key={d} style={{ textAlign: 'center' }}>{d}</th>)}<th></th></tr>
                </thead>
                <tbody>
                  {employees.map((e) => (
                    <tr key={e.id}>
                      <td>{e.name}</td>
                      <td>{e.call_days.length ? fmtClock(e.call_time) : <span className="muted">paused</span>}</td>
                      {DAY_NAMES.map((_, i) => <td key={i} className={`day ${e.call_days.includes(i) ? 'on' : 'off'}`} />)}
                      <td>
                        <details className="inline">
                          <summary>Edit</summary>
                          <form action={setEmployeeScheduleAction} className="stack" style={{ padding: '.5rem 0' }}>
                            <input type="hidden" name="token" value={token} />
                            <input type="hidden" name="employeeId" value={e.id} />
                            <ScheduleFields days={e.call_days} time={e.call_time} />
                            <div><button className="primary" type="submit">Save</button></div>
                          </form>
                        </details>
                      </td>
                    </tr>
                  ))}
                  {employees.length === 0 && <tr><td colSpan={10} className="muted">No employees yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="muted small" style={{ marginTop: '.6rem' }}>Employees can change their own days and time from their dashboard.</p>

            <h3 style={{ marginTop: '1.75rem' }}>Your briefing calls</h3>
            <p className="muted small">Each slot summarizes the check-ins that have come in since the previous briefing that day.</p>
            {ceoSchedules.map((s) => (
              <div key={s.id} className="entry" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                <div><strong>{fmtClock(s.call_time)}</strong> <span className="muted">{fmtDays(s.days)}</span></div>
                <form action={removeCeoScheduleAction}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="id" value={s.id} />
                  <button className="quiet danger" type="submit">Remove</button>
                </form>
              </div>
            ))}
            {ceoSchedules.length === 0 && <p className="muted">No briefing calls scheduled. You&apos;ll still see briefings here if you generate them manually.</p>}
            <form action={addCeoScheduleAction} className="stack panel" style={{ marginTop: '1rem' }}>
              <input type="hidden" name="token" value={token} />
              <h3>Add a briefing call</h3>
              <ScheduleFields days={[1, 2, 3, 4, 5]} time="18:00" />
              <div><button className="primary" type="submit">Add briefing call</button></div>
            </form>
          </section>

          <section className="block" id="history">
            <h2>Past briefings <span className="count">{briefings.length}</span></h2>
            {briefings.slice(1).map((b) => (
              <details key={b.id} className="inline entry">
                <summary>{fmtDate(b.call_date)}, {fmtClock(b.slot)}{b.status ? ` — call ${b.status}` : ''} </summary>
                <div className="briefing" style={{ fontSize: '1.05rem' }}>{b.summary_text}</div>
                <p className="small" style={{ marginTop: '.5rem' }}><Link href={`${base}/day/${b.call_date}`}>Transcripts for this day</Link></p>
              </details>
            ))}
            {dates.filter((d) => !briefings.some((b) => b.call_date === d.date)).length > 0 && (
              <p className="muted small" style={{ marginTop: '1rem' }}>
                Days with check-ins but no briefing yet:{' '}
                {dates.filter((d) => !briefings.some((b) => b.call_date === d.date)).map((d, i) => (
                  <span key={d.date}>{i > 0 && ', '}<Link href={`${base}/day/${d.date}`}>{fmtDate(d.date)}</Link></span>
                ))}
              </p>
            )}
          </section>
        </div>

        <aside>
          <section id="priorities">
            <h2>Priorities <span className="count">{priorities.length}</span></h2>
            {priorities.map((p) => (
              <div key={p.id} className="entry">
                <h3>{p.title}</h3>
                <div className="meta">
                  {p.deadline ? <span>Deadline {fmtDate(p.deadline)}</span> : <span>No deadline</span>}
                  <span>{tasks.filter((t) => t.priority_id === p.id && t.status !== 'done').length} open tasks</span>
                </div>
                {p.description && <div className="small">{p.description}</div>}
                <details className="inline" style={{ marginTop: '.4rem' }}>
                  <summary>Edit</summary>
                  <form action={updatePriorityAction} className="stack">
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="id" value={p.id} />
                    <label>Title<input name="title" defaultValue={p.title} required /></label>
                    <label>Description<textarea name="description" defaultValue={p.description ?? ''} style={{ minHeight: '4rem' }} /></label>
                    <label>Deadline<input type="date" name="deadline" defaultValue={p.deadline ?? ''} /></label>
                    <div className="actions">
                      <button className="primary" type="submit">Save changes</button>
                      <button className="quiet danger" formAction={archivePriorityAction} type="submit">Archive</button>
                    </div>
                  </form>
                </details>
              </div>
            ))}
            <form action={createPriorityAction} className="stack panel" style={{ marginTop: '1rem' }}>
              <input type="hidden" name="token" value={token} />
              <h3>Add a priority</h3>
              <label>Title<input name="title" required placeholder="e.g. Ship SOMA50 press commissioning" /></label>
              <label>Description<textarea name="description" style={{ minHeight: '4rem' }} placeholder="What done looks like" /></label>
              <label>Deadline<input type="date" name="deadline" /></label>
              <button className="primary" type="submit">Add priority</button>
            </form>
          </section>

          <section className="block" id="tasks">
            <h2>Delegated tasks <span className="count">{tasks.filter((t) => t.status !== 'done').length} open</span></h2>
            {tasks.map((t) => (
              <div key={t.id} className="entry">
                <div className="meta">
                  <span>{t.assignee_name ?? 'Unassigned'}</span>
                  {t.priority_title && <span>{t.priority_title}</span>}
                  {t.due_date && <span>Due {fmtDate(t.due_date)}</span>}
                  <span className={`chip ${t.status === 'done' ? 'ok' : t.status === 'in_progress' ? 'accent' : ''}`}>{TASK_LABEL[t.status]}</span>
                </div>
                <div className="body">{t.description}</div>
                <form action={setTaskStatusAction} className="actions">
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="taskId" value={t.id} />
                  {(['open', 'in_progress', 'done'] as const).filter((s) => s !== t.status).map((s) => (
                    <button key={s} className="quiet" name="status" value={s} type="submit">Mark {TASK_LABEL[s].toLowerCase()}</button>
                  ))}
                  <button className="quiet danger" formAction={deleteTaskAction} type="submit">Delete</button>
                </form>
              </div>
            ))}
            <form action={createTaskAction} className="stack panel" style={{ marginTop: '1rem' }}>
              <input type="hidden" name="token" value={token} />
              <h3>Delegate a task</h3>
              <label>Task<textarea name="description" required style={{ minHeight: '4rem' }} placeholder="What needs doing" /></label>
              <label>Assign to
                <select name="assignedTo" defaultValue="">
                  <option value="">Unassigned</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </label>
              <label>Under priority
                <select name="priorityId" defaultValue="">
                  <option value="">None</option>
                  {priorities.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </label>
              <label>Due<input type="date" name="dueDate" /></label>
              <button className="primary" type="submit">Add task</button>
            </form>
          </section>
        </aside>
      </div>
    </main>
  );
}
