import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../lib/useApi";
import type { StaffRow } from "../lib/types";
import { fmtDate, statusColor } from "../lib/format";
import { ErrorBox, Spinner, StatusPill } from "../components/ui";

type List = { summary: Record<string, number>; items: StaffRow[]; target: number; max_missed: number; cohorts: { id: string; name: string }[] };
type Att = { kind: string; student_id: string; pause_id?: string; text: string };
const ATT: Record<string, [string, string]> = { suspended: ["Suspended", "pr"], meetings: ["Meetings", "pr"], inactive: ["Inactive", "pa"], offer: ["Offer", "pa"], pause: ["Pause", "pg"] };

export default function StaffStudents() {
  const [cohort, setCohort] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const list = useApi<List>(`/advisor/students?${new URLSearchParams({ ...(cohort && { cohort_id: cohort }), ...(status && { status }), ...(q && { q }) })}`);
  const att = useApi<Att[]>("/advisor/attention");
  const nav = useNavigate();
  const s = list.data?.summary;

  return (
    <>
      <header className="top"><div><h1>My students</h1><div className="sub">Sorted by who needs you first</div></div></header>
      <div className="content">
        {s && <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div className="kpi"><span className="eyebrow">Students</span><span className="num" style={{ fontSize: 32 }}>{s.students}</span><span className="cap">{s.hired} hired</span></div>
          <div className="kpi" style={{ background: "var(--blue-tint)", borderColor: "var(--blue-line)" }}><span className="eyebrow" style={{ color: "#0F3F85" }}>Secured</span><span className="num" style={{ fontSize: 32, color: "var(--blue-deep)" }}>{s.secured}</span><span className="cap" style={{ color: "#0F3F85" }}>80+ points</span></div>
          <div className="kpi" style={{ background: "var(--amber-soft)", borderColor: "#F5E1A8" }}><span className="eyebrow" style={{ color: "#5C3B00" }}>At risk</span><span className="num" style={{ fontSize: 32, color: "var(--amber-ink)" }}>{s.at_risk}</span><span className="cap" style={{ color: "#5C3B00" }}>60–79 points</span></div>
          <div className="kpi" style={{ background: "var(--red-soft)", borderColor: "#F6CACC" }}><span className="eyebrow" style={{ color: "#7F1D1D" }}>Suspended</span><span className="num" style={{ fontSize: 32, color: "var(--red-ink)" }}>{s.suspended}</span><span className="cap" style={{ color: "#7F1D1D" }}>below 60</span></div>
          <div className="kpi"><span className="eyebrow">On pause</span><span className="num" style={{ fontSize: 32 }}>{s.paused}</span><span className="cap">deductions frozen</span></div>
        </div>}

        {att.data && att.data.length > 0 && (
          <section className="card" style={{ display: "flex", flexDirection: "column" }}>
            <div className="between" style={{ marginBottom: 4 }}><h2 className="h2">Needs your attention</h2><span className="cap">{att.data.length} items</span></div>
            {att.data.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 0", borderBottom: "1px solid var(--line-soft)", flexWrap: "wrap" }}>
                <span className={`pill ${ATT[a.kind][1]}`}>{ATT[a.kind][0]}</span>
                <div style={{ flex: "1 1 300px" }}>{a.text}</div>
                <Link className="btn bg sm" to={a.kind === "pause" ? "/admin" : `/staff/students/${a.student_id}`}>{a.kind === "pause" ? "Review request" : "Open student"}</Link>
              </div>))}
          </section>)}

        <section className="card stack" style={{ gap: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <h2 className="h2" style={{ marginRight: "auto" }}>All students</h2>
            <label><span className="sr">Cohort</span><select className="in" value={cohort} onChange={(e) => setCohort(e.target.value)}>
              <option value="">All cohorts</option>{list.data?.cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label><span className="sr">Status</span><select className="in" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option><option value="secured">Secured</option><option value="at_risk">At risk</option><option value="suspended">Suspended</option><option value="paused">On pause</option><option value="hired">Hired</option></select></label>
            <label><span className="sr">Search</span><input className="in" type="search" placeholder="Search name" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          </div>
          {list.loading ? <Spinner /> : <ErrorBox error={list.error} />}
          {list.data && (list.data.items.length === 0 ? <div className="empty">No students yet. Admins add them under People &amp; cohorts.</div> :
            <div className="tw"><table>
              <thead><tr><th>Student</th><th>Points</th><th>Status</th><th>Apps this week</th><th>Missed mtgs</th><th>Homework</th><th>Last active</th><th>Next session</th></tr></thead>
              <tbody>{list.data.items.map((r) => (
                <tr key={r.id} className="click" onClick={() => nav(`/staff/students/${r.id}`)}>
                  <td><Link to={`/staff/students/${r.id}`} style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--ink)", fontWeight: 700 }} onClick={(e) => e.stopPropagation()}>
                    <span className="av soft" style={{ width: 36, height: 36, fontSize: 13 }}>{r.initials}</span>
                    <span>{r.name}<span className="cap" style={{ display: "block", fontWeight: 500 }}>{r.cohort}</span></span></Link></td>
                  <td style={{ whiteSpace: "nowrap" }}><span className="num">{r.points}</span>
                    <span style={{ width: 72, height: 6, borderRadius: 3, background: "var(--line)", display: "inline-block", verticalAlign: "middle", marginLeft: 10, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${r.points}%`, background: statusColor(r.guarantee_status) }} /></span></td>
                  <td>{r.status === "hired" ? <span className="pill pn">Hired</span> : <StatusPill status={r.guarantee_status} paused={r.paused} />}</td>
                  <td className="num" style={{ color: r.apps_this_week < list.data!.target ? "var(--amber-ink)" : undefined }}>{r.apps_this_week} / {list.data!.target}</td>
                  <td>{r.missed_meetings} / {list.data!.max_missed}</td>
                  <td>{r.homework_streak ? `${r.homework_streak} miss${r.homework_streak > 1 ? "es" : ""} in a row` : "—"}</td>
                  <td className="cap" style={{ whiteSpace: "nowrap" }}>{r.idle_days == null ? "—" : r.idle_days === 0 ? "Today" : `${r.idle_days} day${r.idle_days === 1 ? "" : "s"} ago`}</td>
                  <td className="cap" style={{ whiteSpace: "nowrap" }}>{r.next_session ? fmtDate(r.next_session) : "Not booked"}</td>
                </tr>))}</tbody></table></div>)}
        </section>
      </div>
    </>);
}
