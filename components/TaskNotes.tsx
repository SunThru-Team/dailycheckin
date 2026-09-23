// Employee-side task row: notes plus the done/blocked buttons, which only ever
// create a suggestion for the CEO to approve.
import { addNoteAction, flagTaskAction } from '@/app/e/[token]/actions';
import { STATUS_LABEL, type TaskNote, type TaskRow } from '@/lib/tasks';
import { fmtDate } from '@/lib/time';

export function EmployeeTask({ token, task, notes }: { token: string; task: TaskRow; notes: TaskNote[] }) {
  return (
    <div className="entry">
      <div className="meta">
        {task.priority_title && <span className="chip accent">{task.priority_title}</span>}
        <span className={`chip ${task.status === 'done' ? 'ok' : task.status === 'blocked' ? 'danger' : task.status === 'in_progress' ? 'accent' : ''}`}>
          {STATUS_LABEL[task.status]}
        </span>
        {task.due_date && <span>Due {fmtDate(task.due_date)}</span>}
      </div>
      <h3>{task.title}</h3>
      {task.description && <div className="body small">{task.description}</div>}

      {notes.length > 0 && (
        <div className="notes">
          {notes.map((n) => (
            <p key={n.id} className="small">
              <span className="muted">{n.author_name ?? 'John'} · {fmtDate(n.created_at as unknown as string)}</span><br />{n.body}
            </p>
          ))}
        </div>
      )}

      <details className="inline">
        <summary>Add a note</summary>
        <form action={addNoteAction} className="stack">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="taskId" value={task.id} />
          <textarea name="body" required maxLength={2000} style={{ minHeight: '4rem' }} placeholder="Where this stands, what you need…" />
          <div><button className="primary" type="submit">Add note</button></div>
        </form>
      </details>

      {task.status !== 'done' && (
        <form action={flagTaskAction} className="actions">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="body" value="" />
          <button className="quiet" name="flag" value="done" type="submit">I think this is done</button>
          <button className="quiet danger" name="flag" value="blocked" type="submit">I&apos;m blocked</button>
          <span className="muted small">Sends John a note to review — it doesn&apos;t change the task.</span>
        </form>
      )}
    </div>
  );
}
