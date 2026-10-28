import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/useApi";
import type { Pause, Rule } from "../lib/types";
import { fmtDate, relTime } from "../lib/format";
import { ErrorBox, Modal, Spinner, useToast } from "../components/ui";
import { IPlus } from "../components/Icons";
import { t } from "../lib/i18n";

type Integration = { key: string; name: string; connected: boolean; detail: string };

export function AdminPauses() {
  const pauses = useApi<Pause[]>("/advisor/pauses?status=pending");
  const integ = useApi<Integration[]>("/admin/integrations");
  const { user } = useAuth();
  const toast = useToast();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const decide = async (p: Pause, approve: boolean) => {
    await api.post(`/advisor/pauses/${p.id}/${approve ? "approve" : "decline"}`, { note: notes[p.id] || null });
    toast(approve ? t("Pause approved for {student_name}", { student_name: p.student_name }) : t("Pause declined for {student_name}", { student_name: p.student_name })); pauses.reload();
  };
  const runJob = async (name: string) => { const r = await api.post(`/admin/jobs/${name}`); toast(t("Ran {name}: {v1}", { name: name, v1: JSON.stringify(r) })); };
  return (
    <>
      <header className="top"><div><div className="kick">{t("Manage")}</div><h1>{t("Pause")} <em>{t("requests.")}</em></h1><div className="sub">{t("One pause per student per program cycle. Every decision is logged.")}</div></div></header>
      <div className="content">
        <section className="card stack">
          {pauses.loading ? <Spinner /> : <ErrorBox error={pauses.error} />}
          {pauses.data?.length === 0 && <div className="empty">{t("No pending requests.")}</div>}
          {pauses.data?.map((p) => (
            <div key={p.id} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: "18px 20px", display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
              <div className="av soft">{p.student_initials}</div>
              <div style={{ flex: "2 1 280px" }}><div style={{ fontWeight: 800 }}>{p.student_name} · {p.days} {t("days ·")} {fmtDate(p.start_date)} → {fmtDate(p.end_date)}</div>
                <div className="cap" style={{ textTransform: "capitalize" }}>{p.reason_type}{p.reason ? ` · ${p.reason}` : ""} {t("· requested")} {relTime(p.created_at)}</div></div>
              <div style={{ flex: "1 1 220px", background: "var(--bg2)", borderRadius: 10, padding: "10px 14px", fontSize: 14 }}>
                <div className="cap">{t("Job search deadline")}</div><strong>{fmtDate(p.deadline_before, { month: "short", day: "numeric", year: "numeric" })} → {fmtDate(p.deadline_after, { month: "short", day: "numeric", year: "numeric" })}</strong> <span className="cap">(+{p.extension_days} {t("days)")}</span></div>
              <label style={{ flex: "1 1 200px" }}><span className="sr">{t("Note")}</span><input className="in" placeholder={t("Note to student (optional)")} value={notes[p.id] || ""} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} /></label>
              <div style={{ display: "flex", gap: 8 }}><button className="btn bp" onClick={() => decide(p, true)}>{t("Approve")}</button><button className="btn bd" onClick={() => decide(p, false)}>{t("Decline")}</button></div>
            </div>))}
        </section>
        <section className="card stack">
          <h2 className="h2">{t("Integrations")}</h2>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>{integ.data?.map((i) => (
            <div key={i.key} style={{ flex: "1 1 230px", border: "1px solid var(--line)", borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 8, background: i.connected ? "#fff" : "var(--bg2)" }}>
              <div className="between"><strong>{i.name}</strong><span className={`pill ${i.connected ? "pb" : "pg"}`}>{i.connected ? t("Connected") : i.key === "breathcode" ? t("Phase 2") : t("Not set up")}</span></div>
              <div className="cap">{i.detail}</div>
              {i.key === "activecampaign" && i.connected && user?.role === "admin" &&
                <button className="btn bg sm" style={{ alignSelf: "flex-start" }} onClick={async () => {
                  try { const r = await api.post<{ fields: string[]; tags: string[] }>("/admin/integrations/activecampaign/setup");
                    toast(t("Ready in ActiveCampaign: {length} fields, {length_} tags", { length: r.fields.length, length_: r.tags.length })); }
                  catch (e) { toast(e instanceof Error ? e.message : t("Setup failed")); } }}>{t("Create fields & tags")}</button>}
            </div>))}</div>
        </section>
        {user?.role === "admin" && <section className="card stack">
          <h2 className="h2">{t("Scheduled checks")}</h2>
          <p className="cap">{t("These run automatically (Mon 6:00 weekly check, Fri 17:00 nudge, daily 1:00 checks, 9:00 reminders). Run one now if needed; they never double-charge.")}</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{["daily", "reminders", "friday_nudge", "weekly_check", "notion_sync", "job_radar", "ac_sync"].map((j) =>
            <button key={j} className="btn bg sm" onClick={() => runJob(j)}>{t("Run")} {j.replace(/_/g, " ")}</button>)}</div>
        </section>}
      </div>
    </>);
}

