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
  archived_at: string | null;
  student: { cohort: string | null; cohort_id: string | null; advisor: string | null; advisor_id: string | null; points: number } | null };
type Cohort = { id: string; name: string; program: string | null; location: string | null; region: string; deadline_days: number | null };
type History = Record<string, number>;

const ROLE_LABEL: Record<string, string> = { student: "Student", advisor: "Advisor", admin: "Admin" };

export function AdminPeople() {
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const users = useApi<UserRow[]>(`/admin/users${showArchived ? "?archived=true" : ""}`);
  const active = useApi<UserRow[]>("/admin/users");
  const cohorts = useApi<Cohort[]>("/admin/cohorts");
  const [adding, setAdding] = useState(false);
  const [addingCohort, setAddingCohort] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [removing, setRemoving] = useState<UserRow | null>(null);
  const toast = useToast();
  const { user: me } = useAuth();
  const advisors = active.data?.filter((u) => u.role !== "student" && u.is_active) || [];
  const reload = () => { users.reload(); active.reload(); };
  const ql = q.trim().toLowerCase();
  const rows = (users.data || []).filter((u) => (!role || u.role === role) &&
    (!ql || u.name.toLowerCase().includes(ql) || u.email.toLowerCase().includes(ql) || (u.student?.cohort || "").toLowerCase().includes(ql)));
  const restore = async (u: UserRow) => {
    try { await api.post(`/admin/users/${u.id}/restore`); toast(t("{name} restored", { name: u.name })); reload(); }
    catch (e) { toast((e as Error).message); }
  };
  return (
    <>
      <header className="top"><div><div className="kick">{t("Admin")}</div><h1>{t("People &")} <em>{t("cohorts.")}</em></h1><div className="sub">{t("Create, edit and remove student, advisor and admin accounts.")}</div></div>
        <div style={{ display: "flex", gap: 10 }}><button className="btn bg" onClick={() => setAddingCohort(true)}>{t("New cohort")}</button><button className="btn bp" onClick={() => setAdding(true)}><IPlus size={18} />{t("Add person")}</button></div></header>
      <div className="content">
        <section className="card stack">
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h2 className="h2" style={{ marginRight: "auto" }}>{showArchived ? t("Removed people") : t("People")}</h2>
            <input className="in" style={{ width: 220 }} placeholder={t("Search name, email or cohort")} aria-label={t("Search")} value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="in" style={{ width: 150 }} aria-label={t("Role")} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">{t("All roles")}</option>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select>
            <label className="cap" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />{t("Show removed")}</label>
          </div>
          {users.loading ? <Spinner /> : rows.length === 0 ? <div className="cap">{showArchived ? t("Nobody has been removed.") : t("No one matches.")}</div> : <div className="tw"><table>
            <thead><tr><th>{t("Name")}</th><th>{t("Role")}</th><th>{t("Cohort")}</th><th>{t("Advisor")}</th><th>{t("Points")}</th><th>{showArchived ? t("Removed") : t("Last sign-in")}</th><th></th></tr></thead>
            <tbody>{rows.map((u) => (
              <tr key={u.id} style={!u.is_active && !showArchived ? { opacity: .6 } : undefined}><td><strong>{u.name}</strong>{u.id === me?.id && <span className="cap"> · {t("you")}</span>}<div className="cap">{u.email}</div></td>
                <td>{t(ROLE_LABEL[u.role] || u.role)}{!u.is_active && !showArchived && <div className="cap">{t("Deactivated")}</div>}</td><td className="cap">{u.student?.cohort || "—"}</td><td className="cap">{u.student?.advisor || "—"}</td>
                <td className="num">{u.student?.points ?? "—"}</td>
                <td className="cap">{showArchived ? (u.archived_at ? fmtDate(u.archived_at) : "—") : u.last_login_at ? relTime(u.last_login_at) : t("Never")}</td>
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>{showArchived
                  ? <button className="btn bg sm" onClick={() => restore(u)}>{t("Restore")}</button>
                  : <><button className="btn bg sm" onClick={() => setEditing(u)}>{t("Edit")}</button>{" "}
                    {u.id !== me?.id && <button className="btn bd sm" onClick={() => setRemoving(u)}>{t("Remove")}</button>}</>}</td></tr>))}</tbody></table></div>}
        </section>
        <section className="card stack">
          <h2 className="h2">{t("Cohorts")}</h2>
          <div className="tw"><table><thead><tr><th>{t("Name")}</th><th>{t("Program")}</th><th>{t("Region")}</th><th>{t("Job search deadline")}</th></tr></thead>
            <tbody>{cohorts.data?.map((c) => <tr key={c.id}><td><strong>{c.name}</strong></td><td>{c.program}</td><td style={{ textTransform: "uppercase" }}>{c.region}</td><td>{c.deadline_days ? t("{deadline_days} days", { deadline_days: c.deadline_days }) : t("Default")}</td></tr>)}</tbody></table></div>
        </section>
      </div>
      {adding && <AddPerson cohorts={cohorts.data || []} advisors={advisors} onClose={() => setAdding(false)} onDone={(m) => { toast(m); reload(); }} />}
      {addingCohort && <AddCohort onClose={() => setAddingCohort(false)} onDone={() => { setAddingCohort(false); toast(t("Cohort created")); cohorts.reload(); }} />}
      {editing && <EditPerson u={editing} me={me?.id} cohorts={cohorts.data || []} advisors={advisors} onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); toast(m); reload(); }} />}
      {removing && <RemovePerson u={removing} advisors={advisors} onClose={() => setRemoving(null)} onDone={(m) => { setRemoving(null); toast(m); reload(); }} />}
    </>);
}

