import {
  createPriorityAction, movePriorityAction, setPriorityStatusAction, updatePriorityAction,
} from '../actions';
import { listPriorities, listTasksVisible, STATUS_LABEL } from '@/lib/tasks';
import { listPeople } from '@/lib/db';
import { fmtDate } from '@/lib/time';

export const dynamic = 'force-dynamic';
const CEO = { kind: 'ceo' } as const;

export default async function PrioritiesTab({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [priorities, tasks, people] = await Promise.all([
    listPriorities(true), listTasksVisible(CEO), listPeople(),
  ]);
  const active = priorities.filter((p) => p.status === 'active');
  const inactive = priorities.filter((p) => p.status !== 'active');
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  return (
    <>
      <section>
        <h2>Priorities <span className="count">{active.length} active</span></h2>
        {active.length === 0 && <p className="muted">No priorities yet. Add the first one below.</p>}

        {active.map((p, i) => {
          const linked = tasks.filter((t) => t.priority_id === p.id);
          const stalled = linked.filter((t) => t.status !== 'done').length === 0;
          return (
            <div key={p.id} className={stalled ? 'entry priority stalled' : 'entry priority'}>
              <div className="priority-head">
                <div className="rank">{p.rank}</div>
                <div className="grow">
                  <h3>{p.title}</h3>
                  <div className="meta">
                    {p.deadline && <span>Deadline {fmtDate(p.deadline)}</span>}
                    <span>{p.active_task_count} active / {p.task_count} tasks</span>
                    {stalled && <span className="chip warn">No active work</span>}
                  </div>
                  {p.description && <p className="small" style={{ margin: '.35rem 0 0' }}>{p.description}</p>}
                </div>
                <div className="nudge">
                  <form action={movePriorityAction}>
                    <input type="hidden" name="token" value={token} /><input type="hidden" name="id" value={p.id} />
                    <button className="quiet" name="dir" value="up" type="submit" disabled={i === 0} aria-label="Move up">↑</button>
                  </form>
                  <form action={movePriorityAction}>
                    <input type="hidden" name="token" value={token} /><input type="hidden" name="id" value={p.id} />
                    <button className="quiet" name="dir" value="down" type="submit" disabled={i === active.length - 1} aria-label="Move down">↓</button>
                  </form>
                </div>
              </div>

              {linked.length > 0 && (
                <details className="inline" style={{ marginTop: '.5rem' }}>
                  <summary>{linked.length} task{linked.length === 1 ? '' : 's'}</summary>
                  <ul className="tasklist">
                    {linked.map((t) => (
                      <li key={t.id}>
                        <span className="who">{t.assigned_to ? nameOf.get(t.assigned_to) ?? '—' : 'Not delegated'}</span>
                        {t.title}
                        <span className="chip small-chip">{STATUS_LABEL[t.status]}</span>
                        {t.visibility === 'ceo_only' && <span className="chip small-chip" title="Private to you">🔒</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <details className="inline" style={{ marginTop: '.4rem' }}>
                <summary>Edit</summary>
                <form action={updatePriorityAction} className="stack">
                  <input type="hidden" name="token" value={token} /><input type="hidden" name="id" value={p.id} />
                  <label>Title<input name="title" defaultValue={p.title} required /></label>
                  <label>Description<textarea name="description" defaultValue={p.description ?? ''} style={{ minHeight: '4rem' }} /></label>
                  <div className="row">
                    <label>Deadline<input type="date" name="deadline" defaultValue={p.deadline ?? ''} /></label>
                    <label>Status
                      <select name="status" defaultValue={p.status}>
                        <option value="active">Active</option><option value="done">Done</option><option value="archived">Archived</option>
                      </select>
                    </label>
                  </div>
                  <div className="actions"><button className="primary" type="submit">Save</button></div>
                </form>
              </details>
            </div>
          );
        })}

        <form action={createPriorityAction} className="stack panel" style={{ marginTop: '1.5rem', maxWidth: '38rem' }}>
          <input type="hidden" name="token" value={token} />
          <h3>Add a priority</h3>
          <label>Title<input name="title" required placeholder="e.g. Launch the dealer program" /></label>
          <label>Description<textarea name="description" style={{ minHeight: '4rem' }} placeholder="What done looks like" /></label>
          <div className="row">
            <label>Deadline<input type="date" name="deadline" /></label>
            <label>Insert at rank<input type="number" name="rank" min={1} placeholder="bottom" style={{ width: '8rem' }} /></label>
          </div>
          <div><button className="primary" type="submit">Add priority</button></div>
        </form>
      </section>

      {inactive.length > 0 && (
        <section className="block">
          <h2>Done and archived <span className="count">{inactive.length}</span></h2>
          {inactive.map((p) => (
            <div key={p.id} className="entry" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
              <div><strong>{p.title}</strong> <span className="chip">{p.status}</span></div>
              <form action={setPriorityStatusAction}>
                <input type="hidden" name="token" value={token} /><input type="hidden" name="id" value={p.id} />
                <button className="quiet" name="status" value="active" type="submit">Reactivate</button>
              </form>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
