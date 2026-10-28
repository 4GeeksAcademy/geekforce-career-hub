import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import type { StudentBrief } from "../lib/types";
import { appStatus, fmtDate, planLabel, relTime, stageLabel, todayISO } from "../lib/format";
import { ErrorBox, Modal, Spinner, useToast } from "../components/ui";
import { IPlus } from "../components/Icons";
import { t } from "../lib/i18n";

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
  const [creds, setCreds] = useState<{ email: string; link: string | null } | null>(null);
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
        <div><div className="kick">{t("Students · from Notion")}</div><h1>{t("Onboarding.")} <em>{t("Set them up.")}</em></h1><div className="sub">{t("Students synced from Notion wait here until you set their starting balance and send their login.")}</div></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn bg" onClick={() => setAdding(true)}><IPlus size={18} />{t("Add student manually")}</button>
          <button className="btn bp" disabled={syncing || !status.data?.connected} onClick={sync}>{syncing ? t("Syncing…") : t("Sync from Notion")}</button>
        </div>
      </header>
      <div className="content">
        <section className="card between" style={{ alignItems: "center" }}>
          <div><div style={{ fontWeight: 800 }}>{t("Notion · Miami Student Tracker")}</div>
            <div className="cap">{!status.data ? "…" : !status.data.connected ? t("Not connected yet. An admin adds NOTION_TOKEN in Railway.")
              : status.data.last_run ? t("Last sync {v0} · runs every night at 12:30 AM", { v0: relTime(status.data.last_run.at) }) : t("Connected · never synced")}</div></div>
          <span className={`pill ${status.data?.connected ? "pb" : "pg"}`}>{status.data?.connected ? t("Connected") : t("Not connected")}</span>
        </section>
        {result && (result.ok
          ? <div className="ok">{t("Sync done: {created} new, {updated} updated, {apps} applications imported", { created: result.created, updated: result.updated, apps: result.applications_imported })}{result.skipped ? t(", {skipped} skipped (no email or no career support)", { skipped: result.skipped }) : ""}.
              {result.errors && result.errors.length > 0 && <div style={{ marginTop: 6 }}>{t("Problems:")} {result.errors.join(" · ")}</div>}</div>
          : <div className="err">{result.error}</div>)}

        {list.loading ? <Spinner /> : <ErrorBox error={list.error} />}
        {list.data?.length === 0 && <div className="card empty">{t("Nobody waiting. New active GeekForce students in Notion show up here after the next sync.")}</div>}
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
          {list.data?.map((s) => (
            <section key={s.id} className="card stack">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div className="av soft">{s.initials}</div>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800 }}>{s.name}</div><div className="cap">{s.email}</div></div>
                {s.from_notion && <span className="pill pg">{t("Notion")}</span>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="pill pb">{planLabel(s.enrollment_plan)}</span>
                {s.stage && <span className="pill pg">{stageLabel[s.stage]}</span>}
                {s.cohort && <span className="pill pg">{s.cohort}</span>}
                {!s.advisor && <span className="pill pa">{t("No advisor")}</span>}
              </div>
              <div className="cap">{t("{n} applications imported · {m} in the last 30 days", { n: s.applications_total, m: s.applications_last_30_days })}</div>
              {s.recent_applications.length > 0 && <div style={{ fontSize: 13 }}>{s.recent_applications.map((a, i) =>
                <div key={i} className="between" style={{ padding: "4px 0", borderBottom: "1px solid var(--line-soft)" }}>
                  <span>{a.company} · {a.role}</span><span className="cap">{appStatus[a.status]?.[0]} · {fmtDate(a.applied_at)}</span></div>)}</div>}
              <button className="btn bp" onClick={() => setActivating(s)}>{t("Review & activate · suggested")} {s.suggested}</button>
            </section>))}
        </div>
      </div>
      {activating && <Activate s={activating} onClose={() => setActivating(null)} onDone={(c) => { setActivating(null); setCreds(c); toast(t("Student activated")); list.reload(); }} />}
      {adding && <AddStudent onClose={() => setAdding(false)} onDone={(c) => { setAdding(false); setCreds(c); toast(t("Student added")); }} />}
      {creds && <Modal title={t("Invitation sent")} onClose={() => setCreds(null)}>
        <div className="ok">{creds.email} {t("gets an email with a link to choose their password. The link works once, for 7 days.")}</div>
        {creds.link && <div><div className="lb">{t("Share it directly if the email doesn't arrive")}</div>
          <div style={{ display: "flex", gap: 8 }}><input className="in" readOnly value={creds.link} onFocus={(e) => e.target.select()} />
            <button className="btn bg" onClick={() => { navigator.clipboard?.writeText(creds.link!); toast(t("Link copied")); }}>{t("Copy")}</button></div></div>}
        <button className="btn bp" onClick={() => setCreds(null)}>{t("Done")}</button></Modal>}
    </>);
}