function EditPerson({ u, me, cohorts, advisors, onClose, onDone }: { u: UserRow; me?: string; cohorts: Cohort[]; advisors: UserRow[]; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ name: u.name, email: u.email, role: u.role, is_active: u.is_active,
    cohort_id: u.student?.cohort_id || "", advisor_id: u.student?.advisor_id || "", password: "" });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const staff = u.role !== "student";
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body: Record<string, unknown> = { name: f.name, email: f.email, is_active: f.is_active };
      if (staff) body.role = f.role;
      else { body.cohort_id = f.cohort_id || null; body.advisor_id = f.advisor_id || null; }
      if (f.password) body.password = f.password;
      await api.patch(`/admin/users/${u.id}`, body);
      onDone(t("{name} updated", { name: f.name }));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return <Modal title={t("Edit {name}", { name: u.name })} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div><label className="lb" htmlFor="en">{t("Full name")}</label><input className="in" id="en" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><label className="lb" htmlFor="ee">{t("Email")}</label><input className="in" id="ee" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      {staff ? <div><label className="lb" htmlFor="er">{t("Role")}</label>
        <select className="in" id="er" value={f.role} disabled={u.id === me} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <option value="advisor">{t("Advisor")}</option><option value="admin">{t("Admin")}</option></select>
        <div className="cap" style={{ marginTop: 4 }}>{u.id === me ? t("You can't change your own role.") : t("Admins see every student and manage rules, people and automations. Advisors see their own students.")}</div></div>
        : <>
          <div className="cap">{t("Role: Student. Students and staff keep different records, so to make a student staff (or the reverse) remove this account and add a new one.")}</div>
          <div><label className="lb" htmlFor="ec">{t("Cohort")}</label><select className="in" id="ec" value={f.cohort_id} onChange={(e) => setF({ ...f, cohort_id: e.target.value })}>
            <option value="">{t("No cohort")}</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="lb" htmlFor="ea">{t("Advisor")}</label><select className="in" id="ea" value={f.advisor_id} onChange={(e) => setF({ ...f, advisor_id: e.target.value })}>
            <option value="">{t("No advisor")}</option>{advisors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        </>}
      <div><label className="lb" htmlFor="ep">{t("New password (optional)")}</label><input className="in" id="ep" type="text" autoComplete="off" value={f.password} placeholder={t("Leave empty to keep the current one")} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
      {u.id !== me && <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />{t("Can sign in")}</label>}
      <ErrorBox error={err} />
      <button className="btn bp" disabled={busy}>{t("Save changes")}</button>
    </form></Modal>;
}

const HISTORY_LABEL: Record<string, string> = { students_advised: "students advised", sessions_led: "sessions led", notes_written: "notes written",
  audit_entries: "actions in the audit log", points_events: "point events", applications: "applications", sessions: "sessions" };

function RemovePerson({ u, advisors, onClose, onDone }: { u: UserRow; advisors: UserRow[]; onClose: () => void; onDone: (m: string) => void }) {
  const detail = useApi<UserRow & { history: History }>(`/admin/users/${u.id}`);
  const [mode, setMode] = useState<"archive" | "delete">("archive");
  const [reassign, setReassign] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const h = detail.data?.history || {};
  const advised = h.students_advised || 0;
  const hasHistory = Object.entries(h).some(([k, v]) => k !== "students_advised" && v > 0);
  const others = advisors.filter((a) => a.id !== u.id);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const r = await api.post<{ deleted?: boolean }>(`/admin/users/${u.id}/remove`, { permanent: mode === "delete", reassign_to: reassign || null, reason: reason || null });
      onDone(r.deleted ? t("{name} deleted", { name: u.name }) : t("{name} removed. You can restore them from “Show removed”.", { name: u.name }));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  if (detail.loading) return <Modal title={t("Remove {name}", { name: u.name })} onClose={onClose}><Spinner /></Modal>;
  const facts = Object.entries(h).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${t(HISTORY_LABEL[k] || k)}`);
  return <Modal title={t("Remove {name}", { name: u.name })} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div className="cap">{facts.length ? t("Linked to this account: {facts}.", { facts: facts.join(", ") }) : t("This account has no history yet.")}</div>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><input type="radio" name="rm" checked={mode === "archive"} onChange={() => setMode("archive")} />
        <span><strong>{t("Remove from the lists (recommended)")}</strong><div className="cap">{t("They can't sign in and disappear from lists and dashboards filters. Their history stays, and you can restore them any time.")}</div></span></label>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", opacity: hasHistory ? .5 : 1 }}><input type="radio" name="rm" disabled={hasHistory} checked={mode === "delete"} onChange={() => setMode("delete")} />
        <span><strong>{t("Delete for good")}</strong><div className="cap">{hasHistory ? t("Not available: this person has history. Remove them from the lists instead.") : t("For accounts created by mistake. This can't be undone.")}</div></span></label>
      {advised > 0 && <div><label className="lb" htmlFor="rr">{t("Who takes over their {n} student(s)?", { n: advised })}</label>
        <select className="in" id="rr" required value={reassign} onChange={(e) => setReassign(e.target.value)}>
          <option value="">{t("Choose…")}</option>{others.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}
      <div><label className="lb" htmlFor="rn">{t("Reason (optional, saved in the audit log)")}</label><input className="in" id="rn" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      {mode === "delete" && <div><label className="lb" htmlFor="rc">{t("Type DELETE to confirm")}</label><input className="in" id="rc" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>}
      <ErrorBox error={err} />
      <button className="btn bd" disabled={busy || (mode === "delete" && confirm.trim().toUpperCase() !== "DELETE")}>
        {mode === "delete" ? t("Delete {name}", { name: u.name }) : t("Remove {name}", { name: u.name })}</button>
    </form></Modal>;
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
