# Integrating Career Hub with the 4Geeks platform (Breathcode)

Career Hub v1 runs on its own (own login; advisors mark attendance). It was built so it can join the 4Geeks platform without a rebuild. This page explains what is already in place and what phase 2 needs from the platform team.

## Already in place

| Area | Where | Notes |
|---|---|---|
| External identity | `users.external_provider`, `users.external_id`, `cohorts.external_id` | Holds the Breathcode user and cohort ids |
| Token exchange login | `POST /api/v1/auth/breathcode` (off until `BREATHCODE_ENABLED=true`) | Validates a Breathcode token against `GET {BREATHCODE_API_URL}/v1/auth/user/me`, matches the user by external id, then by email, and returns a Career Hub JWT |
| Single points entry point | `engine.award()` | Any new event source (webhooks, sync jobs) calls this and gets idempotency, pause freezing, clamping, status changes and notifications for free |
| Session logging | `engine.log_session()` | Attendance webhooks should call this so homework checks and streaks behave the same as the advisor form |
| Versioned, documented API | `/api/v1/*`, OpenAPI at `/api/openapi.json` | The platform front end can call it directly or embed screens |
| Portable schema | String UUIDs, generic JSON, Alembic migrations | Can be moved into another Postgres or rewritten as Django models |

## Phase 2 checklist (needs the platform team)

1. **Confirm the Breathcode endpoints and auth scheme.** `breathcode_login` assumes `Authorization: Token <token>` on `/v1/auth/user/me`. Check against the current apiv2 before enabling.
2. **Attendance and mentorship.** Add a webhook receiver, e.g. `POST /api/v1/integrations/breathcode/attendance`, that maps a Breathcode event (session attended or absent, mentorship booked or attended) to `engine.log_session()`. Bookings should update `students.last_activity_at` (the Policy counts a booking as activity).
3. **Project submissions.** Map Breathcode project-delivered events to `engine.project_submitted()`.
4. **Roster sync.** A nightly job that creates or updates `users`, `students` and `cohorts` from Breathcode cohorts in the GeekForce stage, and sets the advisor.
5. **Embedding.** Either link from the 4Geeks app to Career Hub with single sign-on (step 1 is enough), or mount the React pages inside the platform's Next.js app and point them at this API (`VITE_API_URL`).

## Rewriting inside the Django monolith (optional, later)

The models map one to one to Django models. `engine.py` and `jobs.py` are plain functions over a session object, so they port to Django ORM plus Celery beat with the same tests (`backend/tests/test_engine.py` doubles as the behavioral spec).