function Activate({ s, onClose, onDone }: { s: Onb; onClose: () => void; onDone: (c: { email: string; link: string | null }) => void }) {
  const [pts, setPts] = useState(String(s.suggested));
  const [note, setNote] = useState("");
  const [invite, setInvite] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { const r = await api.post<{ invite_link: string | null }>(`/advisor/students/${s.id}/activate`, { starting_points: Number(pts), note: note || null, send_invite: invite });
      onDone({ email: s.email, link: r.invite_link }); }
    catch (e) { setErr(e); }
  };
  const n = Number(pts);
  return <Modal title={t("Activate {name}", { name: s.name })} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div className="ok">{t("Suggested:")} <strong>{s.suggested}</strong> ({s.formula}).</div>
      <div><label className="lb" htmlFor="sp">{t("Starting balance")}</label><input className="in" id="sp" type="number" min={0} max={100} required value={pts} onChange={(e) => setPts(e.target.value)} /></div>
      {s.enrollment_plan === "job_guarantee" && n < 60 && <div className="err">{t("Below 60 the guarantee starts suspended, and suspension is permanent.")}</div>}
      {s.enrollment_plan === "job_guarantee" && n >= 60 && n < 80 && <div className="cap">{t("They'll start at risk (60–79).")}</div>}
      <div><label className="lb" htmlFor="sn">{t("Why this balance? (saved in the audit log)")}</label><textarea className="in" id="sn" style={{ minHeight: 70 }} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} style={{ width: 18, height: 18 }} />{t("Email their invitation link now")}</label>
      <ErrorBox error={err} />
      <button className="btn bp">{t("Activate")}</button>
    </form></Modal>;
}

function AddStudent({ onClose, onDone }: { onClose: () => void; onDone: (c: { email: string; link: string | null }) => void }) {
  const cohorts = useApi<{ id: string; name: string }[]>("/admin/cohorts");
  const [f, setF] = useState({ name: "", email: "", cohort_id: "", enrollment_plan: "job_guarantee", job_search_start_date: todayISO(), starting_points: "80" });
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { const r = await api.post<{ invite_link: string | null }>("/advisor/students", { ...f, cohort_id: f.cohort_id || null, starting_points: Number(f.starting_points) });
      onDone({ email: f.email, link: r.invite_link }); }
    catch (e) { setErr(e); }
  };
  return <Modal title={t("Add student manually")} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <p className="cap">{t("For students who aren't in Notion yet. If they show up in Notion later, the sync links to this account by email.")}</p>
      <div><label className="lb" htmlFor="nn">{t("Full name")}</label><input className="in" id="nn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><label className="lb" htmlFor="ne">{t("Email")}</label><input className="in" id="ne" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div><label className="lb" htmlFor="nc">{t("Cohort")}</label><select className="in" id="nc" value={f.cohort_id} onChange={(e) => setF({ ...f, cohort_id: e.target.value })}>
        <option value="">{t("None")}</option>{cohorts.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div><label className="lb" htmlFor="np">{t("Plan")}</label><select className="in" id="np" value={f.enrollment_plan} onChange={(e) => setF({ ...f, enrollment_plan: e.target.value })}>
        <option value="job_guarantee">{t("Job Guarantee (15 applications/week)")}</option><option value="professional_support">{t("Professional Support (10/week, no guarantee)")}</option></select></div>
      <div className="grid" style={{ gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <div><label className="lb" htmlFor="nd">{t("Job search start")}</label><input className="in" id="nd" type="date" value={f.job_search_start_date} onChange={(e) => setF({ ...f, job_search_start_date: e.target.value })} /></div>
        <div><label className="lb" htmlFor="ns">{t("Starting balance")}</label><input className="in" id="ns" type="number" min={0} max={100} value={f.starting_points} onChange={(e) => setF({ ...f, starting_points: e.target.value })} /></div>
      </div>
      <ErrorBox error={err} />
      <button className="btn bp">{t("Add and send login")}</button>
    </form></Modal>;
}
