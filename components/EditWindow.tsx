'use client';
import { useActionState, useEffect, useState } from 'react';
import { saveTranscriptAction, type ActionResult } from '@/app/e/[token]/actions';

export function EditWindow({ token, responseId, transcript, lockedAtISO }: {
  token: string; responseId: number; transcript: string; lockedAtISO: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveTranscriptAction, null);
  const [msLeft, setMsLeft] = useState(() => new Date(lockedAtISO).getTime() - Date.now());

  useEffect(() => {
    const t = setInterval(() => setMsLeft(new Date(lockedAtISO).getTime() - Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockedAtISO]);

  const open = msLeft > 0;
  const mm = Math.max(0, Math.floor(msLeft / 60000));
  const ss = Math.max(0, Math.floor((msLeft % 60000) / 1000));

  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="responseId" value={responseId} />
      <label>
        {open
          ? <span>Fix anything the transcription got wrong. Editing closes in <span className="countdown">{mm}:{String(ss).padStart(2, '0')}</span>.</span>
          : <span>Editing has closed for this update.</span>}
        <textarea name="transcript" defaultValue={transcript} disabled={!open || pending} required maxLength={5000} />
      </label>
      <div className="actions">
        <button className="primary" type="submit" disabled={!open || pending}>{pending ? 'Saving…' : 'Save changes'}</button>
        {state && (state.ok
          ? <span className="chip ok">{state.message}</span>
          : <span className="chip danger">{state.error}</span>)}
      </div>
    </form>
  );
}