export function AdminRules() {
  const rules = useApi<Rule[]>("/admin/rules");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  useEffect(() => { if (rules.data) setVals(Object.fromEntries(rules.data.map((r) => [r.key, String(r.value)]))); }, [rules.data]);
  if (rules.loading) return <Spinner />;
  const changed = rules.data?.filter((r) => String(r.value) !== vals[r.key]) || [];
  const save = async () => {
    setErr(null);
    try { await api.put("/admin/rules", { values: Object.fromEntries(changed.map((r) => [r.key, Number(vals[r.key])])) }); toast(t("{length} rule(s) updated", { length: changed.length })); rules.reload(); }
    catch (e) { setErr(e); }
  };
  const group = (g: string, title: string, n: number) => (
    <section className="card stack">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}><span className="ynum">{n}</span><h2 className="h2">{title}</h2></div>
      <div className="grid" style={{ gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))" }}>
        {rules.data?.filter((r) => r.group === g).map((r) => (
          <div key={r.key}><label className="lb" htmlFor={r.key}>{r.label}</label>
            <input className="in" id={r.key} type="number" step="any" value={vals[r.key] ?? ""} onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })}
              style={{ fontWeight: 800, color: g === "earn" ? "var(--blue-deep)" : g === "lose" ? "var(--red-ink)" : undefined }} />
            {String(r.default) !== vals[r.key] && <div className="cap">{t("Policy default:")} {r.default}</div>}</div>))}
      </div>
    </section>);
  return (
    <>
      <header className="top"><div><div className="kick">{t("Admin · Career Points Policy")}</div><h1>{t("Rules &")} <em>{t("points.")}</em></h1><div className="sub">{t("Defaults come from the Career Points Policy v1.0. Changes apply from now on and are logged.")}</div></div>
        <button className="btn bp" disabled={!changed.length} onClick={save}>{changed.length === 1 ? t("Save 1 change") : t("Save {n} changes", { n: changed.length || "" })}</button></header>
      <div className="content"><ErrorBox error={err} />{group("thresholds", t("Thresholds & limits"), 1)}{group("earn", t("Earn points"), 2)}{group("lose", t("Lose points (use negative numbers)"), 3)}</div>
    </>);
}

type UserRow = { id: string; email: string; name: string; role: string; is_active: boolean; last_login_at: string | null;
  student: { cohort: string | null; advisor: string | null; points: number } | null };
type Cohort = { id: string; name: string; program: string | null; location: string | null; region: string; deadline_days: number | null };

