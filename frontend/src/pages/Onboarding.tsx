import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import type { StudentBrief } from "../lib/types";
import { appStatus, fmtDate, planLabel, relTime, stageLabel, todayISO } from "../lib/format";
import { ErrorBox, Modal, Spinner, useToast } from "../components/ui";
import { IPlus } from "../components/Icons";

type Onb = StudentBrief & { suggested: number; applications_last_30_days: number; applications_total: number; formula: string;
  recent_applications: { company: string; role: string; status: string; applied_at: string }[] };
type NotionStatus = { connected: boolean; last_run: { at: string; ok: boolean; summary: Record<string, unknown> } | null };
type SyncResult = { ok: boolean; error?: string; created?: number; updated?: number; applications_imported?: number; skipped?: number; errors?: string[] };

export default function Onboarding() {
  const list = useApi<Onb[]>("/advisor/onboarding");
  const status = useApi<NotionStatus>("/advisor/notion/status");
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [activating, setActivating] = useState<Onb | null>(null);
  const [adding, setAdding] = useState(false);
  const [creds, setCreds] = useState<{ email: string; password: string | null } | null>(null);
  const toast = useToast();

  const sync = async () => {
    setSyncing(true); setResult(null);
    try { setResult(await api.post<SyncResult>("/advisor/notion/sync")); list.reload(); status.reload(); }
    catch (e) { setResult({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
    finally { setSyncing(false); }
  };

  return (
    <>
      <header className="top">
        <div><h1>Onboarding</h1><div className="sub">Students synced from Notion wait here until you set their starting balance and send their login.</div></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn bg" onClick={() => setAdding(true)}><IPlus size={18} />Add student manually</button>
          <button className="btn bp" disabled={syncing || !status.data?.connected} onClick={sync}>{syncing ? "Syncing…" : "Sync from Notion"}</button>
        </div>
      </header>
      <div className="content">
        <section className="card between" style={{ alignItems: "center" }}>
          <div><div style={{ fontWeight: 800 }}>Notion · Miami Student Tracker</div>
            <div className="cap">{!status.data ? "…" : !status.data.connected ? "Not connected yet. An admin adds NOTION_TOKEN in Railway."
              : status.data.last_run ? `Last sync ${relTime(status.data.last_run.at)} · runs every night at 12:30 AM` : "Connected · never synced"}</div></div>
          <span className={`pill ${status.data?.connected ? "pb" : "pg"}`}>{status.data?.connected ? "Connected" : "Not connected"}</span>
        </section>
        {result && (result.ok
          ? <div className="ok">Sync done: {result.created} new, {result.updated} updated, {result.applications_imported} applications imported{result.skipped ? `, ${result.skipped} skipped (no email or no career support)` : ""}.
              {result.errors && result.errors.length > 0 && <div style={{ marginTop: 6 }}>Problems: {result.errors.join(" · ")}</div>}</div>
          : <div className="err">{result.error}</div>)}

        {list.loading ? <Spinner /> : <ErrorBox error={list.error} />}
        {list.data?.length === 0 && <div className="card empty">Nobody waiting. New active GeekForce students in Notion show up here after the next sync.</div>}
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
          {list.data?.map((s) => (
            <section key={s.id} className="card stack">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div className="av soft">{s.initials}</div>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800 }}>{s.name}</div><div className="cap">{s.email}</div></div>
                {s.from_notion && <span className="pill pg">Notion</span>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="pill pb">{planLabel(s.enrollment_plan)}</span>
                {s.stage && <span className="pill pg">{stageLabel[s.stage]}</span>}
                {s.cohort && <span className="pill pg">{s.cohort}</span>}
                {!s.advisor && <span className="pill pa">No advisor</span>}
              </div>
              <div className="cap">{s.applications_total} applications imported · {s.applications_last_30_days} in the last 30 days</div>
              {s.recent_applications.length > 0 && <div style={{ fontSize: 13 }}>{s.recent_applications.map((a, i) =>
                <div key={i} className="between" style={{ padding: "4px 0", borderBottom: "1px solid var(--line-soft)" }}>
                  <span>{a.company} · {a.role}</span><span className="cap">{appStatus[a.status]?.[0]} · {fmtDate(a.applied_at)}</span></div>)}</div>}
              <button className="btn bp" onClick={() => setActivating(s)}>Review &amp; activate · suggested {s.suggested}</button>
            </section>))}
        </div>
      </div>
      {activating && <Activate s={activating} onClose={() => setActivating(null)} onDone={(c) => { setActivating(null); setCreds(c); toast("Student activated"); list.reload(); }} />}
      {adding && <AddStudent onClose={() => setAdding(false)} onDone={(c) => { setAdding(false); setCreds(c); toast("Student added"); }} />}
      {creds && <Modal title="Sign-in details" onClose={() => setCreds(null)}>
        <div className="ok">These were also emailed to the student. Share them privately if the email doesn't arrive.</div>
        <div><div className="lb">Email</div><code>{creds.email}</code></div>
        {creds.password ? <div><div className="lb">Temporary password</div><code style={{ fontSize: 16 }}>{creds.password}</code></div>
          : <div className="cap">They already had a password, so it wasn't changed.</div>}
        <button className="btn bp" onClick={() => setCreds(null)}>Done</button></Modal>}
    </>);
}

function Activate({ s, onClose, onDone }: { s: Onb; onClose: () => void; onDone: (c: { email: string; password: string | null }) => void }) {
  const [pts, setPts] = useState(String(s.suggested));
  const [note, setNote] = useState("");
  const [invite, setInvite] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { const r = await api.post<{ temporary_password: string | null }>(`/advisor/students/${s.id}/activate`, { starting_points: Number(pts), note: note || null, send_invite: invite });
      onDone({ email: s.email, password: r.temporary_password }); }
    catch (e) { setErr(e); }
  };
  const n = Number(pts);
  return <Modal title={`Activate ${s.name}`} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div className="ok">Suggested: <strong>{s.suggested}</strong> ({s.formula}).</div>
      <div><label className="lb" htmlFor="sp">Starting balance</label><input className="in" id="sp" type="number" min={0} max={100} required value={pts} onChange={(e) => setPts(e.target.value)} /></div>
      {s.enrollment_plan === "job_guarantee" && n < 60 && <div className="err">Below 60 the guarantee starts suspended, and suspension is permanent.</div>}
      {s.enrollment_plan === "job_guarantee" && n >= 60 && n < 80 && <div className="cap">They'll start at risk (60–79).</div>}
      <div><label className="lb" htmlFor="sn">Why this balance? (saved in the audit log)</label><textarea className="in" id="sn" style={{ minHeight: 70 }} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} style={{ width: 18, height: 18 }} />Email their sign-in details now</label>
      <ErrorBox error={err} />
      <button className="btn bp">Activate</button>
    </form></Modal>;
}

function AddStudent({ onClose, onDone }: { onClose: () => void; onDone: (c: { email: string; password: string | null }) => void }) {
  const cohorts = useApi<{ id: string; name: string }[]>("/admin/cohorts");
  const [f, setF] = useState({ name: "", email: "", cohort_id: "", enrollment_plan: "job_guarantee", job_search_start_date: todayISO(), starting_points: "80" });
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { const r = await api.post<{ temporary_password: string | null }>("/advisor/students", { ...f, cohort_id: f.cohort_id || null, starting_points: Number(f.starting_points) });
      onDone({ email: f.email, password: r.temporary_password }); }
    catch (e) { setErr(e); }
  };
  return <Modal title="Add student manually" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <p className="cap">For students who aren't in Notion yet. If they show up in Notion later, the sync links to this account by email.</p>
      <div><label className="lb" htmlFor="nn">Full name</label><input className="in" id="nn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><label className="lb" htmlFor="ne">Email</label><input className="in" id="ne" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div><label className="lb" htmlFor="nc">Cohort</label><select className="in" id="nc" value={f.cohort_id} onChange={(e) => setF({ ...f, cohort_id: e.target.value })}>
        <option value="">None</option>{cohorts.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div><label className="lb" htmlFor="np">Plan</label><select className="in" id="np" value={f.enrollment_plan} onChange={(e) => setF({ ...f, enrollment_plan: e.target.value })}>
        <option value="job_guarantee">Job Guarantee (15 applications/week)</option><option value="professional_support">Professional Support (10/week, no guarantee)</option></select></div>
      <div className="grid" style={{ gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <div><label className="lb" htmlFor="nd">Job search start</label><input className="in" id="nd" type="date" value={f.job_search_start_date} onChange={(e) => setF({ ...f, job_search_start_date: e.target.value })} /></div>
        <div><label className="lb" htmlFor="ns">Starting balance</label><input className="in" id="ns" type="number" min={0} max={100} value={f.starting_points} onChange={(e) => setF({ ...f, starting_points: e.target.value })} /></div>
      </div>
      <ErrorBox error={err} />
      <button className="btn bp">Add and send login</button>
    </form></Modal>;
}
