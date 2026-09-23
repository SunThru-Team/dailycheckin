// Tool definitions for the Claude custom connector.
// Everything here runs as the CEO: the route guards the secret before this is reached.
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  findPerson, getRecentResponses, listCeoCalls, listPeople, listResponsesForDate, setBriefingCallEnabled,
} from './db';
import {
  addProgressNote, addSuggestion, createPriorityRanked, createTask, delegateTask, getPriorityByTitle,
  getTaskVisible, latestNoteAnyState, listNotesVisible, listPriorities, listSuggestions, listTasksVisible,
  nudgePriority, rankPriorities, rankTasks, recentNotesFor, setTaskVisibility, updatePriorityRow, updateTask,
} from './tasks';
import { fmtClock, fmtDate, orgDate } from './time';

const CEO = { kind: 'ceo' } as const;
const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const json = (s: string, data: unknown) => ({
  content: [{ type: 'text' as const, text: s }, { type: 'text' as const, text: JSON.stringify(data) }],
});

/** When true, even John's direct commands land in the suggestions queue. */
const requireApproval = () => process.env.CONNECTOR_WRITES_REQUIRE_APPROVAL === 'true';

const statusEnum = z.enum(['not_started', 'in_progress', 'blocked', 'done']);
const visibilityEnum = z.enum(['ceo_only', 'leadership', 'assignee']);
const CONFIRM = 'Confirm the exact change with the user before calling this.';

async function resolvePerson(name: string) {
  const p = await findPerson(name);
  if (!p) throw new Error(`No one matches "${name}". Use list_people to see who exists.`);
  return p;
}
async function resolvePriority(ref: string | number | undefined) {
  if (ref === undefined || ref === null || ref === '') return null;
  if (typeof ref === 'number') return ref;
  if (/^\d+$/.test(ref)) return Number(ref);
  const p = await getPriorityByTitle(ref);
  if (!p) throw new Error(`No active priority matches "${ref}".`);
  return p.id;
}

const taskLine = (t: { id: number; title: string; status: string; visibility: string; priority_title: string | null; due_date: string | null; rank: number }) =>
  `  ${t.rank}. [#${t.id}] ${t.title} — ${t.status}` +
  (t.priority_title ? ` · ${t.priority_title}` : '') +
  (t.due_date ? ` · due ${t.due_date}` : '') +
  (t.visibility === 'ceo_only' ? ' · PRIVATE (not visible to them)' : t.visibility === 'leadership' ? ' · leadership-visible' : '');