export function AdminPeople() {
  const users = useApi<UserRow[]>("/admin/users");
  const cohorts = useApi<Cohort[]>("/admin/cohorts");
  const [adding, setAdding] = useState(false);
  const [addingCohort, setAddingCohort] = useState(false);
  const toast = useToast();
  const advisors = users.data?.filter((u) => u.role !== "student") || [];
  return (
    <>
      <header className="top"><div><div className="kick">{t("Admin")}</div><h1>{t("People &")} <em>{t("cohorts.")}</em></h1><div className="sub">{t("Create student, advisor and admin accounts.")}</div></div>
        <div style={{ display: "flex", gap: 10 }}><button className="btn bg" onClick={() => setAddingCohort(true)}>{t("New cohort")}</button><button className="btn bp" onClick={() => setAdding(true)}><IPlus size={18} />{t("Add person")}</button></div></header>
      <div className="content">
        <section className="card stack">
          <h2 className="h2">{t("People")}</h2>
          {users.loading ? <Spinner /> : <div className="tw"><table>
            <thead><tr><th>{t("Name")}</th><th>{t("Role")}</th><th>{t("Cohort")}</th><th>{t("Advisor")}</th><th>{t("Points")}</th><th>{t("Last sign-in")}</th><th></th></tr></thead>
            <tbody>{users.data?.map((u) => (
              <tr key={u.id}><td><strong>{u.name}</strong><div className="cap">{u.email}</div></td>
                <td style={{ textTransform: "capitalize" }}>{u.role}</td><td className="cap">{u.student?.cohort || "—"}</td><td className="cap">{u.student?.advisor || "—"}</td>
                <td className="num">{u.student?.points ?? "—"}</td><td className="cap">{u.last_login_at ? relTime(u.last_login_at) : t("Never")}</td>
                <td><button className="btn bg sm" onClick={async () => { await api.patch(`/admin/users/${u.id}`, { is_active: !u.is_active }); users.reload(); }}>{u.is_active ? t("Deactivate") : t("Activate")}</button></td></tr>))}</tbody></table></div>}
        </section>
        <section className="card stack">
          <h2 className="h2">{t("Cohorts")}</h2>
          <div className="tw"><table><thead><tr><th>{t("Name")}</th><th>{t("Program")}</th><th>{t("Region")}</th><th>{t("Job search deadline")}</th></tr></thead>
            <tbody>{cohorts.data?.map((c) => <tr key={c.id}><td><strong>{c.name}</strong></td><td>{c.program}</td><td style={{ textTransform: "uppercase" }}>{c.region}</td><td>{c.deadline_days ? t("{deadline_days} days", { deadline_days: c.deadline_days }) : t("Default")}</td></tr>)}</tbody></table></div>
        </section>
      </div>
      {adding && <AddPerson cohorts={cohorts.data || []} advisors={advisors} onClose={() => setAdding(false)} onDone={(m) => { toast(m); users.reload(); }} />}
      {addingCohort && <AddCohort onClose={() => setAddingCohort(false)} onDone={() => { setAddingCohort(false); toast(t("Cohort created")); cohorts.reload(); }} />}
    </>);
}

