import {
  addCeoNoteAction, createTaskAction, delegateTaskAction, deleteTaskAction, moveTaskAction,
  resolveBatchAction, resolveSuggestionAction, saveProgressNoteAction, setTaskStatusAction,
  setVisibilityAction, updateTaskAction,
} from '../actions';
import { listPeople } from '@/lib/db';
import {
  latestNoteAnyState, listNotesVisible, listPriorities, listSuggestions, listTasksVisible,
  STATUS_LABEL, TASK_STATUSES, VISIBILITY_LABEL, type TaskRow,
} from '@/lib/tasks';
import { describeSuggestion } from '@/lib/suggestions';
import { fmtDate, fmtDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';
const CEO = { kind: 'ceo' } as const;

const VIS_ICON: Record<string, string> = { ceo_only: '🔒', leadership: '👥', assignee: '👁' };

export default async function TasksTab({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [people, tasks, priorities, suggestions] = await Promise.all([
    listPeople(), listTasksVisible(CEO), listPriorities(), listSuggestions('pending'),
  ]);
  const notesByTask = new Map(await Promise.all(tasks.map(async (t) => [t.id, await listNotesVisible(CEO, t.id)] as const)));
  const progressNotes = new Map(await Promise.all(people.map(async (p) => [p.id, await latestNoteAnyState(p.id)] as const)));

  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const titleOf = new Map(tasks.map((t) => [t.id, t.title]));
  const batches = [...new Set(suggestions.map((s) => s.batch).filter(Boolean))] as string[];

  const groups: { key: string; id: number | null; name: string; role?: string }[] = [
    ...people.map((p) => ({ key: String(p.id), id: p.id as number | null, name: p.name, role: p.role })),
    { key: 'none', id: null, name: 'Not yet delegated' },
  ];

  const TaskRowView = ({ t, i, siblings }: { t: TaskRow; i: number; siblings: TaskRow[] }) => {
    const notes = notesByTask.get(t.id) ?? [];
    return (
      <div className={t.status === 'done' ? 'task done' : 'task'}>
        <div className="task-main">
          <span className="vis" title={VISIBILITY_LABEL[t.visibility]}>{VIS_ICON[t.visibility]}</span>
          <span className="title">{t.title}</span>
          {t.priority_title && <span className="chip accent small-chip">{t.priority_title}</span>}
          <span className={`chip small-chip ${t.status === 'done' ? 'ok' : t.status === 'blocked' ? 'danger' : t.status === 'in_progress' ? 'accent' : ''}`}>
            {STATUS_LABEL[t.status]}
          </span>
          {t.due_date && <span className="muted small">due {fmtDate(t.due_date)}</span>}
          {notes.length > 0 && <span className="muted small">{notes.length} note{notes.length === 1 ? '' : 's'}</span>}
          <span className="grow" />
          <form action={moveTaskAction} className="inlineform">
            <input type="hidden" name="token" value={token} /><input type="hidden" name="taskId" value={t.id} />
            <button className="quiet" name="dir" value="up" type="submit" disabled={i === 0} aria-label="Move up">↑</button>
          </form>
          <form action={moveTaskAction} className="inlineform">
            <input type="hidden" name="token" value={token} /><input type="hidden" name="taskId" value={t.id} />
            <button className="quiet" name="dir" value="down" type="submit" disabled={i === siblings.length - 1} aria-label="Move down">↓</button>
          </form>
        </div>

        <details className="inline task-detail">
          <summary>Open</summary>
          {t.description && <p className="small">{t.description}</p>}

          <div className="quickrow">
            <form action={setVisibilityAction} className="inlineform">
              <input type="hidden" name="token" value={token} /><input type="hidden" name="taskId" value={t.id} />
              {t.visibility !== 'assignee' && <button className="quiet" name="visibility" value="assignee" type="submit">Release to {t.assignee_name ?? 'assignee'}</button>}
              {t.visibility !== 'leadership' && <button className="quiet" name="visibility" value="leadership" type="submit">Leadership</button>}
              {t.visibility !== 'ceo_only' && <button className="quiet" name="visibility" value="ceo_only" type="submit">Make private</button>}
            </form>
            <form action={setTaskStatusAction} className="inlineform">
              <input type="hidden" name="token" value={token} /><input type="hidden" name="taskId" value={t.id} />
              {TASK_STATUSES.filter((s) => s !== t.status).map((s) => (
                <button key={s} className="quiet" name="status" value={s} type="submit">{STATUS_LABEL[s]}</button>
              ))}
            </form>
          </div>

          {notes.length > 0 && (
            <div className="notes">
              {notes.map((n) => (
                <p key={n.id} className="small">
                  <span className="muted">{n.author_name ?? 'You'} · {fmtDateTime(n.created_at)}</span><br />{n.body}
                </p>
              ))}
            </div>
          )}

          <form action={addCeoNoteAction} className="row">
            <input type="hidden" name="token" value={token} /><input type="hidden" name="taskId" value={t.id} />
            <label style={{ flex: 1 }}>Add a note<input name="body" required placeholder="Context, next step…" /></label>
            <button type="submit">Add</button>
          </form>

          <form action={updateTaskAction} className="stack" style={{ marginTop: '.75rem' }}>
            <input type="hidden" name="token" value={token} /><input type="hidden" name="taskId" value={t.id} />
            <label>Title<input name="title" defaultValue={t.title} required /></label>
            <label>Detail<textarea name="description" defaultValue={t.description ?? ''} style={{ minHeight: '3.5rem' }} /></label>
            <div className="row">
              <label>Assignee
                <select name="assignedTo" defaultValue={t.assigned_to ?? ''}>
                  <option value="">Not delegated</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label>Priority
                <select name="priorityId" defaultValue={t.priority_id ?? ''}>
                  <option value="">None</option>
                  {priorities.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </label>
              <label>Due<input type="date" name="dueDate" defaultValue={t.due_date ?? ''} /></label>
            </div>
            <div className="actions">
              <button className="primary" type="submit">Save</button>
              <button className="quiet danger" formAction={deleteTaskAction} type="submit">Delete</button>
            </div>
          </form>
        </details>
      </div>
    );
  };

  return (
    <>
      {suggestions.length > 0 && (
        <section className="suggestions">
          <h2>Waiting for you <span className="count">{suggestions.length}</span></h2>
          {batches.map((b) => {
            const items = suggestions.filter((s) => s.batch === b);
            if (items.length < 2) return null;
            return (
              <form key={b} action={resolveBatchAction} className="actions batch">
                <input type="hidden" name="token" value={token} /><input type="hidden" name="batch" value={b} />
                <span className="small">{items.length} changes proposed together</span>
                <button className="primary" name="decision" value="approve" type="submit">Approve all</button>
                <button className="quiet danger" name="decision" value="reject" type="submit">Reject all</button>
              </form>
            );
          })}
          {suggestions.map((s) => (
            <div key={s.id} className="entry suggestion">
              <div className="grow">
                <strong>{describeSuggestion(s, nameOf, titleOf)}</strong>
                {s.rationale && <p className="small muted" style={{ margin: '.2rem 0 0' }}>{s.rationale}</p>}
                <p className="small muted" style={{ margin: '.2rem 0 0' }}>
                  from {s.source === 'employee' ? 'an employee' : 'Claude'} · {fmtDateTime(s.created_at)}
                </p>
              </div>
              <form action={resolveSuggestionAction} className="actions">
                <input type="hidden" name="token" value={token} /><input type="hidden" name="id" value={s.id} />
                <button className="primary" name="decision" value="approve" type="submit">Approve</button>
                <button className="quiet danger" name="decision" value="reject" type="submit">Reject</button>
              </form>
            </div>
          ))}
        </section>
      )}

      <section className={suggestions.length ? 'block' : undefined}>
        <h2>Who is working on what <span className="count">{tasks.filter((t) => t.status !== 'done').length} open</span></h2>
        <p className="muted small">🔒 private to you · 👥 leadership · 👁 released to the assignee</p>

        {groups.map((g) => {
          const mine = tasks.filter((t) => t.assigned_to === g.id);
          const note = g.id ? progressNotes.get(g.id) : null;
          return (
            <div key={g.key} className="person">
              <h3>
                {g.name}
                {g.role && g.role !== 'employee' && <span className="chip small-chip">{g.role}</span>}
                <span className="count">{mine.filter((t) => t.status !== 'done').length} open</span>
              </h3>

              {mine.length === 0 && <p className="muted small">Nothing here.</p>}
              {mine.map((t, i) => <TaskRowView key={t.id} t={t} i={i} siblings={mine} />)}

              <details className="inline add-task">
                <summary>Add a task{g.id ? ` for ${g.name.split(' ')[0]}` : ''}</summary>
                <form action={createTaskAction} className="stack">
                  <input type="hidden" name="token" value={token} />
                  {g.id && <input type="hidden" name="assignedTo" value={g.id} />}
                  <label>Task<input name="title" required placeholder="What needs doing" /></label>
                  <div className="row">
                    <label>Priority
                      <select name="priorityId" defaultValue="">
                        <option value="">None</option>
                        {priorities.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                      </select>
                    </label>
                    <label>Due<input type="date" name="dueDate" /></label>
                    <label>Visibility
                      <select name="visibility" defaultValue="ceo_only">
                        <option value="ceo_only">Private to you</option>
                        <option value="leadership">Leadership</option>
                        <option value="assignee">Released</option>
                      </select>
                    </label>
                  </div>
                  <div><button className="primary" type="submit">Add task</button></div>
                </form>
              </details>

              {g.id && g.role !== 'ceo' && (
                <details className="inline">
                  <summary>Progress note{note ? (note.published ? ' (published)' : ' (draft)') : ''}</summary>
                  {note && <p className="small muted">Current: {note.body}</p>}
                  <form action={saveProgressNoteAction} className="stack">
                    <input type="hidden" name="token" value={token} /><input type="hidden" name="employeeId" value={g.id} />
                    <textarea name="body" required style={{ minHeight: '4rem' }} placeholder="A couple of sentences they'll see on their dashboard" />
                    <div className="actions">
                      <label className="checkline"><input type="checkbox" name="publish" /> <span>Publish to them</span></label>
                      <button className="primary" type="submit">Save note</button>
                    </div>
                  </form>
                </details>
              )}
            </div>
          );
        })}
      </section>

      <section className="block">
        <h2>Move a task</h2>
        <form action={delegateTaskAction} className="row panel">
          <input type="hidden" name="token" value={token} />
          <label>Task
            <select name="taskId" defaultValue="">
              <option value="" disabled>Choose…</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}{t.assignee_name ? ` (${t.assignee_name})` : ''}</option>)}
            </select>
          </label>
          <label>To
            <select name="assignedTo" defaultValue="">
              <option value="">Not delegated</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <button className="primary" type="submit">Move</button>
          <span className="muted small">Moving does not change who can see it.</span>
        </form>
      </section>
    </>
  );
}
