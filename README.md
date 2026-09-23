# Daily check-in calls + executive briefing

One Next.js project that (1) phones each employee every weekday morning and transcribes their spoken update,
(2) gives employees a dashboard to fix the transcript for 20 minutes and reschedule missed calls, and
(3) gives the CEO an evening briefing call plus a dashboard with priorities, delegated tasks, a
priorities-vs-reported-work view, and a chat assistant grounded in the last 14 days of check-ins.

## Layout

```
app/api/voice            TwiML: ask the question, gather speech (Twilio hits this when the call connects)
app/api/gather           Twilio posts the SpeechResult here; saved to `responses` with a 20-min edit lock
app/api/status           Call status callbacks (completed / no-answer / busy / failed / voicemail)
app/api/ceo-voice        TwiML that reads the stored briefing to the CEO, with "press 1 to repeat"
app/api/cron/*           daily-checkin-calls (8am ET), ceo-summary-call (6pm ET), process-callbacks (hourly)
app/api/chatbot          Priorities chat (admin token required)
app/api/mcp/[secret]     The Claude custom connector (remote MCP server)
lib/mcp-server.ts        Connector tool definitions
lib/tasks.ts             Priorities, tasks, notes, suggestions, progress notes — all reads take a Viewer
lib/access.ts            Who can see what
lib/suggestions.ts       Applying an approved suggestion
app/e/[token]            Employee dashboard (per-employee secret link)
app/x/[token]            CEO dashboard (ADMIN_TOKEN in the URL): Briefing / Priorities / Tasks tabs
lib/db.ts                All SQL (postgres.js); edit-window and ownership checks are enforced here
lib/twilio.ts            Twilio client, signature verification, outbound call helpers
lib/ai.ts                Claude prompts: evening briefing and priorities chat
lib/match.ts             Keyword matcher behind the "priorities vs reported work" view
db/schema.sql            Schema; scripts/migrate.ts applies it, scripts/seed.ts adds an employee
```

## Set up

1. **Postgres.** Create a Neon / Supabase / Vercel Postgres database. Copy its connection string.
2. **Env.** Copy `.env.example` → `.env.local` and fill it in. Generate `ADMIN_TOKEN` and `CRON_SECRET`
   with `openssl rand -base64 32`.
3. **Schema.** `npm install && npm run db:migrate`
4. **Employees.** For each person: `npm run db:seed -- "Full Name" +1XXXXXXXXXX email@…` — it prints their
   personal dashboard link. Send it to them privately; the link *is* their login.
5. **Deploy.** Push to GitHub, import into Vercel, add every variable from `.env.local` to the Vercel project
   (with `PUBLIC_BASE_URL` set to the production URL), redeploy. `vercel.json` registers the three cron jobs.
6. **Twilio.** Buy a voice-capable number, set it as `TWILIO_FROM_NUMBER`. No inbound webhook configuration is
   needed: every call is outbound and carries its own webhook URLs. Trial accounts can only call verified numbers.
7. **Smoke test.** Hit `GET /api/cron/daily-checkin-calls?force=1` with header `Authorization: Bearer <CRON_SECRET>`
   to dial everyone now. `GET /api/cron/ceo-summary-call?nocall=1` generates today's briefing without calling.

The executive dashboard is at `https://<your-app>/x/<ADMIN_TOKEN>`.

## Things to know

- **Cron times are UTC.** `0 12 * * 1-5` is 8am EDT / 7am EST. Adjust in `vercel.json` when the clocks change,
  or move to a scheduler that understands time zones. On Vercel's Hobby plan crons run at most once per day,
  so the hourly `process-callbacks` job needs Pro (or an external pinger such as cron-job.org hitting the
  endpoint with the bearer token).
- **Voicemail.** Calls use answering-machine detection; if voicemail picks up, we hang up and mark the call
  `no-answer` so the employee is offered a reschedule instead of dictating the prompt into their inbox.