function AddPerson({ cohorts, advisors, onClose, onDone }: { cohorts: Cohort[]; advisors: UserRow[]; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ name: "", email: "", role: "student", cohort_id: "", advisor_id: "", job_search_start_date: "", password: "" });
  const [err, setErr] = useState<unknown>(null);
  const [created, setCreated] = useState<{ email: string; temporary_password: string | null } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try {
      const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));
      const r = await api.post<{ email: string; temporary_password: string | null }>("/admin/users", body);
      setCreated(r); onDone(t("{name} added", { name: f.name }));
    } catch (e) { setErr(e); }
  };
  if (created) return <Modal title={t("Account created")} onClose={onClose}>
    <div className="ok">{t("Share these sign-in details with the person privately. They can change the password after signing in.")}</div>
    <div><div className="lb">{t("Email")}</div><code>{created.email}</code></div>
    {created.temporary_password && <div><div className="lb">{t("Temporary password")}</div><code style={{ fontSize: 16 }}>{created.temporary_password}</code></div>}
    <button className="btn bp" onClick={onClose}>{t("Done")}</button></Modal>;
  return <Modal title={t("Add person")} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div><label className="lb" htmlFor="an">{t("Full name")}</label><input className="in" id="an" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><label className="lb" htmlFor="ae">{t("Email")}</label><input className="in" id="ae" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div><label className="lb" htmlFor="ar">{t("Role")}</label><select className="in" id="ar" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
        <option value="student">{t("Student")}</option><option value="advisor">{t("Advisor")}</option><option value="admin">{t("Admin")}</option></select></div>
      {f.role === "student" && <>
        <div><label className="lb" htmlFor="ac">{t("Cohort")}</label><select className="in" id="ac" value={f.cohort_id} onChange={(e) => setF({ ...f, cohort_id: e.target.value })}>
          <option value="">{t("Choose…")}</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="lb" htmlFor="aa">{t("Advisor")}</label><select className="in" id="aa" value={f.advisor_id} onChange={(e) => setF({ ...f, advisor_id: e.target.value })}>
          <option value="">{t("Choose…")}</option>{advisors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div><label className="lb" htmlFor="as">{t("Job search start date")}</label><input className="in" id="as" type="date" value={f.job_search_start_date} onChange={(e) => setF({ ...f, job_search_start_date: e.target.value })} /></div>
      </>}
      <div><label className="lb" htmlFor="ap">{t("Password (leave empty to generate one)")}</label><input className="in" id="ap" type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
      <ErrorBox error={err} />
      <button className="btn bp">{t("Create account")}</button>
    </form></Modal>;
}

function AddCohort({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", program: "", location: "", region: "usa", deadline_days: "180" });
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { await api.post("/admin/cohorts", { ...f, deadline_days: f.deadline_days ? Number(f.deadline_days) : null }); onDone(); } catch (e) { setErr(e); }
  };
  return <Modal title={t("New cohort")} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div><label className="lb" htmlFor="cn">{t("Name")}</label><input className="in" id="cn" required placeholder={t("Full Stack #48 · Miami")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><label className="lb" htmlFor="cp">{t("Program")}</label><input className="in" id="cp" value={f.program} onChange={(e) => setF({ ...f, program: e.target.value })} /></div>
      <div><label className="lb" htmlFor="cl">{t("Location")}</label><input className="in" id="cl" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
      <div><label className="lb" htmlFor="cr">{t("Region")}</label><select className="in" id="cr" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}><option value="usa">{t("USA")}</option><option value="latam">{t("LATAM")}</option><option value="spain">{t("Spain")}</option></select></div>
      <div><label className="lb" htmlFor="cd">{t("Job search deadline (days)")}</label><input className="in" id="cd" type="number" value={f.deadline_days} onChange={(e) => setF({ ...f, deadline_days: e.target.value })} /></div>
      <ErrorBox error={err} />
      <button className="btn bp">{t("Create cohort")}</button>
    </form></Modal>;
}

export function AdminAudit() {
  const rows = useApi<{ id: string; created_at: string; actor: string; student: string | null; action: string; detail: string }[]>("/admin/audit");
  return (
    <>
      <header className="top"><div><div className="kick">{t("Admin")}</div><h1>{t("Audit")} <em>{t("log.")}</em></h1><div className="sub">{t("Manual point changes, pauses, offer reports and rule changes.")}</div></div></header>
      <div className="content"><section className="card">
        {rows.loading ? <Spinner /> : rows.data?.length === 0 ? <div className="empty">{t("Nothing logged yet.")}</div> :
          <div className="tw"><table><thead><tr><th>{t("When")}</th><th>{t("Who")}</th><th>{t("Student")}</th><th>{t("Action")}</th><th>{t("Detail")}</th></tr></thead>
            <tbody>{rows.data?.map((a) => <tr key={a.id}><td className="cap" style={{ whiteSpace: "nowrap" }}>{relTime(a.created_at)}</td><td>{a.actor}</td><td>{a.student || "—"}</td>
              <td style={{ textTransform: "capitalize" }}>{a.action.replace(/_/g, " ")}</td><td className="cap">{a.detail}</td></tr>)}</tbody></table></div>}
      </section></div>
    </>);
}
