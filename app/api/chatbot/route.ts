// Executive chat: POST { token, messages: [{role, content}] } -> { answer }
import { isAdminToken } from '@/lib/auth';
import { answerPriorityQuestion, type ChatTurn } from '@/lib/ai';
import { getRecentResponses } from '@/lib/db';
import { listPriorities, listTasksVisible } from '@/lib/tasks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { token?: string; messages?: ChatTurn[] } | null;
  if (!body?.token || !isAdminToken(body.token)) return new Response('Unauthorized', { status: 401 });

  const messages = (body.messages ?? []).filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim(),
  );
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return Response.json({ error: 'Last message must be from the user.' }, { status: 400 });
  }

  // The chat runs as the CEO: the admin token is required above.
  const [priorities, tasks, recent] = await Promise.all([
    listPriorities(), listTasksVisible({ kind: 'ceo' }), getRecentResponses(14),
  ]);
  const answer = await answerPriorityQuestion(messages, priorities, tasks, recent);
  return Response.json({ answer });
}
