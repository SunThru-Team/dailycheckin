import Anthropic from '@anthropic-ai/sdk';
import type { ResponseWithName } from './db';
import type { PriorityRow, TaskRow } from './tasks';

const MODEL = 'claude-sonnet-4-6';
let _client: Anthropic | undefined;
const anthropic = () => (_client ??= new Anthropic());

function text(msg: Anthropic.Message): string {
  return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
}

/** Spoken-style briefing for the CEO, under ~90 seconds read aloud. */
export async function generateDailySummary(
  dateLabel: string,
  responses: { employeeName: string; transcript: string }[],
  missed: string[],
): Promise<string> {
  if (responses.length === 0) {
    const who = missed.length ? ` No one answered their check-in call today: ${missed.join(', ')}.` : '';
    return `Good evening. There are no check-in responses to report for ${dateLabel}.${who}`;
  }
  const context = responses.map((r) => `${r.employeeName}: ${r.transcript}`).join('\n\n');
  const msg = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 600,
    system:
      'You write a brief spoken evening briefing for the CEO of a small hardware startup. ' +
      'It will be read aloud by a text-to-speech voice over the phone, so: plain sentences, no markdown, ' +
      'no bullet characters, no headings, spell out numbers where natural. Keep it under 220 words.',
    messages: [{
      role: 'user',
      content:
        `Date: ${dateLabel}. Summarize these daily employee check-ins. Group related items by theme, ` +
        `state blockers explicitly by name, and close with anything that needs the CEO's attention or decision.` +
        (missed.length ? ` Also mention that ${missed.join(' and ')} did not answer today's call.` : '') +
        `\n\n${context}`,
    }],
  });
  return text(msg);
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

/** Priorities chatbot: answers a question with priorities + trailing 14 days of updates in context. */
export async function answerPriorityQuestion(
  history: ChatTurn[],
  priorities: PriorityRow[],
  tasks: TaskRow[],
  recent: ResponseWithName[],
): Promise<string> {
  const prioritiesText = priorities.length
    ? priorities.map((p) => `${p.rank}. ${p.title}${p.deadline ? ` (deadline ${p.deadline})` : ''}${p.description ? ` — ${p.description}` : ''}`).join('\n')
    : '(none set)';
  const tasksText = tasks.length
    ? tasks.map((t) => `- ${t.title} → ${t.assignee_name ?? 'unassigned'} [${t.status}]${t.priority_title ? ` under "${t.priority_title}"` : ''}${t.due_date ? `, due ${t.due_date}` : ''}`).join('\n')
    : '(none)';
  const updatesText = recent.length
    ? recent.map((r) => `${r.employee_name} (${r.date}): ${r.transcript}`).join('\n')
    : '(no updates in the last 14 days)';

  const system =
    `You are an operations analyst for a small startup's CEO. You have the current priority list, the delegated task list, ` +
    `and the last fourteen days of verbatim employee check-in transcripts (speech-to-text, so expect minor transcription errors). ` +
    `Answer the CEO's questions directly and concretely. When asked about alignment, say for each priority whether reported work is tracking it, ` +
    `name who is working on what, call out gaps and blockers, and suggest specific pivots where alignment is weak. ` +
    `Only use the data below; if it doesn't support a claim, say so. Be concise; use short paragraphs or brief lists.\n\n` +
    `## Current priorities\n${prioritiesText}\n\n## Delegated tasks\n${tasksText}\n\n## Recent check-ins\n${updatesText}`;

  const msg = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 900,
    system,
    messages: history.slice(-12),
  });
  return text(msg);
}
