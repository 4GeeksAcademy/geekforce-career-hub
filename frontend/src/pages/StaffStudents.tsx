import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../lib/useApi";
import type { StaffRow } from "../lib/types";
import { fmtDate, stageLabel, statusColor } from "../lib/format";
import { ErrorBox, Spinner, StatusPill } from "../components/ui";
import { useAuth } from "../lib/auth";
import { locale, t } from "../lib/i18n";

type List = { summary: Record<string, number>; stage_counts: Record<string, number>; items: StaffRow[]; target: number; max_missed: number; cohorts: { id: string; name: string }[] };
type Att = { kind: string; student_id: string; pause_id?: string; text: string };
const ATT: Record<string, [string, string]> = { suspended: [t("Suspended"), "pr"], on_hold: [t("On hold"), "pr"], meetings: [t("Meetings"), "pr"],
  follow_up: [t("Follow-up"), "pb"], inactive: [t("Inactive"), "pa"], offer: [t("Offer"), "pa"], pause: [t("Pause"), "pg"], onboarding: [t("Onboarding"), "pg"] };

export default function StaffStudents() {
  const [cohort, setCohort] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const list = useApi<List>(`/advisor/students?${new URLSearchParams({ ...(cohort && { cohort_id: cohort }), ...(status && { status }), ...(q && { q }), ...(stage && { stage }) })}`);
  const att = useApi<Att[]>("/advisor/attention");
  const nav = useNavigate();
  const s = list.data?.summary;
  const { user } = useAuth();
  const first = (user?.name || "").split(" ")[0];
  const h = new Date().getHours();
  const greet = h < 12 ? t("Good morning") : h < 18 ? t("Good afternoon") : t("Good evening");
  const n = att.data?.length ?? 0;
  const firstAtt = att.data?.find((a) => a.kind !== "pause" && a.kind !== "onboarding");

  return (
    <>
      <header className="top"><div><div className="kick">{t("GeekForce · Career Hub")}</div><h1>{t("My")} <em>{t("students.")}</em></h1><div className="sub">{t("Sorted by who needs you first")}</div></div></header>
      <div className="content">
        <section className="hero">
          <div style={{ flex: "1 1 420px" }}>
            <span className="chipy">{new Date().toLocaleDateString(locale(), { weekday: "long", month: "short", day: "numeric" }).toUpperCase()}</span>
            <h2>{greet}, {first}. {n ? <><em>{n} {n === 1 ? t("thing needs") : t("things need")} {t("you")}</em> {t("today.")}</> : <>{t("Everyone is")} <em>{t("on track.")}</em></>}</h2>
            {s && <p>{t("{n} students · {secured} secured · {at_risk} at risk · {suspended} suspended · {hired} hired", { n: s.students, secured: s.secured, at_risk: s.at_risk, suspended: s.suspended, hired: s.hired })}</p>}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {firstAtt ? <Link className="btn by" to={`/staff/students/${firstAtt.student_id}`}>{t("Start with the first one")}</Link>
              : <Link className="btn by" to="/staff/onboarding">{t("Open onboarding")}</Link>}
            <Link className="btn bwo" to="/staff/notifications">{t("See alerts")}</Link>
          </div>
        </section>

        {s && <div className="stats">
          <div className="stat"><span className="l">{t("Students")}</span><span className="v">{s.students}</span><span className="c">{s.hired} {t("hired")}</span></div>
          <div className="stat s-blue"><span className="l">{t("Secured")}</span><span className="v">{s.secured}</span><span className="c">{t("80+ points")}</span></div>
          <div className="stat s-amber"><span className="l">{t("At risk")}</span><span className="v">{s.at_risk}</span><span className="c">{t("60–79 points")}</span></div>
          <div className="stat s-red"><span className="l">{t("Suspended")}</span><span className="v">{s.suspended}</span><span className="c">{t("below 60")}</span></div>
          <div className="stat"><span className="l">{t("On pause")}</span><span className="v">{s.paused}</span><span className="c">{t("deductions frozen")}</span></div>
        </div>}

        {list.data && <section className="card stack" style={{ gap: 12 }}>
          <div className="between"><h2 className="h2">{t("Students by")} <em>{t("stage")}</em></h2>{stage && <button className="btn bg sm" onClick={() => setStage("")}>{t("Show all")}</button>}</div>
          <div className="grid" style={{ gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
            {[["not_started", t("Not started"), "0"], ["profile", t("Stage 1 · Profile"), "1"], ["interview_prep", t("Stage 2 · Interview prep"), "2"],
              ["job_hunting", t("Stage 3 · Job hunting"), "3"], ["interviewing", t("Interviewing"), "★"], ["placed", t("Placed"), "✓"]].map(([k, l, n]) => {
              const on = stage === k;
              return <button key={k} onClick={() => setStage(on ? "" : k)} className="stat" style={{ cursor: "pointer", textAlign: "left", font: "inherit",
                background: on ? "var(--blue-deep)" : k === "job_hunting" || k === "interviewing" ? "#E9F2FE" : "#fff", color: on ? "#fff" : undefined,
                borderColor: on ? "var(--blue-deep)" : undefined }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="ynum" style={{ width: 24, height: 24, fontSize: 12 }}>{n}</span>
                  <span className="l" style={{ color: on ? "#fff" : undefined }}>{l}</span></span>
                <span className="v">{list.data!.stage_counts?.[k] ?? 0}</span></button>;
            })}
          </div>
        </section>}

        {att.data && att.data.length > 0 && (
          <section className="card" style={{ display: "flex", flexDirection: "column" }}>
            <div className="between" style={{ marginBottom: 4 }}><h2 className="h2">{t("Needs your")} <em>{t("attention")}</em></h2><span className="cap">{att.data.length} {t("items")}</span></div>
            {att.data.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 0", borderBottom: "1px solid var(--line-soft)", flexWrap: "wrap" }}>
                <span className="ynum">{i + 1}</span><span className={`pill ${ATT[a.kind][1]}`}>{ATT[a.kind][0]}</span>
                <div style={{ flex: "1 1 300px" }}>{a.text}</div>
                <Link className="btn bg sm" to={a.kind === "pause" ? "/admin" : a.kind === "onboarding" ? "/staff/onboarding" : `/staff/students/${a.student_id}`}>{a.kind === "pause" ? t("Review request") : a.kind === "onboarding" ? t("Open onboarding") : t("Open student")}</Link>
              </div>))}
          </section>)}

        <section className="card stack" style={{ gap: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <h2 className="h2" style={{ marginRight: "auto" }}>{t("All")} <em>{t("students")}</em></h2>
            <label><span className="sr">{t("Cohort")}</span><select className="in" value={cohort} onChange={(e) => setCohort(e.target.value)}>
              <option value="">{t("All cohorts")}</option>{list.data?.cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label><span className="sr">{t("Status")}</span><select className="in" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("All statuses")}</option><option value="secured">{t("Secured")}</option><option value="at_risk">{t("At risk")}</option><option value="suspended">{t("Suspended")}</option><option value="paused">{t("On pause")}</option><option value="hired">{t("Hired")}</option><option value="not_to_be_placed">{t("Not to be placed")}</option></select></label>
            <label><span className="sr">{t("Search")}</span><input className="in" type="search" placeholder={t("Search name")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
          </div>
          {list.loading ? <Spinner /> : <ErrorBox error={list.error} />}
          {list.data && (list.data.items.length === 0 ? <div className="empty">{t("No students yet. Admins add them under People & cohorts.")}</div> :
            <div className="tw"><table>
              <thead><tr><th>{t("Student")}</th><th>{t("Points")}</th><th>{t("Status")}</th><th>{t("Stage")}</th><th>{t("Apps this week")}</th><th>{t("Missed mtgs")}</th><th>{t("Homework")}</th><th>{t("Last active")}</th><th>{t("Next session")}</th></tr></thead>
              <tbody>{list.data.items.map((r) => (
                <tr key={r.id} className="click" onClick={() => nav(`/staff/students/${r.id}`)}>
                  <td><Link to={`/staff/students/${r.id}`} style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--ink)", fontWeight: 700 }} onClick={(e) => e.stopPropagation()}>
                    <span className="av soft" style={{ width: 36, height: 36, fontSize: 13 }}>{r.initials}</span>
                    <span style={{ whiteSpace: "nowrap" }}>{r.name}<span className="cap" style={{ display: "block", fontWeight: 500 }}>{r.cohort}</span></span></Link></td>
                  <td style={{ whiteSpace: "nowrap" }}><span className="num">{r.points}</span>
                    <span style={{ width: 72, height: 6, borderRadius: 3, background: "var(--line)", display: "inline-block", verticalAlign: "middle", marginLeft: 10, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${r.points}%`, background: statusColor(r.guarantee_status) }} /></span></td>
                  <td>{r.status === "hired" ? <span className="pill pn">{t("Hired")}</span> : r.status === "not_to_be_placed" ? <span className="pill pg">{t("Not to be placed")}</span> : r.on_hold ? <span className="pill pr">{t("On hold")}</span> : <StatusPill status={r.guarantee_status} paused={r.paused} />}</td>
                  <td className="cap" style={{ whiteSpace: "nowrap" }}>{r.display_stage ? stageLabel[r.display_stage] : "—"}</td>
                  <td className="num" style={{ color: r.apps_this_week < r.target ? "var(--amber-ink)" : undefined }}>{r.apps_this_week} / {r.target}</td>
                  <td>{r.missed_meetings} / {list.data!.max_missed}</td>
                  <td>{r.homework_streak ? t("{homework_streak} miss{v1} in a row", { homework_streak: r.homework_streak, v1: r.homework_streak > 1 ? "es" : "" }) : "—"}</td>
                  <td className="cap" style={{ whiteSpace: "nowrap" }}>{r.idle_days == null ? "—" : r.idle_days === 0 ? t("Today") : t("{idle_days} day{v1} ago", { idle_days: r.idle_days, v1: r.idle_days === 1 ? "" : "s" })}</td>
                  <td className="cap" style={{ whiteSpace: "nowrap" }}>{r.next_session ? fmtDate(r.next_session) : t("Not booked")}</td>
                </tr>))}</tbody></table></div>)}
        </section>
      </div>
    </>);
}
