'use client';
import { useState } from 'react';

type Turn = { role: 'user' | 'assistant'; content: string };
const SUGGESTIONS = [
  'Are we on track against the current priorities?',
  'What blockers came up this week and who owns them?',
  'Which priority has had the least activity in the last two weeks?',
];

export function PriorityChat({ token }: { token: string }) {
  const [log, setLog] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(question: string) {
    const q = question.trim(); if (!q || busy) return;
    const next: Turn[] = [...log, { role: 'user', content: q }];
    setLog(next); setInput(''); setBusy(true); setError(null);
    try {
      const res = await fetch('/api/chatbot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, messages: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { answer } = await res.json();
      setLog([...next, { role: 'assistant', content: answer }]);
    } catch (e) {
      setError(`Couldn’t get an answer: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  return (
    <div className="chat">
      {log.length === 0 && (
        <div className="actions">
          {SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => ask(s)} disabled={busy}>{s}</button>)}
        </div>
      )}
      <div className="log">
        {log.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.content}</div>)}
        {busy && <div className="msg assistant muted">Reading the last two weeks of check-ins…</div>}
      </div>
      {error && <p className="chip danger">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about priorities, blockers, or who is working on what" disabled={busy} />
        <button className="primary" type="submit" disabled={busy || !input.trim()}>Ask</button>
      </form>
      {log.length > 0 && <button type="button" className="quiet" onClick={() => setLog([])}>Start over</button>}
    </div>
  );
}