- **Check-ins are immutable.** Employees used to get 20 minutes to edit a transcript; that is gone, by
  design — the first answer is the honest one. The `responses.edit_locked_at` column is left in place so
  old rows keep their history, but nothing reads it.
- **Security model is "secret link".** Anyone with an employee's link sees their transcripts and tasks; anyone
  with the admin link sees everything. Rotate a token by updating `employees.access_token` / `ADMIN_TOKEN`.
  Twilio webhooks verify `X-Twilio-Signature`; cron routes require the bearer secret.
- **Before real employees:** confirm call-recording/transcription disclosure requirements in your state
  (the greeting can be extended to say the call is transcribed), and confirm the CEO is fine being called at 6pm.

## Local development

```
npm run dev                          # http://localhost:3000
TWILIO_VALIDATE_SIGNATURE=false      # in .env.local, so you can curl the webhooks by hand
curl -X POST 'localhost:3000/api/voice?callId=1' -d 'CallSid=CA_test'
curl -X POST 'localhost:3000/api/gather?callId=1&attempt=1' -d 'CallSid=CA_test&SpeechResult=Worked+on+the+press'
```
For live calls against a local server use `ngrok http 3000` and set `PUBLIC_BASE_URL` to the ngrok URL.


---

## Connecting Claude

The connector lets John work from his own Claude chat instead of the dashboard: "what's the latest
briefing", "what is Jeremy working on", "create a task for Jeremy and release it to him". It reads
and writes the same Neon database the dashboard uses.

### One-time setup

**1. Create the secret.** In a terminal:

    openssl rand -hex 32

**2. Add it to Vercel.** Project → Settings → Environment Variables → Add:

    MCP_SECRET = <the string you just generated>

Then Deployments → the latest one → ⋯ → Redeploy. Environment variables only take effect on a new build.

**3. Add the connector in Claude.** In Claude: Settings → Connectors → Add custom connector.
Paste this as the URL, with your secret on the end:

    https://dailycheckin-seven.vercel.app/api/mcp/<MCP_SECRET>

Name it something like "SunThru". Claude will connect and list the available tools.

That URL *is* the password, so treat it like one: don't paste it into a shared channel, a ticket, or a
chat with anyone else. Any other URL under `/api/mcp/` returns a plain 404.

### Rotating the secret

Generate a new one, update `MCP_SECRET` in Vercel, redeploy, then edit the connector in Claude and
paste the new URL. The old URL stops working the moment the redeploy finishes.

### Five things to try

- "What's the latest briefing?"
- "What is Jeremy working on, and what did he say in his last check-in?"
- "Add a priority: launch the new dealer program, and put it at number one."
- "Create a task for Jeremy to call the three top distributors under that priority." — it is created
  **private**; Jeremy cannot see it until you say "release that task to Jeremy".
- "Read everyone's tasks and check-ins and propose a better order for each person." — this comes back
  as pending suggestions in the dashboard under Tasks. Nothing changes until you approve them.

### How the connector decides to apply vs. suggest

Anything John explicitly instructs is applied immediately — he is the approver. Anything Claude
proposes off its own analysis goes to the suggestions queue in the dashboard. To force *every*
connector write through the approval queue, set `CONNECTOR_WRITES_REQUIRE_APPROVAL=true` in Vercel
and redeploy.

---

## Visibility model

| | CEO | Leadership | Employee |
|---|---|---|---|
| `ceo_only` tasks | sees all | no | no, **even if assigned to them** |
| `leadership` tasks | sees all | sees all | no |
| `assignee` tasks | sees all | sees all | only their own |
| Unpublished progress notes | yes | no | no |

New tasks default to `ceo_only`. Creating or delegating a task does **not** make it visible —
only `set_task_visibility` (connector) or the Release button (dashboard) does. The rules are
enforced in SQL inside `lib/tasks.ts`, so an employee's page cannot leak a private task even
if the UI has a bug.

Employees can add notes to tasks they can see, and press "I think this is done" or "I'm blocked",
which creates a suggestion for John rather than changing anything.
