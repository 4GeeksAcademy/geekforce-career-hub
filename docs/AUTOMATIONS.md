# Automations page

**Manage → Automations** explains, in plain language and in English and Spanish, every automation of the GeekForce area. Admins and advisors can read it; nobody edits it from the app yet.

Each automation has a card with two tabs:

- **Card:** what it does, what starts it (schedule shown in Spain and Miami time, or the event), who it affects, its rules, what it changes, what happens if something fails, its connections with other automations, things to keep in mind, and where the code lives.
- **Diagram:** the flow as a chart: start, steps (reads, writes, sends, calculates), decisions with their branches, links to other automations, failure points and ends.

The page also has a weekly calendar (Spain or Miami time). Connections are shown on each card.

## Where the content lives

`frontend/src/data/automations.ts` holds all of it. It's a technical edit on purpose (phase 2 is a trial).

| What | Where in the file |
|---|---|
| A card | an item in `AUTOMATIONS` (every text is `x("español", "English")`) |
| Its diagram | the card's `diagram` array (`start`, `step`, `decision` with `branches`, `link` to another card's `id`, `error`, `end`) |
| A connection | `EDGES` (`feeds`, `runs_before`, `data`, `similar`). Both cards show it, so add it once |

Schedules: `days` uses 1 = Monday … 7 = Sunday. GitHub flows use `tz: "UTC"` (their cron is UTC); Career Hub jobs use `tz: "America/New_York"` (the server's `TIMEZONE`). The page converts to Spain and Miami time, daylight saving included.

**Keep it true to the code.** Each card was written from the code, not from older docs:

| Card | Source |
|---|---|
| Not Started, Missing, Stage 1 y 2, On Hold, Stage 3 | `4GAES/GF_Automations`: `services/<name>/index.js`, `.github/workflows/*.yml`, `config/*.json` |
| Notion sync, Daily checks, Reminders, Friday nudge, Weekly check, Job Radar, ActiveCampaign sync | `backend/app/jobs.py`, `notion_sync.py`, `job_radar.py`, `rules.py` |
| Job intake (grokbot) | `backend/app/routers/jobs_routes.py` |
| Stage and status change events | `backend/app/events.py`, `stages.py` |

When one of those changes, update its card in the same pull request.

## What reading the code turned up (Nov 2026)

These are on the cards ("Good to know" and "If something fails"). Nothing was changed in GF_Automations.

1. **Failure alerts don't arrive.** In `_reusable-node-service.yml`, the «Notificar fallo» step posts to `$N8N_WEBHOOK_URL`, but that step only sets `ZAPIER_WEBHOOK_URL`. The `curl` fails silently (`|| true`).
2. **Notion is updated before the messages are sent** in Not Started, Missing and On Hold. If n8n fails after three tries, students are tagged as contacted without getting anything. Stage 1/2 and Stage 3 do it in the safe order (send first).
3. **Stage 1/2 may never move anyone to Missing:** it writes `Placement status` as `select`; the other flows write it as `status`.
4. **On Hold:** the email says "your on-hold period ends in 5 days" but is sent 5 days *after* `On Hold until`. The rule is "exactly day 5": if that day's run fails, the student never gets the email nor moves to Not attended. It also replaces all `GF Follow up` tags with `Email-on-hold`, erasing the history the other flows rely on.
5. **Stage 3** only sends messages dated today: a failed day is lost unless re-run the same day. Messages with an empty field are skipped silently.
6. **Stage 1/2 "stalled" alert** requires more than 2 months left to `Cohort end date`, so it never fires for graduates whose cohort already ended.
7. **GitHub cron is UTC:** "12:00 Spain" is only true in summer; in winter they run one hour earlier.
8. **Career Hub jobs** have no run history and no failure alerts: errors only reach the Railway logs (phase 3 fixes this).

## Phase 3 (documented, not built): live status

Goal: every card shows **last run · result · how long ago · link to the log**, plus the last 10 runs, and the overview flags anything that failed or didn't run when it should have.

### Career Hub jobs: record every run

1. New table `job_runs` (Alembic migration): `id`, `job` (name in `JOBS`), `started_at`, `finished_at`, `ok`, `summary` (JSON: what `run_job` returns today), `error` (text), `trigger` (`schedule` | `admin:<user id>` | `cron_endpoint`).
2. Wrap `jobs.run_job()`: insert the row, run the job, store the result or the exception (with traceback), then re-raise so APScheduler still logs it. Pass the trigger from `admin_run_job` and `cron_run_job`.
3. `notion_sync` already writes `sync_runs`; either keep it and read both, or move it to `job_runs`.
4. `GET /api/v1/automations/status` (staff): last run and the last 10 per job.
5. Event-driven automations: count deliveries instead of runs. `events._deliver` writes `ok` / `failed` per event (a small `event_deliveries` table, or a counter per day), and `POST /integrations/jobs` logs each call.

### GitHub Actions flows: read the runs

1. A fine-grained GitHub token, read-only, **Actions: read** on `4GAES/GF_Automations` only. Railway variable `GITHUB_ACTIONS_TOKEN` (and optionally `GF_AUTOMATIONS_REPO=4GAES/GF_Automations`).
2. Server side only: `GET https://api.github.com/repos/{repo}/actions/workflows/{file}/runs?per_page=10` for `orquestador-viernes.yml`, `stage1-2.yml`, `on-hold.yml`, `stage3.yml`. For the Friday orchestrator, read the run's jobs (`/actions/runs/{id}/jobs`) to split Not Started and Missing.
3. Cache the answer for 5 minutes (GitHub's rate limit is 5,000 requests per hour per token; one page load must not call GitHub 4 times).
4. Same endpoint `GET /api/v1/automations/status` merges both sources. Each card maps to a source with a new field in `automations.ts`, e.g. `status: { github: "stage1-2.yml" }` or `status: { hub: "daily" }`.

### UI

- Card header: a status pill (green "OK 2 h ago", amber "didn't run when expected", red "failed") and a "See log" link (GitHub run URL, or the stored error for the Hub).
- Card tab "Runs": the last 10, with result and summary (for example "3 emails sent, 1 error").
- Without `GITHUB_ACTIONS_TOKEN` the page still works and says "status not available".
- "Didn't run when expected" compares the last run with the schedule already in `automations.ts`.

### Later

- Admin-editable cards (move the catalog to the database, keep this file as the seed).
- Alerts on failure (Slack or email) from the same status data.
- Fixes in GF_Automations once the team decides the future of those flows (see the list above).
