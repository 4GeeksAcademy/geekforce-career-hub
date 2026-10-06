import type { GStatus } from "./types";

export const statusLabel: Record<string, string> = {
  secured: "Secured", at_risk: "At risk", suspended: "Suspended", not_eligible: "Not eligible",
};
export const statusPill: Record<string, string> = { secured: "pb", at_risk: "pa", suspended: "pr", not_eligible: "pg" };
export const statusColor = (s: GStatus | string) =>
  s === "secured" ? "var(--blue)" : s === "at_risk" ? "var(--amber)" : s === "suspended" ? "var(--red)" : "#9AA3AF";
export const statusNum = (s: GStatus | string) =>
  s === "secured" ? "var(--blue-deep)" : s === "at_risk" ? "var(--amber-num)" : s === "suspended" ? "var(--red-ink)" : "var(--ink)";

export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

const d = (s: string | Date) => (typeof s === "string" ? new Date(s.length === 10 ? s + "T12:00:00" : s) : s);
export const fmtDate = (s: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  s ? d(s).toLocaleDateString("en-US", opts) : "—";
export const fmtDateTime = (s: string) =>
  d(s).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function relTime(s: string): string {
  const t = d(s);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(t)) / 86400000);
  const time = t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Yesterday, ${time}`;
  if (diff < 7) return `${t.toLocaleDateString("en-US", { weekday: "short" })}, ${time}`;
  return t.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const appStatus: Record<string, [string, string]> = {
  applied: ["Applied", "pb"], phone_screen: ["Phone screen", "pa"], technical: ["Technical", "pa"],
  final: ["Final round", "pa"], offer: ["Offer", "pn"], rejected: ["Rejected", "pr"], withdrawn: ["Withdrawn", "pg"],
};
export const sourceLabel = (s: string) =>
  s === "manual" ? "Manual" : s === "notion_import" ? "Imported from Notion" : "Extension · " + s.replace("extension_", "").replace(/^./, (c) => c.toUpperCase());
export const sessionType: Record<string, string> = {
  one_on_one: "1:1 session", group_workshop: "GeekForce session", mock_interview: "Mock interview",
};
export const todayISO = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

export const stageLabel: Record<string, string> = {
  not_started: "Not started", profile: "Stage 1 · Profile", interview_prep: "Stage 2 · Interview prep",
  job_hunting: "Stage 3 · Job hunting", interviewing: "Interviewing", placed: "Placed",
};
export const planLabel = (p: string | null) => (p === "professional_support" ? "Professional Support" : p === "job_guarantee" ? "Job Guarantee" : "—");
export const channelLabel: Record<string, string> = {
  call: "Call", slack: "Slack", whatsapp: "WhatsApp", email: "Email", meeting: "Check-in", other: "Other",
};
