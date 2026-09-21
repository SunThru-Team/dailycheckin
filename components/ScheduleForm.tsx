'use client';
import { useActionState } from 'react';
import { saveScheduleAction, type ActionResult } from '@/app/e/[token]/actions';
import { ScheduleFields } from './ScheduleFields';

export function ScheduleForm({ token, days, time, tz }: { token: string; days: number[]; time: string; tz: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveScheduleAction, null);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />
      <ScheduleFields days={days} time={time} />
      <div className="actions">
        <button className="primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save schedule'}</button>
        <span className="muted small">Times are {tz}. Calls go out within about 15 minutes of the time you pick.</span>
        {state && (state.ok ? <span className="chip ok">{state.message}</span> : <span className="chip danger">{state.error}</span>)}
      </div>
    </form>
  );
}
