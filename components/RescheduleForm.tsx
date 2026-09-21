'use client';
import { useActionState } from 'react';
import { rescheduleAction, type ActionResult } from '@/app/e/[token]/actions';

export function RescheduleForm({ token, callId, minLocal, maxLocal, tzLabel }: {
  token: string; callId: number; minLocal: string; maxLocal: string; tzLabel: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(rescheduleAction, null);
  if (state?.ok) return <p className="chip ok">{state.message}</p>;
  return (
    <form action={action} className="row">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="callId" value={callId} />
      <label>
        Call me back at ({tzLabel})
        <input type="datetime-local" name="when" min={minLocal} max={maxLocal} step={900} required />
      </label>
      <button className="primary" type="submit" disabled={pending}>{pending ? 'Scheduling…' : 'Schedule callback'}</button>
      {state && !state.ok && <span className="chip danger">{state.error}</span>}
    </form>
  );
}
