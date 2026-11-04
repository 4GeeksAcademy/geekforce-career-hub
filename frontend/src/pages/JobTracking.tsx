import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ShareDetail, SharesTable, SHARE_STATUS, type ShareRec } from "../components/JobShares";
import { ErrorBox, Spinner } from "../components/ui";
import { t } from "../lib/i18n";
import { useApi } from "../lib/useApi";

export function RadarTabs({ on }: { on: "jobs" | "shared" }) {
  return <div className="tabs" role="tablist" style={{ marginBottom: 4 }}>
    <Link role="tab" aria-selected={on === "jobs"} className={`tab ${on === "jobs" ? "on" : ""}`} to="/staff/jobs">{t("Open jobs")}</Link>
    <Link role="tab" aria-selected={on === "shared"} className={`tab ${on === "shared" ? "on" : ""}`} to="/staff/jobs/shared">{t("Shared with students")}</Link>
  </div>;
}

type Data = { items: ShareRec[]; counts: Record<string, number>; total: number; unseen: number; in_process: number; offers: number };

export default function JobTracking() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [days, setDays] = useState("90");
  const qs = new URLSearchParams({ days, ...(status && { status }), ...(q && { q }), ...(params.get("job") && { job_id: params.get("job")! }) });
  const r = useApi<Data>(`/advisor/job-shares?${qs}`);
  const [open, setOpen] = useState<string | null>(null);
  const d = r.data;
  return (
    <>
      <header className="top"><div><div className="kick">{t("Opportunities")}</div><h1>{t("Tracking of")} <em>{t("shared jobs")}</em></h1>
        <div className="sub">{t("Every job shared with your students: who got it, what they answered, where each application is, and the full history.")}</div></div></header>
      <div className="content">
        <RadarTabs on="shared" />
        <div className="stats">
          <button className="stat" style={{ textAlign: "left", cursor: "pointer", outline: status === "" ? "3px solid var(--blue-deep)" : undefined }} onClick={() => setStatus("")}>
            <span className="l">{t("Shared")}</span><span className="v">{d?.total ?? "—"}</span><span className="c">{t("{n} not opened yet", { n: d?.unseen ?? 0 })}</span></button>
          {(["applied", "interested", "new", "not_a_fit"] as const).map((k) =>
            <button key={k} className={`stat ${k === "applied" ? "s-blue" : k === "not_a_fit" ? "s-red" : k === "interested" ? "s-cream" : ""}`}
              style={{ textAlign: "left", cursor: "pointer", outline: status === k ? "3px solid var(--blue-deep)" : undefined }} onClick={() => setStatus(status === k ? "" : k)}>
              <span className="l">{t(SHARE_STATUS[k][0])}</span><span className="v">{d?.counts[k] ?? 0}</span></button>)}
          <div className="stat s-amber"><span className="l">{t("In interviews")}</span><span className="v">{d?.in_process ?? 0}</span><span className="c">{t("{n} offer(s)", { n: d?.offers ?? 0 })}</span></div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ flex: "1 1 260px" }}><span className="sr">{t("Search")}</span>
            <input className="in" type="search" placeholder={t("Student, job title or company")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <label><span className="sr">{t("Period")}</span><select className="in" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">{t("Last 7 days")}</option><option value="30">{t("Last 30 days")}</option><option value="90">{t("Last 90 days")}</option><option value="365">{t("Last 12 months")}</option></select></label>
          {params.get("job") && <Link className="btn bg sm" to="/staff/jobs/shared">{t("Show all jobs")}</Link>}
        </div>
        <ErrorBox error={r.error} />
        {r.loading && !d ? <Spinner /> : <SharesTable items={d?.items || []} showStudent onOpen={setOpen} />}
      </div>
      {open && <ShareDetail shareId={open} staff onClose={() => setOpen(null)} onChanged={r.reload} />}
    </>);
}

/** On the student profile: every job shared with this student. */
export function StudentShares({ studentId, first }: { studentId: string; first: string }) {
  const r = useApi<ShareRec[]>(`/students/${studentId}/jobs`);
  const [open, setOpen] = useState<string | null>(null);
  const items = r.data || [];
  const applied = items.filter((s) => s.status === "applied").length;
  return <section className="card stack" style={{ gap: 12 }}>
    <div className="between"><h2 className="h2">{t("Jobs shared with {first}", { first })}</h2>
      <span className="cap">{t("{n} shared · {m} applied", { n: items.length, m: applied })}</span></div>
    {r.loading ? <Spinner /> : <SharesTable items={items} onOpen={setOpen} />}
    {open && <ShareDetail shareId={open} staff onClose={() => setOpen(null)} onChanged={r.reload} />}
  </section>;
}
