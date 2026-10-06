# Product decisions (v1)

Agreed with Marcelo on Oct 4, 2026. Items marked *assumption* still need Valentina's confirmation. All of them are admin settings or small changes, not rebuilds.

| Topic | Decision |
|---|---|
| Source of rules | Career Points Policy v1.0 wins over the Product Spec where they differ (15 applications/week, +3 each, start at 80) |
| Stack | React + FastAPI + Postgres on Railway (same as Commission Tracker and Instructor Payroll) |
| Login | Own accounts for v1; 4Geeks/Breathcode login in phase 2 (`docs/INTEGRATION.md`) |
| Attendance | Advisors log it in Career Hub until Breathcode sync exists |
| Scope | All modules plus the Chrome extension in the first release |
| Points model | One running balance (start 80, floor 0, ceiling 100), no monthly reset |
| Resume downloads | 0 points (Policy dropped the Spec's +5). Admins can set "Tailored resume downloaded" to 5. *assumption* |
| Restoring a suspended guarantee | Automatic when the balance is back to 80 or more. *assumption* |
| LATAM | Same 15/week cadence. *assumption* |
| Job search deadline | Per cohort (`deadline_days`), default 180, overridable per student. *assumption* |
| Advisor visibility | Advisors see their own students; admins see everyone. *assumption* |
| Resume versions | Stored server-side, so students keep a history per job |
| Status colors | Blue = secured, amber = at risk, red = suspended (4Geeks brand excludes green; also colorblind-safe) |
| Hired | Advisors can mark a student hired, which stops point tracking |
| Time zone | All weeks and checks use `TIMEZONE` (default America/New_York). Per-region time zones would be a v1.1 item |
