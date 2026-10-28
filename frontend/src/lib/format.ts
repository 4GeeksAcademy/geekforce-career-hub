import { locale, t, tmap } from "./i18n";
import type { GStatus } from "./types";

export const statusLabel: Record<string, string> = tmap({
  secured: t("Secured"), at_risk: t("At risk"), suspended: t("Suspended"), not_eligible: t("Not eligible"),
});
export const statusPill: Record<string, string> = { secured: "pb", at_risk: "pa", suspended: "pr", not_eligible: "pg" };
export const statusColor = (s: GStatus | string) =>
  s === "secured" ? "var(--blue)" : s === "at_risk" ? "var(--amber)" : s === "suspended" ? "var(--red)" : "#9AA3AF";
export const statusNum = (s: GStatus | string) =>
  s === "secured" ? "var(--blue-deep)" : s === "at_risk" ? "var(--amber-num)" : s === "suspended" ? "var(--red-ink)" : "var(--ink)";

export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

const d = (s: string | Date) => (typeof s === "string" ? new Date(s.length === 10 ? s + "T12:00:00" : s) : s);
export const fmtDate = (s: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  s ? d(s).toLocaleDateString(locale(), opts) : "—";
export const fmtDateTime = (s: string) =>
  d(s).toLocaleString(locale(), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function relTime(s: string): string {
  const when = d(s);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(when)) / 86400000);
  const time = when.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" });
  if (diff === 0) return t("Today, {time}", { time });
  if (diff === 1) return t("Yesterday, {time}", { time });
  if (diff < 7) return `${when.toLocaleDateString(locale(), { weekday: "short" })}, ${time}`;
  return when.toLocaleDateString(locale(), { month: "short", day: "numeric" });
}

export const appStatus: Record<string, [string, string]> = {
  applied: [t("Applied"), "pb"], phone_screen: [t("Phone screen"), "pa"], technical: [t("Technical"), "pa"],
  final: [t("Final round"), "pa"], offer: [t("Offer"), "pn"], rejected: [t("Rejected"), "pr"], withdrawn: [t("Withdrawn"), "pg"],
};
export const sourceLabel = (s: string) =>
  s === "manual" ? t("Manual") : s === "notion_import" ? t("Imported from Notion") : "Extension · " + s.replace("extension_", "").replace(/^./, (c) => c.toUpperCase());
export const sessionType: Record<string, string> = tmap({
  one_on_one: "1:1 session", group_workshop: t("GeekForce session"), mock_interview: t("Mock interview"),
});
export const todayISO = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

export const stageLabel: Record<string, string> = tmap({
  not_started: t("Not started"), profile: t("Stage 1 · Profile"), interview_prep: t("Stage 2 · Interview prep"),
  job_hunting: t("Stage 3 · Job hunting"), interviewing: t("Interviewing"), placed: t("Placed"),
});
export const planLabel = (p: string | null) => (p === "professional_support" ? t("Professional Support") : p === "job_guarantee" ? t("Job Guarantee") : "—");
export const channelLabel: Record<string, string> = tmap({
  call: t("Call"), slack: t("Slack"), whatsapp: t("WhatsApp"), email: t("Email"), meeting: t("Check-in"), other: t("Other"),
});
