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
app/e/[token]            Employee dashboard (per-employee secret link)
app/x/[token]            Executive dashboard (ADMIN_TOKEN in the URL); /day/<date> shows a day's transcripts
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
- **Edit window.** `responses.edit_locked_at` is set at insert time and every edit is an
  `UPDATE … WHERE edit_locked_at > now() AND employee_id = <owner>`. The countdown in the UI is cosmetic.
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
