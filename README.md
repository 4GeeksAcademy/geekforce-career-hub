# GeekForce Career Hub

The student career portal for 4Geeks Academy's GeekForce program. It covers job applications, career points, the Job Guarantee, advisor sessions and homework, AI resume tailoring, and a Chrome extension that logs applications automatically.

Rules come from **GeekForce Career Points Policy v1.0** (March 2026). Screens and data model come from the **Career Hub Product Spec v1.0**.

| Part | Tech | Folder |
|---|---|---|
| API + scheduled checks | Python 3.13, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL, APScheduler | `backend/` |
| Web app (students, advisors, admins) | React 18, TypeScript, Vite | `frontend/` |
| Chrome extension | Manifest V3 | `extension/` |
| Email | Brevo transactional API | `backend/app/services/brevo.py` |
| AI resume builder | Claude API, called from the server only | `backend/app/services/resume.py` |

The API serves the built web app, so production is **one Railway service plus one Postgres database**.

## What's inside

**Students:** dashboard with points gauge and guarantee status; a ranked "fastest way back to 80" list; Job Tracker (applications, recruiter outreach, LinkedIn posts, networking); AI Resume Builder with a .docx download and saved versions; Points & Guarantee page with a full ledger and the 7 guarantee conditions; pause requests; Advisor Hub with notes and homework; notifications and email preferences.

**Advisors:** student list sorted by risk; a "needs your attention" feed; a student detail page; session logging with a **live preview of every point consequence before saving**; scheduling; manual adjustments (reason required); offer-rejection reports; project receipts; marking a student hired.

**Admins:** pause approvals with deadline math; every point value and threshold editable; people and cohorts; audit log; integration status; manual run of scheduled checks.

**Automations**, all idempotent so a re-run never double-charges:

| Job | When (TIMEZONE) | What it does |
|---|---|---|
| `weekly_check` | Mon 06:00 | Previous week under 15 applications → −10; 15 or more → +10 bonus |
| `friday_nudge` | Fri 17:00 | In-app warning if under target |
| `daily` | 01:00 | Ends pauses; 14-day LinkedIn and outreach checks (−10); inactivity: day-25 warning, then day 31 −20 and −10 each week after; refreshes status |
| `reminders` | 09:00 | Homework due in 48h; pause ending in 3 days |

Session-time rules apply when an advisor saves a session: +20 for a 1:1, +10 for a workshop or mock interview; −10 for an absence without notice (counts toward the 3-miss limit); −15 for each unfinished homework task; −10 extra on a second miss in a row. During an approved pause, automatic deductions are frozen and the guarantee status is frozen.

## Run locally

```bash
# 1. Postgres
createdb geekforce   # or: docker run -p 5432:5432 -e POSTGRES_USER=gf -e POSTGRES_PASSWORD=gf -e POSTGRES_DB=geekforce postgres:16

# 2. API
cd backend
pip install -r requirements-dev.txt
cp ../.env.example .env            # edit DATABASE_URL, JWT_SECRET
alembic upgrade head
SEED_DEMO=true uvicorn app.main:app --reload --port 8000

# 3. Web app (separate terminal), proxies /api to :8000
cd frontend && npm install && npm run dev   # http://localhost:5173
```

Demo accounts (only with `SEED_DEMO=true`), password `geekforce-demo`:
`maria@geekforce.demo` (student, at risk) · `valentina@geekforce.demo` (advisor) · `admin@geekforce.demo` (admin).

Tests: `cd backend && python -m pytest -q` (24 tests; every Policy rule has one). They need a Postgres database; set it with `TEST_DATABASE_URL`.

API docs: `http://localhost:8000/api/docs`.

## Deploy on Railway

1. New project → **Deploy from GitHub repo** → `4GeeksAcademy/geekforce-career-hub`. Railway uses the `Dockerfile` and `railway.json`.
2. Add a **PostgreSQL** service, then on the app service set `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
3. Set the variables from `.env.example`. At minimum: `JWT_SECRET`, `APP_URL`, `ENABLE_SCHEDULER=true`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`. Add `BREVO_API_KEY` and `ANTHROPIC_API_KEY` when ready.
4. Generate a domain. Migrations run on every deploy (`backend/start.sh`).

Keep `numReplicas` at 1 while `ENABLE_SCHEDULER=true`. When scaling out, turn the scheduler off and call `POST /api/v1/cron/{job}` with header `X-Cron-Secret` from an n8n or Railway cron instead.

## Chrome extension

1. Set `DEFAULT_HUB_URL` in `extension/config.js` to the Railway domain. If it's a custom domain, also add it to `host_permissions` and to the `hub-bridge.js` matches in `manifest.json`.
2. Test: `chrome://extensions` → Developer mode → **Load unpacked** → choose `extension/`.
3. Publish: zip the folder and upload it to the Chrome Web Store developer dashboard.

How it works: it remembers the job you're viewing, watches for the confirmation ("Your application was sent", Greenhouse/Lever thank-you pages, Indeed post-apply), then posts it to the API (+3 points) and shows a confirmation. If the request fails, it queues the application and retries every 5 minutes. The same job within 24h is never counted twice. Students sign in from the popup, or automatically when they sign in on the website.

Job boards change their markup often. Selectors live in `extension/sites.js`, with fallbacks for each site.

## Integrating with the 4Geeks platform

See [docs/INTEGRATION.md](docs/INTEGRATION.md).
