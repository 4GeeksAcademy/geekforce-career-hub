# Product decisions (v1)

Settled with Marcelo on Oct 4–6, 2026. Every value marked ⚙ is an admin setting (Admin → Rules & points), so changing it doesn't need code.

## Points & guarantee

| Topic | Decision |
|---|---|
| Source of rules | Career Points Policy v1.0 wins over the Product Spec where they differ |
| Balance | One running balance, floor 0, ceiling 100 ⚙, never resets |
| Starting balance | Set by the advisor at activation. Pre-filled with 80 + 3 × applications in the last 30 days, capped at 100 |
| Thresholds | Secured 80+ ⚙ · At risk 60–79 · Suspended below 60 ⚙ |
| **Suspension** | **Permanent.** Falling below 60, or reaching day 30 of the Not Started ladder, suspends the guarantee for good. The student keeps career support, sessions and points |
| Reinstatement | Admins only, with a written reason, and the balance must be 60 or more. Audited |
| Hard rules | Only points suspend the guarantee. 3 missed meetings and rejected offers cost points and trigger an advisor review |
| Weekly target | 15 for Job Guarantee ⚙, 10 for Professional Support ⚙. No proration; first partial week skipped. Starts at Stage 3 · Job hunting |
| Homework on time | Done before the next 1:1 (the due date is a reminder) |
| LinkedIn | −10 only after 14 days with no activity ⚙; the weekly original post is encouraged, not penalized |
| Inactivity | Real actions only: applications, logged activity, homework, sessions. Logging in doesn't count |
| Self-reported entries | Advisors can reject a LinkedIn post, outreach or networking entry: points removed, student notified, logged |
| Valid offer | The advisor decides case by case; the −30 needs the student's written reason on file |
| Resume downloads | No points ⚙ |
| Not Started ladder | No first 1:1 after activation: day 7 follow-up (student + advisor), day 15 on hold (automatic deductions frozen), day 30 guarantee lost ⚙ |

## Students & data

| Topic | Decision |
|---|---|
| Roster | **Notion stays the source of truth.** Nightly sync (12:30 AM) plus a "Sync from Notion" button. Advisors can also add a student manually |
| Who syncs | Miami Student Tracker rows with GeekForce Status = Active. Only "Job Guarantee" plans get a guarantee; "Regular Student" and "Special Scholarship" become Professional Support; "No-CareerSupport" is skipped |
| Stages | Synced from "GeekForce Stages completion" (the most advanced one wins). Placement Status = Placed means placed/hired. "Interviewing" is derived from the application pipeline |
| Application history | Each student's Notion Job Application Tracker is imported once, during onboarding. Imported applications earn no points; the advisor's starting balance replaces them |
| Activation | Advisor reviews the history, sets the balance, and the student gets a login by email |
| Interaction log | Every touchpoint (call, Slack, WhatsApp, email, check-in) with follow-up reminders. Private notes are staff-only; shared notes appear in the student's Advisor Hub |
| Stack | React + FastAPI + Postgres on Railway; 4Geeks/Breathcode login in phase 2 |
| Status colors | Blue = secured, amber = at risk, red = suspended (brand excludes green; colorblind-safe) |

## Phase 2 (v1.1), from Victor's GeekForce Hub prototype

Built on the same app and data:

- **Job Radar:** daily 10:00 AM sweep of job sources using per-program title sets. It reuses Lali's Adzuna feed and adds the team's filters (US only, Easy Apply, entry level, under 24h old, under 50 applicants).
- **Graduate–job matching:** match score by program, skills and work mode. "Who fits" per job, with drafts for all who fit.
- **Talent Pipeline:** profiles of students past Stages 1–2, plus 3–5-person shortlists per partner job (in the style of Ironhack's Fast-track Interviews).
- **Draft automations a coach approves:** daily job digest as Slack DM drafts (max 2 links), and an interview kit when an application moves to Interviewing.
- **GeekForce Weekly:** Monday research brief with sources.
- **Integrations:** Slack drafts, Calendly (completed sessions update the stage), Notion write-back.
