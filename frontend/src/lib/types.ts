export type Role = "student" | "advisor" | "admin";
export type GStatus = "secured" | "at_risk" | "suspended" | "not_eligible";

export interface StudentBrief {
  id: string; name: string; email: string; initials: string; cohort: string | null; program: string | null;
  location: string | null; region: string | null; advisor: string | null; advisor_id: string | null;
  points: number; guarantee_status: GStatus; status: "onboarding" | "active" | "hired" | "withdrawn" | "not_to_be_placed"; paused: boolean;
  paused_until: string | null; on_hold: boolean; stage: string | null;
  enrollment_plan: "job_guarantee" | "professional_support" | null; suspended_at: string | null; from_notion: boolean;
  reschedules_used?: number; missed_meetings?: number; payments_behind?: boolean | null;
  status_reason?: string | null; status_changed_at?: string | null;
}
export interface Me { id: string; email: string; name: string; initials: string; role: Role; student: StudentBrief | null }

export interface PointsEvent {
  id: string; type: string; title: string; delta: number; applied_delta: number; balance_after: number;
  source: string; note: string | null; created_at: string;
}
export interface Homework {
  id: string; session_id: string | null; description: string; due_date: string | null; due_by_next_meeting?: boolean; point_value: number;
  status: "pending" | "completed" | "missed"; completed_at: string | null; verified_by_advisor: boolean;
}
export interface SessionRec {
  id: string; session_date: string; session_type: "one_on_one" | "group_workshop" | "mock_interview";
  attendance: "attended" | "excused" | "rescheduled" | "absent" | "scheduled"; title: string | null; summary: string | null;
  resources: { label: string; url: string }[]; advisor: string | null; points: number | null; homework: Homework[];
}
export interface Condition { key: string; title: string; detail: string; ok: boolean; badge: string | null }
export interface Action { title: string; why: string; points: number; link: string }
export interface Pause {
  id: string; student_id: string; start_date: string; end_date: string; days: number; reason_type: string;
  reason: string | null; status: string; extension_days: number; created_at: string; student_name?: string;
  student_initials?: string; deadline_before?: string | null; deadline_after?: string | null; pauses_used?: number;
}
export interface Dashboard {
  student: StudentBrief; points: number; status: GStatus;
  thresholds: { secured: number; suspended_below: number; ceiling: number; floor: number };
  gap_to_secure: number;
  week: { applications: number; target: number; quota_applies: boolean; closes_at: string; linkedin_posts: number; linkedin_cap: number;
    outreach: number; outreach_cap: number; pts_application: number; weekly_bonus: number; weekly_penalty: number };
  missed_meetings: number; max_missed_meetings: number; homework_streak: number;
  pending_homework: Homework[]; next_session: SessionRec | null; actions: Action[]; conditions: Condition[];
  recent: PointsEvent[];
  deadline: { base_days: number; extension_days: number; total_days: number; day: number | null; deadline: string | null };
  pause: { active: boolean; from: string | null; until: string | null; available: number; max_days: number;
    multiplier: number; pending: Pause | null };
  unread_notifications: number; rules: Record<string, number>;
}
export interface AppItem {
  id: string; company: string; role: string; job_url: string | null; status: string; source: string;
  notes: string | null; followup_date: string | null; applied_at: string; created_at: string;
}
export interface Activity {
  id: string; kind: "outreach" | "linkedin_post" | "networking"; contact_name: string | null; company: string | null;
  platform: string | null; url: string | null; post_type: string | null; notes: string | null; occurred_on: string;
  points_awarded: number; status: "active" | "rejected"; rejected_reason: string | null;
}
export interface Interaction {
  id: string; occurred_at: string; channel: string; summary: string; visibility: "private" | "shared";
  advisor: string | null; follow_up_date?: string | null; follow_up_done?: boolean;
}
export interface Notif { id: string; type: string; category: string; title: string; body: string; link: string | null;
  read: boolean; email_sent: boolean; created_at: string }
export interface Analysis {
  tailoring_score: number; projected_score?: number; keyword_gaps: string[];
  feedback: { type: "good" | "warn" | "bad"; text: string }[]; suggested_summary: string;
  suggested_bullets: { before: string; after: string }[];
}
export interface StaffRow extends StudentBrief {
  display_stage: string | null; target: number;
  apps_this_week: number; missed_meetings: number; homework_streak: number; last_active: string | null;
  idle_days: number | null; next_session: string | null;
}
export interface Rule { key: string; label: string; group: "thresholds" | "earn" | "lose"; value: number; default: number }
