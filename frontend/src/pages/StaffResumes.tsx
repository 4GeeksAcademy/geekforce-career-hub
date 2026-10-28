import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ResumeWorkspace } from "../components/ResumeWorkspace";
import { IBack } from "../components/Icons";
import { ErrorBox, Spinner } from "../components/ui";
import { relTime } from "../lib/format";
import { useApi } from "../lib/useApi";
import { StudioTabs } from "./ResumeTemplates";
import { t } from "../lib/i18n";

type Row = { id: string; name: string; cohort: string | null; stage: string | null; status: string; approved_at: string | null;
  updated_at: string | null; submitted_at: string | null; tailored: number; template: string | null };
type Data = { items: Row[]; ai: { available: boolean; spent_usd: number; budget_usd: number; configured: boolean } };

const ST: Record<string, [string, string]> = {
  in_review: [t("Waiting for you"), "pa"], changes_requested: [t("Changes requested"), "pr"], draft: [t("Draft"), "pg"],
  none: [t("No resume yet"), "pg"], approved: [t("Approved"), "pb"],
};

export function StaffResumes() {
  const r = useApi<Data>("/advisor/resumes");
  const [f, setF] = useState("all");
  if (r.loading) return <Spinner />;
  if (r.error) return <div className="content"><ErrorBox error={r.error} /></div>;
  const d = r.data!;
  const count = (k: string) => d.items.filter((x) => x.status === k).length;
  const rows = d.items.filter((x) => f === "all" || x.status === f);
  return (
    <>
      <header className="top"><div><div className="kick">{t("Resume Studio")}</div><h1>{t("Build, review and")} <em>{t("approve")}</em> {t("resumes")}</h1></div></header>
      <div className="content">
        <StudioTabs on="students" />
        <div className="stats">
          {([["in_review", t("Waiting for review"), "s-amber"], ["changes_requested", t("Changes requested"), "s-red"], ["none", t("No resume yet"), "s-cream"],
            ["approved", t("Approved"), "s-blue"]] as const).map(([k, l, c]) =>
            <button key={k} className={`stat ${c}`} style={{ textAlign: "left", cursor: "pointer", outline: f === k ? "3px solid var(--blue-deep)" : undefined }}
              onClick={() => setF(f === k ? "all" : k)}><span className="l">{l}</span><span className="v">{count(k)}</span></button>)}
          <div className="stat"><span className="l">{t("Hub AI this month")}</span><span className="v" style={{ fontSize: 30 }}>${d.ai.spent_usd.toFixed(2)}</span>
            <span className="c">{t("of ${budget} budget", { budget: d.ai.budget_usd.toFixed(0) })}{d.ai.configured ? "" : t(" · not configured")}</span></div>
        </div>
        <div className="tw"><table>
          <thead><tr><th>{t("Student")}</th><th>{t("Resume")}</th><th>{t("Template")}</th><th>{t("Tailored versions")}</th><th>{t("Last change")}</th></tr></thead>
          <tbody>{rows.map((x) => <tr key={x.id} className="click">
            <td><Link to={`/staff/resumes/${x.id}`} style={{ fontWeight: 700, color: "var(--ink)" }}>{x.name}</Link><div className="cap">{x.cohort}</div></td>
            <td><span className={`pill ${ST[x.status]?.[1] || "pg"}`}>{ST[x.status]?.[0] || x.status}</span>
              {x.status === "in_review" && x.submitted_at && <div className="cap">{t("sent")} {relTime(x.submitted_at)}</div>}</td>
            <td className="cap">{x.template || "—"}</td><td className="num">{x.tailored}</td>
            <td className="cap">{x.updated_at && x.status !== "none" ? relTime(x.updated_at) : "—"}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={5} className="cap">{t("No students here.")}</td></tr>}</tbody></table></div>
      </div>
    </>);
}

export function StaffResume() {
  const { id } = useParams();
  const r = useApi<{ student: { name: string } }>(`/students/${id}/resume`);
  return (
    <>
      <header className="top no-print"><div>
        <Link to="/staff/resumes" className="cap" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IBack size={14} />{t("Resume Studio")}</Link>
        <h1 style={{ marginTop: 6 }}>{r.data ? <>{r.data.student.name.split(" ")[0]}'s <em>{t("resume")}</em></> : t("Resume")}</h1></div>
        <Link className="btn bg sm" to={`/staff/students/${id}`}>{t("Student profile")}</Link></header>
      <div className="content"><ResumeWorkspace studentId={id!} staff /></div>
    </>);
}