export function registerTools(server: McpServer) {
  // ------------------------------------------------------------ read tools
  server.registerTool('get_latest_briefing', {
    title: 'Get latest briefing',
    description: 'The most recent daily briefing about what the team reported. Optionally pass a date (YYYY-MM-DD) for that day instead.',
    inputSchema: z.object({ date: z.string().optional().describe('YYYY-MM-DD; omit for the most recent') }),
  }, async ({ date }) => {
    const all = await listCeoCalls(60);
    const row = date ? all.find((b) => b.call_date === date) : all[0];
    if (!row) return text(date ? `No briefing stored for ${date}.` : 'No briefings have been generated yet.');
    return text(`Briefing for ${fmtDate(row.call_date)} (${fmtClock(row.slot)}):\n\n${row.summary_text}`);
  });

  server.registerTool('list_briefings', {
    title: 'List briefings',
    description: 'Briefings from the last N days, newest first.',
    inputSchema: z.object({ days: z.number().int().min(1).max(90).default(7) }),
  }, async ({ days }) => {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const rows = (await listCeoCalls(90)).filter((b) => b.call_date >= cutoff);
    if (!rows.length) return text(`No briefings in the last ${days} days.`);
    return text(rows.map((b) => `## ${fmtDate(b.call_date)} (${fmtClock(b.slot)})\n${b.summary_text}`).join('\n\n'));
  });

  server.registerTool('get_checkins', {
    title: 'Get check-ins',
    description: 'Verbatim check-in transcripts from the daily phone calls. Filter by person and/or date. These are speech-to-text, so expect transcription errors.',
    inputSchema: z.object({
      person: z.string().optional().describe('First name is fine'),
      date: z.string().optional().describe('YYYY-MM-DD'),
      days: z.number().int().min(1).max(60).default(7).describe('Used when no date is given'),
    }),
  }, async ({ person, date, days }) => {
    const all = date ? await listResponsesForDate(date) : await getRecentResponses(days);
    const pid = person ? (await resolvePerson(person)).id : null;
    const rows = pid === null ? [...all] : all.filter((r) => r.employee_id === pid);
    if (!rows.length) return text('No check-ins match that.');
    return text(rows.map((r) => `${r.employee_name} — ${r.date}\n${r.transcript}`).join('\n\n'));
  });

  server.registerTool('list_people', {
    title: 'List people',
    description: 'Everyone in the company with their role (ceo, leadership, employee) and id.',
    inputSchema: z.object({}),
  }, async () => {
    const people = await listPeople();
    return json(people.map((p) => `[#${p.id}] ${p.name} — ${p.role}`).join('\n'),
      people.map((p) => ({ id: p.id, name: p.name, role: p.role })));
  });

  server.registerTool('list_priorities', {
    title: 'List priorities',
    description: 'The SunThru priorities in rank order, with how many tasks are linked to each.',
    inputSchema: z.object({ include_archived: z.boolean().default(false) }),
  }, async ({ include_archived }) => {
    const rows = await listPriorities(include_archived);
    if (!rows.length) return text('No priorities set.');
    return json(rows.map((p) =>
      `${p.rank}. [#${p.id}] ${p.title} — ${p.active_task_count} active / ${p.task_count} tasks` +
      (p.deadline ? ` · deadline ${p.deadline}` : '') + (p.status !== 'active' ? ` · ${p.status}` : '') +
      (p.description ? `\n    ${p.description}` : '')).join('\n'), rows);
  });

  server.registerTool('list_tasks', {
    title: 'List tasks',
    description: 'Tasks grouped by person, in rank order. Filter by person, priority, status or visibility. Includes private (ceo_only) tasks, which the assignee cannot see.',
    inputSchema: z.object({
      person: z.string().optional(),
      priority: z.string().optional().describe('Priority title or id'),
      status: statusEnum.optional(),
      visibility: visibilityEnum.optional(),
    }),
  }, async ({ person, priority, status, visibility }) => {
    const assignee = person ? (await resolvePerson(person)).id : undefined;
    const priorityId = await resolvePriority(priority);
    const found = await listTasksVisible(CEO, { assignedTo: assignee, priorityId: priorityId ?? undefined, status });
    const rows = visibility ? found.filter((t) => t.visibility === visibility) : [...found];
    if (!rows.length) return text('No tasks match that.');
    const people = await listPeople();
    const groups = [...people.map((p) => ({ name: p.name, id: p.id as number | null })), { name: 'Not yet delegated', id: null }];
    const out = groups.map((g) => {
      const mine = rows.filter((t) => t.assigned_to === g.id);
      return mine.length ? `${g.name}\n${mine.map(taskLine).join('\n')}` : null;
    }).filter(Boolean).join('\n\n');
    return json(out, rows);
  });

  server.registerTool('get_person_overview', {
    title: 'Person overview',
    description: 'One person at a glance: their ranked tasks, their most recent check-in, recent notes on their tasks, and their current progress note.',
    inputSchema: z.object({ person: z.string() }),
  }, async ({ person }) => {
    const p = await resolvePerson(person);
    const [tasks, checkins, notes, note] = await Promise.all([
      listTasksVisible(CEO, { assignedTo: p.id }), getRecentResponses(14), recentNotesFor(p.id, 5), latestNoteAnyState(p.id),
    ]);
    const latest = checkins.find((c) => c.employee_id === p.id);
    return text([
      `${p.name} (${p.role})`,
      '', 'Tasks:', tasks.length ? tasks.map(taskLine).join('\n') : '  (none)',
      '', 'Latest check-in:', latest ? `  ${latest.date}: ${latest.transcript}` : '  (none in the last 14 days)',
      '', 'Recent task notes:', notes.length ? notes.map((n) => `  ${n.created_at.toISOString().slice(0, 10)} · ${n.task_title}: ${n.body}`).join('\n') : '  (none)',
      '', 'Progress note:', note ? `  ${note.published ? 'published' : 'DRAFT'}: ${note.body}` : '  (none)',
    ].join('\n'));
  });

  server.registerTool('list_pending_suggestions', {
    title: 'List pending suggestions',
    description: 'Proposed changes waiting for approval in the dashboard.',
    inputSchema: z.object({}),
  }, async () => {
    const rows = await listSuggestions('pending');
    if (!rows.length) return text('Nothing pending.');
    return json(rows.map((s) => `[#${s.id}] ${s.kind}${s.rationale ? ` — ${s.rationale}` : ''}\n    ${JSON.stringify(s.payload)}`).join('\n'), rows);
  });

  // ----------------------------------------------------------- write tools
  server.registerTool('create_priority', {
    title: 'Create priority',
    description: `Add a SunThru priority. Pass rank to insert it at a position (1 = top); everything below shifts down. ${CONFIRM}`,
    inputSchema: z.object({
      title: z.string().min(1), description: z.string().optional(),
      deadline: z.string().optional().describe('YYYY-MM-DD'), rank: z.number().int().min(1).optional(),
    }),
  }, async ({ title, description, deadline, rank }) => {
    const id = await createPriorityRanked(title, description ?? null, deadline ?? null, rank);
    const all = await listPriorities();
    return text(`Created priority #${id}. Order is now:\n${all.map((p) => `${p.rank}. ${p.title}`).join('\n')}`);
  });

  server.registerTool('update_priority', {
    title: 'Update priority',
    description: `Change a priority's title, description, deadline or status. ${CONFIRM}`,
    inputSchema: z.object({
      priority: z.string().describe('Title or id'), title: z.string().optional(),
      description: z.string().nullable().optional(), deadline: z.string().nullable().optional(),
      status: z.enum(['active', 'done', 'archived']).optional(),
    }),
  }, async ({ priority, ...f }) => {
    const id = await resolvePriority(priority);
    if (!id) throw new Error('Priority not found.');
    await updatePriorityRow(id, f);
    return text(`Updated priority #${id}.`);
  });

  server.registerTool('archive_priority', {
    title: 'Archive priority',
    description: `Archive a priority so it drops off the active list. Linked tasks are left alone. ${CONFIRM}`,
    inputSchema: z.object({ priority: z.string() }),
  }, async ({ priority }) => {
    const id = await resolvePriority(priority);
    if (!id) throw new Error('Priority not found.');
    await updatePriorityRow(id, { status: 'archived' });
    return text(`Archived priority #${id}.`);
  });

  server.registerTool('rank_priorities', {
    title: 'Rank priorities',
    description: `Set the full priority order. Pass every active priority id, top first. ${CONFIRM}`,
    inputSchema: z.object({ ordered_priority_ids: z.array(z.number().int()).min(1) }),
  }, async ({ ordered_priority_ids }) => {
    if (requireApproval()) {
      const id = await addSuggestion('rerank_priorities', { ordered_priority_ids }, 'Requested through the connector', 'claude_connector', null);
      return text(`Queued as suggestion #${id} for approval in the dashboard.`);
    }
    await rankPriorities(ordered_priority_ids);
    const all = await listPriorities();
    return text(`New order:\n${all.map((p) => `${p.rank}. ${p.title}`).join('\n')}`);
  });

  server.registerTool('create_task', {
    title: 'Create task',
    description:
      `Create a task. It defaults to PRIVATE (ceo_only) — the assignee will not see it until you call set_task_visibility. ${CONFIRM}`,
    inputSchema: z.object({
      title: z.string().min(1), description: z.string().optional(),
      person: z.string().optional().describe('Assignee; omit to leave undelegated'),
      priority: z.string().optional().describe('Priority title or id'),
      due_date: z.string().optional().describe('YYYY-MM-DD'),
      visibility: visibilityEnum.default('ceo_only'),
    }),
  }, async ({ title, description, person, priority, due_date, visibility }) => {
    const assignee = person ? (await resolvePerson(person)) : null;
    const priorityId = await resolvePriority(priority);
    if (requireApproval()) {
      const id = await addSuggestion('create_task',
        { title, description: description ?? null, assignee_id: assignee?.id ?? null, priority_id: priorityId, due_date: due_date ?? null, visibility },
        'Requested through the connector', 'claude_connector', null);
      return text(`Queued as suggestion #${id} for approval in the dashboard.`);
    }
    const id = await createTask({
      title, description: description ?? null, assignedTo: assignee?.id ?? null,
      priorityId, dueDate: due_date ?? null, visibility, source: 'claude_connector',
    });
    return text(`Created task #${id}${assignee ? ` for ${assignee.name}` : ' (not delegated)'}` +
      `${visibility === 'ceo_only' ? '. It is private — they cannot see it yet.' : '.'}`);
  });

  server.registerTool('delegate_task', {
    title: 'Delegate task',
    description: `Assign or reassign a task to someone. This does NOT make it visible to them; use set_task_visibility for that. ${CONFIRM}`,
    inputSchema: z.object({ task_id: z.number().int(), person: z.string().nullable().describe('null to un-assign') }),
  }, async ({ task_id, person }) => {
    const assignee = person ? await resolvePerson(person) : null;
    if (requireApproval()) {
      const id = await addSuggestion('reassign_task', { task_id, assignee_id: assignee?.id ?? null }, 'Requested through the connector', 'claude_connector', null);
      return text(`Queued as suggestion #${id}.`);
    }
    await delegateTask(task_id, assignee?.id ?? null);
    const t = await getTaskVisible(CEO, task_id);
    return text(`Task #${task_id} is now ${assignee ? `assigned to ${assignee.name}` : 'unassigned'}.` +
      (t && t.visibility === 'ceo_only' ? ' It is still private.' : ''));
  });

  server.registerTool('update_task', {
    title: 'Update task',
    description: `Edit a task's title, description, status, due date or linked priority. ${CONFIRM}`,
    inputSchema: z.object({
      task_id: z.number().int(), title: z.string().optional(), description: z.string().nullable().optional(),
      status: statusEnum.optional(), due_date: z.string().nullable().optional(), priority: z.string().nullable().optional(),
    }),
  }, async ({ task_id, priority, ...f }) => {
    const priorityId = priority === null ? null : await resolvePriority(priority ?? undefined);
    if (requireApproval()) {
      const id = await addSuggestion('update_task', { task_id, ...f, priority_id: priorityId }, 'Requested through the connector', 'claude_connector', null);
      return text(`Queued as suggestion #${id}.`);
    }
    await updateTask(task_id, { ...f, dueDate: f.due_date, priorityId: priority === undefined ? undefined : priorityId });
    return text(`Updated task #${task_id}.`);
  });

  server.registerTool('rank_tasks', {
    title: 'Rank tasks',
    description: `Set the task order for one person. Pass their task ids, most important first. ${CONFIRM}`,
    inputSchema: z.object({ ordered_task_ids: z.array(z.number().int()).min(1) }),
  }, async ({ ordered_task_ids }) => {
    if (requireApproval()) {
      const id = await addSuggestion('reorder_tasks', { assignee_id: null, ordered_task_ids }, 'Requested through the connector', 'claude_connector', null);
      return text(`Queued as suggestion #${id}.`);
    }
    await rankTasks(ordered_task_ids);
    return text(`Reordered ${ordered_task_ids.length} tasks.`);
  });

  server.registerTool('set_task_visibility', {
    title: 'Set task visibility',
    description:
      'Release a task or pull it back. "assignee" makes it appear on that person\'s dashboard; "leadership" shows it to leadership only; ' +
      `"ceo_only" hides it from everyone but you. This is the only way a task becomes visible to an employee. ${CONFIRM}`,
    inputSchema: z.object({ task_id: z.number().int(), visibility: visibilityEnum }),
  }, async ({ task_id, visibility }) => {
    await setTaskVisibility(task_id, visibility);
    const t = await getTaskVisible(CEO, task_id);
    return text(`Task #${task_id} (“${t?.title ?? '?'}”) is now ${visibility}.` +
      (visibility === 'assignee' ? ' It will show on their dashboard.' : ''));
  });

  server.registerTool('set_progress_note', {
    title: 'Set progress note',
    description:
      `Write a short progress note for someone — a couple of sentences they will read on their dashboard. ` +
      `Set publish=false to save it as a draft only you can see. ${CONFIRM}`,
    inputSchema: z.object({ person: z.string(), body: z.string().min(1), publish: z.boolean().default(false) }),
  }, async ({ person, body, publish }) => {
    const p = await resolvePerson(person);
    await addProgressNote(p.id, body, publish);
    return text(`Saved a ${publish ? 'published' : 'draft'} progress note for ${p.name}.`);
  });

  // ------------------------------------------------------- suggestion tool
  server.registerTool('suggest_changes', {
    title: 'Suggest changes',
    description:
      'Propose changes for approval instead of applying them. Use this for anything YOU came up with by analysing check-ins, ' +
      'priorities or workloads — reprioritizing, spotting stalled work, proposing new tasks. Nothing takes effect until it is ' +
      'approved in the dashboard. Give each change a short, specific rationale.',
    inputSchema: z.object({
      rationale: z.string().optional().describe('Overall reasoning for the batch'),
      changes: z.array(z.object({
        kind: z.enum(['create_task', 'update_task', 'complete_task', 'reassign_task', 'reorder_tasks', 'rerank_priorities']),
        payload: z.record(z.string(), z.unknown()).describe(
          'create_task: {title, description?, assignee_id?, priority_id?, due_date?, visibility?}; ' +
          'update_task: {task_id, title?, status?, due_date?, priority_id?}; complete_task: {task_id}; ' +
          'reassign_task: {task_id, assignee_id}; reorder_tasks: {assignee_id, ordered_task_ids}; ' +
          'rerank_priorities: {ordered_priority_ids}'),
        rationale: z.string().optional(),
      })).min(1),
    }),
  }, async ({ rationale, changes }) => {
    const batch = `b${Date.now().toString(36)}`;
    const ids: number[] = [];
    for (const c of changes) ids.push(await addSuggestion(c.kind, c.payload, c.rationale ?? rationale ?? null, 'claude_connector', batch));
    return text(`Submitted ${ids.length} suggestion${ids.length === 1 ? '' : 's'} (batch ${batch}) for approval. ` +
      `Nothing has changed yet — approve them in the dashboard under Tasks.`);
  });

  server.registerTool('set_briefing_call', {
    title: 'Turn the briefing call on or off',
    description: `Control whether the daily briefing is read to you over the phone. Briefings are still generated and stored either way. ${CONFIRM}`,
    inputSchema: z.object({ enabled: z.boolean() }),
  }, async ({ enabled }) => {
    await setBriefingCallEnabled(enabled);
    return text(enabled ? 'Briefing calls are on.' : 'Briefing calls are off. Briefings are still generated and available here and on the dashboard.');
  });

  server.registerTool('get_task_notes', {
    title: 'Get task notes',
    description: 'Notes people have added to a task.',
    inputSchema: z.object({ task_id: z.number().int() }),
  }, async ({ task_id }) => {
    const notes = await listNotesVisible(CEO, task_id);
    if (!notes.length) return text('No notes on that task.');
    return text(notes.map((n) => `${n.created_at.toISOString().slice(0, 10)} · ${n.author_name ?? 'You'}: ${n.body}`).join('\n'));
  });

  server.registerTool('move_priority', {
    title: 'Move a priority up or down',
    description: `Nudge one priority one place up or down the list. ${CONFIRM}`,
    inputSchema: z.object({ priority: z.string(), direction: z.enum(['up', 'down']) }),
  }, async ({ priority, direction }) => {
    const id = await resolvePriority(priority);
    if (!id) throw new Error('Priority not found.');
    await nudgePriority(id, direction === 'up' ? -1 : 1);
    const all = await listPriorities();
    return text(all.map((p) => `${p.rank}. ${p.title}`).join('\n'));
  });

  // --------------------------------------------------------------- prompts
  server.registerPrompt('reprioritize_team', {
    title: 'Reprioritize the team',
    description: 'Propose a reordered task list for everyone, aligned to the current priorities.',
    argsSchema: z.object({}),
  }, () => ({
    messages: [{
      role: 'user', content: {
        type: 'text',
        text: 'Read the current priorities (list_priorities), every person and their tasks (list_people, list_tasks), ' +
          'and the recent check-ins (get_checkins). Then propose a reordered task list for each person so their work lines up ' +
          'with the priorities, and flag any priority with no active work. Submit everything through suggest_changes with a ' +
          'clear rationale per change. Do not apply anything directly.',
      },
    }],
  }));

  server.registerPrompt('company_status', {
    title: 'Company status',
    description: 'Summarize the latest briefing, what everyone is working on, and which priorities are stalled.',
    argsSchema: z.object({}),
  }, () => ({
    messages: [{
      role: 'user', content: {
        type: 'text',
        text: `Today is ${orgDate()}. Summarize the latest briefing (get_latest_briefing), what each person is working on ` +
          '(list_tasks, get_checkins), and which priorities have little or no active work (list_priorities). Be concise and specific.',
      },
    }],
  }));
}
