import Link from 'next/link';
import { ScheduleFields } from '@/components/ScheduleFields';
import { PriorityChat } from '@/components/PriorityChat';
import {
  addCeoScheduleAction, removeCeoScheduleAction, setBriefingCallAction, setEmployeeScheduleAction,
} from './actions';
import {
  getRecentResponses, listCallableEmployees, listCeoCalls, listCeoSchedules, listResponseDates,
} from '@/lib/db';
import { listPriorities, listTasksVisible } from '@/lib/tasks';
import { matchPrioritiesToUpdates } from '@/lib/match';
import { DAY_NAMES, fmtClock, fmtDate, fmtDays, orgDate, tzLabel } from '@/lib/time';

export const dynamic = 'force-dynamic';
const CEO = { kind: 'ceo' } as const;

export default async function BriefingTab({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [briefings, dates, priorities, tasks, employees, recent, ceoSchedules] = await Promise.all([
    listCeoCalls(30), listResponseDates(30), listPriorities(), listTasksVisible(CEO),
    listCallableEmployees(), getRecentResponses(14), listCeoSchedules(),
  ]);
  const tz = tzLabel();
  const today = orgDate();
  const latest = briefings[0];
  const todayCount = dates.find((d) => d.date === today)?.count ?? 0;
  const comparison = matchPrioritiesToUpdates(
    priorities.map((p) => ({ id: p.id, title: p.title, description: p.description, deadline: p.deadline, archived: false, created_at: new Date() })),
    recent,
  );
  const callsOn = ceoSchedules.some((s) => s.briefing_call_enabled);
  const base = `/x/${token}`;

  return (
    <div className="two-col">
      <div>
        <section>
          <p className="who muted">
            {fmtDate(today)} — {todayCount} of {employees.length} check-ins in so far.{' '}
            {todayCount > 0 && <Link href={`${base}/day/${today}`}>Read today&apos;s transcripts</Link>}
          </p>
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
            <p className="muted">No briefing yet. The first one is generated at the end of the first day with check-ins.</p>
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
                  <div className="muted small">{tasks.filter((t) => t.priority_id === priority.id && t.status !== 'done').length} open tasks</div>
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
          <p className="muted small" style={{ marginTop: '.75rem' }}>Keyword matches. For judgement calls, ask below or use the Claude connector.</p>
        </section>

        <section className="block" id="ask">
          <h2>Ask about alignment</h2>
          <PriorityChat token={token} />
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
              Days with check-ins but no briefing:{' '}
              {dates.filter((d) => !briefings.some((b) => b.call_date === d.date)).map((d, i) => (
                <span key={d.date}>{i > 0 && ', '}<Link href={`${base}/day/${d.date}`}>{fmtDate(d.date)}</Link></span>
              ))}
            </p>
          )}
        </section>
      </div>

      <aside>
        <section id="schedule">
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

          <h3 style={{ marginTop: '1.75rem' }}>Your briefing</h3>
          <form action={setBriefingCallAction} className="actions panel" style={{ marginBottom: '1rem' }}>
            <input type="hidden" name="token" value={token} />
            <label className="checkline">
              <input type="checkbox" name="enabled" defaultChecked={callsOn} />
              <span>Call me with the briefing</span>
            </label>
            <button type="submit">Save</button>
            <span className="muted small">Off: briefings are still written and shown here.</span>
          </form>

          {ceoSchedules.map((s) => (
            <div key={s.id} className="entry" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
              <div><strong>{fmtClock(s.call_time)}</strong> <span className="muted">{fmtDays(s.days)}</span></div>
              <form action={removeCeoScheduleAction}>
                <input type="hidden" name="token" value={token} /><input type="hidden" name="id" value={s.id} />
                <button className="quiet danger" type="submit">Remove</button>
              </form>
            </div>
          ))}
          {ceoSchedules.length === 0 && <p className="muted small">No briefing times set.</p>}
          <form action={addCeoScheduleAction} className="stack panel" style={{ marginTop: '1rem' }}>
            <input type="hidden" name="token" value={token} />
            <h3>Add a briefing time</h3>
            <ScheduleFields days={[1, 2, 3, 4, 5]} time="18:00" />
            <div><button className="primary" type="submit">Add</button></div>
          </form>
        </section>
      </aside>
    </div>
  );
}
