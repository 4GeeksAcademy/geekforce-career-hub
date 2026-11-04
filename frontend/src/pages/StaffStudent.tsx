import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import type { Activity, AppItem, Dashboard, Interaction, PointsEvent, SessionRec } from "../lib/types";
import { channelLabel, fmtDate, planLabel, relTime, sessionType, signed, stageLabel, statusLabel, statusNum, todayISO } from "../lib/format";
import { useAuth } from "../lib/auth";
import { ErrorBox, Modal, Spinner, StatusPill, useToast } from "../components/ui";
import { IBack } from "../components/Icons";
import { JourneyTracker } from "../components/Journey";
import { StudentShares } from "./JobTracking";
import { locale, t } from "../lib/i18n";

type Preview = { effects: { type: string; delta: number; title: string }[]; balance_before: number; balance_after: number;
  status_after: string; streak_after: number; missed_meetings_after: number; reschedules_after: number;
  effective_attendance: string; notes: string[]; emails: string[] };
type NotionSnap = { connected: boolean; synced_at: string | null; payments_behind: boolean | null; show_billing: boolean;
  notion_url: string | null; career: Record<string, unknown>; academic: Record<string, unknown>; billing: Record<string, unknown> };

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function StaffStudent() {
  const { id } = useParams();
  const dash = useApi<Dashboard>(`/students/${id}/dashboard`);
  const sessions = useApi<SessionRec[]>(`/students/${id}/sessions`);
  const points = useApi<{ events: PointsEvent[] }>(`/students/${id}/points?limit=8`);
  const apps = useApi<{ items: AppItem[] }>(`/students/${id}/applications?status=offer`);
  const toast = useToast();
  const reload = () => { dash.reload(); sessions.reload(); points.reload(); apps.reload(); };
  const [ntbp, setNtbp] = useState(false);

  if (dash.loading) return <Spinner />;
  const d = dash.data;
  if (!d) return <div className="content"><ErrorBox error={dash.error} /></div>;
  const st = d.student;
  const scheduled = sessions.data?.find((s) => s.attendance === "scheduled");

  const setStatus = async (status: string) => {
    await api.patch(`/advisor/students/${st.id}/status`, { status });
    toast(status === "hired" ? t("{name} marked as hired", { name: st.name }) : t("Status updated")); reload();
  };

  return (
    <>
      <header className="top">
        <Link to="/staff" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700, minHeight: 44 }}><IBack size={18} />{t("My students")}</Link>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a className="btn bg" href={`mailto:${st.email}`}>{t("Email")} {st.name.split(" ")[0]}</a>
          {st.status === "active" ? <>
            <button className="btn bg" onClick={() => setNtbp(true)}>{t("Not to be placed")}</button>
            <button className="btn bg" onClick={() => setStatus("hired")}>{t("Mark as hired")}</button></>
            : <button className="btn bg" onClick={() => setStatus("active")}>{t("Reactivate")}</button>}
        </div>
      </header>
      {ntbp && <NotToBePlaced studentId={st.id} name={st.name} onClose={() => setNtbp(false)} onDone={(m) => { setNtbp(false); toast(m); reload(); }} />}
      <div className="content">
        {st.status === "not_to_be_placed" && <div className="strip" role="status"><b>{t("Not to be placed.")}</b>
          <span>{st.status_reason}{st.status_changed_at ? t(" · since {v0}", { v0: fmtDate(st.status_changed_at, { month: "short", day: "numeric", year: "numeric" }) }) : ""}{t(". Weekly checks are frozen and {first} is left out of job matching.", { first: st.name.split(" ")[0] })}</span></div>}
        <section className="card row" style={{ alignItems: "center" }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flex: "1 1 300px" }}>
            <div className="av" style={{ width: 60, height: 60, fontSize: 20 }}>{st.initials}</div>
            <div><h1 style={{ fontSize: 24, fontWeight: 800 }}>{st.name}</h1>
              <div className="cap">{[st.cohort, d.deadline.day ? `job search day ${d.deadline.day}` : null, st.email].filter(Boolean).join(" · ")}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                <span className="pill pb">{planLabel(st.enrollment_plan)}</span>
                {st.stage && <span className="pill pg">{stageLabel[st.stage]}</span>}
                {st.on_hold && <span className="pill pr">{t("On hold · no first 1:1")}</span>}
                {st.from_notion && <span className="pill pg">{t("Synced from Notion")}</span>}
              </div></div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", flex: "2 1 520px" }}>
            <Stat l="Points"><span className="num" style={{ fontSize: 24, color: statusNum(d.status) }}>{d.points}</span> <StatusPill status={d.status} paused={d.pause.active} /></Stat>
            <Stat l="Apps this week"><span className="num" style={{ fontSize: 24 }}>{d.week.applications} / {d.week.target}</span></Stat>
            <Stat l="Missed meetings"><span className="num" style={{ fontSize: 24 }}>{d.missed_meetings} / {d.max_missed_meetings}</span></Stat>
            <Stat l="Reschedules used"><span className="num" style={{ fontSize: 24 }}>{st.reschedules_used ?? 0} / 2</span></Stat>
            <Stat l="Homework streak"><span className="num" style={{ fontSize: 24 }}>{d.homework_streak ? t("{homework_streak} miss", { homework_streak: d.homework_streak }) : t("Clear")}</span></Stat>
            <Stat l="Deadline"><span className="num" style={{ fontSize: 18 }}>{fmtDate(d.deadline.deadline, { month: "short", day: "numeric", year: "numeric" })}</span></Stat>
          </div>
        </section>

        <JourneyTracker j={d.journey} studentId={st.id} editable first={st.name.split(" ")[0]} onChanged={(m) => { toast(m); reload(); }} />

        <div className="row" style={{ alignItems: "flex-start" }}>
          <LogSession d={d} scheduledId={scheduled?.id} scheduledDate={scheduled?.session_date} onSaved={(m) => { toast(m); reload(); }} />
          <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
            <Schedule studentId={st.id} scheduled={scheduled} onDone={(m) => { toast(m); reload(); }} />
            <section className="card" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1 }}><h2 className="h2" style={{ fontSize: 18 }}>{t("Resume")}</h2>
                <div className="cap">{t("Build, comment, tailor with AI and approve in Resume Studio.")}</div></div>
              <Link className="btn bp sm" to={`/staff/resumes/${st.id}`}>{t("Open resume")}</Link></section>
            <AssignTask studentId={st.id} first={st.name.split(" ")[0]} onDone={(m) => { toast(m); reload(); }} />
            <Adjust studentId={st.id} onDone={(m) => { toast(m); reload(); }} />
            <Offer studentId={st.id} offers={apps.data?.items || []} onDone={(m) => { toast(m); reload(); }} />
            <Project studentId={st.id} onDone={(m) => { toast(m); reload(); }} />
            <section className="card stack" style={{ gap: 10 }}>
              <h2 className="h2">{t("Recent points")}</h2>
              {points.data?.events.map((e) => <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14 }}>
                <span>{e.title}<span className="cap" style={{ display: "block" }}>{relTime(e.created_at)}</span></span>
                <strong className={e.delta < 0 ? "neg" : "pos"}>{signed(e.delta)}</strong></div>)}
            </section>
          </div>
        </div>

        <StudentShares studentId={st.id} first={st.name.split(" ")[0]} />
        <FromNotion studentId={st.id} />
        {d.status === "suspended" && <Reinstate studentId={st.id} since={st.suspended_at} onDone={(m) => { toast(m); reload(); }} />}
        <div className="row" style={{ alignItems: "flex-start" }}>
          <Interactions studentId={st.id} />
          <Entries studentId={st.id} onDone={(m) => { toast(m); reload(); }} />
        </div>

        <section className="card stack">
          <h2 className="h2">{t("Session history")}</h2>
          {sessions.data?.filter((s) => s.attendance !== "scheduled").map((s) => (
            <div key={s.id} style={{ borderBottom: "1px solid var(--line-soft)", padding: "12px 0" }}>
              <div className="between"><strong>{s.title || sessionType[s.session_type]} · {fmtDate(s.session_date, { weekday: "short", month: "short", day: "numeric" })}</strong>
                <span className={`pill ${s.attendance === "absent" ? "pr" : s.attendance === "excused" || s.attendance === "rescheduled" ? "pa" : "pb"}`}>{s.attendance === "excused" ? "rescheduled" : s.attendance}{s.points ? ` · ${signed(s.points)}` : ""}</span></div>
              {s.summary && <p className="cap" style={{ fontSize: 14, marginTop: 4 }}>{s.summary}</p>}
              {s.homework.length > 0 && <div className="cap" style={{ marginTop: 4 }}>{t("Homework:")} {s.homework.map((h) => `${h.description} (${h.status})`).join(" · ")}</div>}
            </div>))}
          {sessions.data?.length === 0 && <div className="empty">{t("No sessions logged yet.")}</div>}
        </section>
      </div>
    </>);
}

function Stat({ l, children }: { l: string; children: React.ReactNode }) {
  return <div style={{ flex: "1 1 120px", display: "flex", flexDirection: "column", gap: 2, padding: "14px 16px", borderRadius: 14, background: "#E9F2FE" }}>
    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--body)" }}>{l}</span><span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{children}</span></div>;
}

function LogSession({ d, scheduledId, scheduledDate, onSaved }: { d: Dashboard; scheduledId?: string; scheduledDate?: string; onSaved: (m: string) => void }) {
  const [date, setDate] = useState(localInput(scheduledDate ? new Date(scheduledDate) : new Date()));
  const [type, setType] = useState("one_on_one");
  const [att, setAtt] = useState("attended");
  const [summary, setSummary] = useState("");
  const [done, setDone] = useState<string[]>([]);
  const [hw, setHw] = useState<{ description: string; due_date: string }[]>([{ description: "", due_date: "" }]);
  const [resource, setResource] = useState({ label: "", url: "" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (scheduledDate) setDate(localInput(new Date(scheduledDate))); }, [scheduledDate]);

  const payload = () => ({
    student_id: d.student.id, session_date: new Date(date).toISOString(), session_type: type, attendance: att,
    summary: summary || null, completed_task_ids: done, scheduled_session_id: scheduledId || null,
    homework: hw.filter((h) => h.description.trim().length >= 3).map((h) => ({ description: h.description.trim(), due_date: h.due_date || null })),
    resources: resource.url ? [{ label: resource.label || resource.url, url: resource.url }] : [],
  });

  useEffect(() => {
    const it = setTimeout(async () => {
      try { setPreview(await api.post<Preview>("/advisor/sessions/preview", payload())); } catch { /* preview is best-effort */ }
    }, 300);
    return () => clearTimeout(it);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, type, att, done, summary.length > 0, hw.filter((h) => h.description.trim().length >= 3).length, d.points]);

  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await api.post<{ points: number; status: string }>("/advisor/sessions", payload());
      setSummary(""); setDone([]); setHw([{ description: "", due_date: "" }]); setResource({ label: "", url: "" });
      onSaved(`Session saved · ${d.student.name.split(" ")[0]} is now at ${r.points} (${statusLabel[r.status]})`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const first = d.student.name.split(" ")[0];
  return (
    <form className="card stack" style={{ flex: "2 1 560px", gap: 20, minWidth: 0 }} onSubmit={save}>
      <div className="between"><h2 style={{ fontSize: 20, fontWeight: 800 }}>{t("Log session")}</h2><span className="cap">{first} {t("gets your notes by email as soon as you save")}</span></div>
      <div className="grid" style={{ gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
        <div><label className="lb" htmlFor="sd">{t("Date and time")}</label><input className="in" id="sd" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label className="lb" htmlFor="stp">{t("Session type")}</label><select className="in" id="stp" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="one_on_one">{t("1:1 meeting")}</option><option value="group_workshop">{t("GeekForce session")}</option><option value="mock_interview">{t("Mock interview")}</option></select></div>
      </div>
      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend className="lb">{t("Attendance")}</legend>
        <div className="seg" role="radiogroup">
          {[["attended", t("Attended")], ["rescheduled", t("Rescheduled ({v0} of 2 used)", { v0: d.student.reschedules_used ?? 0 })], ["absent", t("Absent")]].map(([v, l]) =>
            <button type="button" key={v} role="radio" aria-checked={att === v} className={att === v ? "on" : ""} onClick={() => setAtt(v)}>{l}</button>)}
        </div>
      </fieldset>
      <div><label className="lb" htmlFor="ss">{t("Session notes")}</label><textarea className="in" id="ss" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t("What you covered, decisions, next steps")} /></div>

      {type === "one_on_one" && d.pending_homework.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="lb" style={{ margin: 0 }}>{t("Homework still pending")}</div>
          {d.pending_homework.map((it) => {
            const on = done.includes(it.id);
            return <label key={it.id} className="hw" style={on ? undefined : { borderColor: "#F6CACC", background: "#FFF8F8" }}>
              <input type="checkbox" checked={on} onChange={() => setDone(on ? done.filter((x) => x !== it.id) : [...done, it.id])} />
              <span style={{ flex: 1, fontSize: 14 }}>{it.description}{it.due_date && <span className="cap"> {t("· due")} {fmtDate(it.due_date)}</span>}</span>
              <span className={`pill ${on ? "pb" : "pr"}`}>{on ? t("Done · +{point_value}", { point_value: it.point_value }) : t("Will be marked missed")}</span></label>;
          })}
          <div className="cap">{t("Tick the tasks {first} actually completed. Unticked tasks count as missed.", { first })}</div>
        </div>)}

      <div className="stack" style={{ gap: 10 }}>
        <div className="lb" style={{ margin: 0 }}>{t("New homework")}</div>
        {hw.map((h, i) => (
          <div key={i} style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0,3fr) minmax(0,1.3fr) auto" }}>
            <label><span className="sr">{t("Task")} {i + 1}</span><input className="in" placeholder={t("e.g. Publish one original LinkedIn post")} value={h.description} onChange={(e) => setHw(hw.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} /></label>
            <label><span className="sr">{t("Due date")} {i + 1}</span><input className="in" type="date" value={h.due_date} onChange={(e) => setHw(hw.map((x, j) => j === i ? { ...x, due_date: e.target.value } : x))} /></label>
            <button type="button" className="icon-btn" aria-label={t("Remove task")} onClick={() => setHw(hw.length > 1 ? hw.filter((_, j) => j !== i) : [{ description: "", due_date: "" }])}>✕</button>
          </div>))}
        <button type="button" className="btn bg sm" style={{ alignSelf: "flex-start" }} onClick={() => setHw([...hw, { description: "", due_date: "" }])}>{t("+ Add task")}</button>
      </div>
      <div className="grid" style={{ gap: 10, gridTemplateColumns: "minmax(0,1fr) minmax(0,2fr)" }}>
        <div><label className="lb" htmlFor="rl">{t("Resource name")}</label><input className="in" id="rl" value={resource.label} onChange={(e) => setResource({ ...resource, label: e.target.value })} /></div>
        <div><label className="lb" htmlFor="ru">{t("Resource link")}</label><input className="in" id="ru" type="url" placeholder="https://…" value={resource.url} onChange={(e) => setResource({ ...resource, url: e.target.value })} /></div>
      </div>

      {preview && (
        <div style={{ background: "var(--blue-tint)", borderRadius: 14, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 4 }} aria-live="polite">
          <div style={{ fontWeight: 800, color: "#0F3F85", marginBottom: 4 }}>{t("When you save, this happens automatically")}</div>
          {preview.effects.length === 0 && <div style={{ fontSize: 14 }}>{t("No point changes.")}</div>}
          {preview.effects.map((e, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", fontSize: 14, borderBottom: "1px dashed var(--blue-line)" }}>
            <span>{e.title}</span><strong className={e.delta < 0 ? "neg" : "pos"}>{signed(e.delta)}</strong></div>)}
          {preview.notes.map((n) => <div key={n} style={{ fontSize: 14, padding: "8px 0", borderBottom: "1px dashed var(--blue-line)" }}>{n}</div>)}
          {preview.emails.map((n) => <div key={n} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "8px 0", borderBottom: "1px dashed var(--blue-line)" }}><span>{t("Email:")} {n}</span><strong>{t("ActiveCampaign")}</strong></div>)}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, paddingTop: 8 }}><span>{t("Balance")}</span>
            <span>{preview.balance_before} → {preview.balance_after} · {statusLabel[preview.status_after] || preview.status_after}</span></div>
          {preview.status_after === "suspended" && d.status !== "suspended" && d.status !== "not_eligible" &&
            <div className="err" style={{ marginTop: 8 }}>{t("Saving this suspends {first}'s Job Guarantee permanently. Only an admin can reverse it.", { first })}</div>}
        </div>)}
      <ErrorBox error={err} />
      <button className="btn bp" style={{ alignSelf: "flex-start" }} disabled={busy}>{busy ? t("Saving…") : t("Save session")}</button>
    </form>);
}

function Schedule({ studentId, scheduled, onDone }: { studentId: string; scheduled?: SessionRec; onDone: (m: string) => void }) {
  const [date, setDate] = useState("");
  const [type, setType] = useState("one_on_one");
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { await api.post("/advisor/sessions/schedule", { student_id: studentId, session_date: new Date(date).toISOString(), session_type: type, title: type === "one_on_one" ? "1:1 meeting" : sessionType[type] }); setDate(""); onDone(t("Session scheduled · student notified")); }
    catch (e) { setErr(e); }
  };
  return <form className="card stack" onSubmit={submit}>
    <h2 className="h2">{t("Next session")}</h2>
    {scheduled && <div className="ok">{t("Booked:")} {new Date(scheduled.session_date).toLocaleString(locale(), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>}
    <div className="grid" style={{ gap: 10, gridTemplateColumns: "1fr 1fr" }}>
      <div><label className="lb" htmlFor="nd">{t("When")}</label><input className="in" id="nd" type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div><label className="lb" htmlFor="nt">{t("Type")}</label><select className="in" id="nt" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="one_on_one">1:1</option><option value="group_workshop">{t("Workshop")}</option><option value="mock_interview">{t("Mock interview")}</option></select></div>
    </div>
    <ErrorBox error={err} />
    <button className="btn bg" style={{ alignSelf: "flex-start" }}>{t("Schedule")}</button>
  </form>;
}

function Adjust({ studentId, onDone }: { studentId: string; onDone: (m: string) => void }) {
  const [dir, setDir] = useState(1);
  const [amount, setAmount] = useState("10");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { const r = await api.post<{ points: number }>("/advisor/points/manual", { student_id: studentId, delta: dir * Number(amount), reason }); setReason(""); onDone(t("Adjustment applied · now {points}", { points: r.points })); }
    catch (e) { setErr(e); }
  };
  return <form className="card stack" onSubmit={submit}>
    <h2 className="h2">{t("Adjust points")}</h2>
    <div className="seg"><button type="button" className={dir > 0 ? "on" : ""} onClick={() => setDir(1)}>{t("Add")}</button><button type="button" className={dir < 0 ? "on" : ""} onClick={() => setDir(-1)}>{t("Remove")}</button></div>
    <div><label className="lb" htmlFor="pa">{t("Points")}</label><input className="in" id="pa" type="number" min={1} max={100} required value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
    <div><label className="lb" htmlFor="pr">{t("Reason (required, visible to admins)")}</label><textarea className="in" id="pr" style={{ minHeight: 84 }} required minLength={5} placeholder={t("e.g. Grace points: documented medical appointment")} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
    <ErrorBox error={err} />
    <button className="btn bp" style={{ alignSelf: "flex-start" }}>{t("Apply adjustment")}</button>
  </form>;
}

function Offer({ studentId, offers, onDone }: { studentId: string; offers: AppItem[]; onDone: (m: string) => void }) {
  const [company, setCompany] = useState("");
  const [appId, setAppId] = useState("");
  const [just, setJust] = useState("");
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = offers.find((o) => o.id === appId)?.company || company;
    try { await api.post("/advisor/offer-rejection", { student_id: studentId, company: name, application_id: appId || null, justification: just || null, justification_approved: ok });
      if (appId) await api.patch(`/applications/${appId}`, { status: "withdrawn" });
      setJust(""); setOk(false); onDone(ok ? t("Offer rejection recorded, justified (no deduction)") : t("Offer rejection recorded · −30")); }
    catch (e) { setErr(e); }
  };
  return <form className="card stack" onSubmit={submit}>
    <div className="between"><h2 className="h2">{t("Report offer rejected")}</h2><span className="pill pr">{t("−30 unless justified")}</span></div>
    {offers.length > 0 ? <div><label className="lb" htmlFor="oc">{t("Offer")}</label><select className="in" id="oc" required value={appId} onChange={(e) => setAppId(e.target.value)}>
      <option value="">{t("Choose…")}</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.company} · {o.role}</option>)}</select></div>
      : <div><label className="lb" htmlFor="ocn">{t("Company")}</label><input className="in" id="ocn" required value={company} onChange={(e) => setCompany(e.target.value)} /></div>}
    <div><label className="lb" htmlFor="oj">{t("Student's written reason")}</label><textarea className="in" id="oj" style={{ minHeight: 84 }} value={just} onChange={(e) => setJust(e.target.value)} /></div>
    <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><input type="checkbox" style={{ width: 18, height: 18, accentColor: "var(--blue-deep)" }} checked={ok} onChange={(e) => setOk(e.target.checked)} />{t("Justification approved (no deduction)")}</label>
    <ErrorBox error={err} />
    <button className="btn bd" style={{ alignSelf: "flex-start" }}>{t("Submit report")}</button>
  </form>;
}

function Project({ studentId, onDone }: { studentId: string; onDone: (m: string) => void }) {
  const [title, setTitle] = useState("");
  const submit = async (e: FormEvent) => { e.preventDefault(); await api.post("/advisor/project", { student_id: studentId, title }); setTitle(""); onDone(t("Project recorded · +20")); };
  return <form className="card stack" onSubmit={submit}>
    <div className="between"><h2 className="h2">{t("Project received")}</h2><span className="pill pb">+20</span></div>
    <div><label className="lb" htmlFor="pj">{t("Project")}</label><input className="in" id="pj" required placeholder={t("e.g. Portfolio site v2")} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
    <button className="btn bg" style={{ alignSelf: "flex-start" }}>{t("Confirm receipt")}</button>
  </form>;
}



function Interactions({ studentId }: { studentId: string }) {
  const list = useApi<Interaction[]>(`/students/${studentId}/interactions`);
  const now = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const blank = { occurred_at: now(), channel: "slack", summary: "", visibility: "private", follow_up_date: "" };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await api.post("/advisor/interactions", { ...f, student_id: studentId, occurred_at: new Date(f.occurred_at).toISOString(), follow_up_date: f.follow_up_date || null });
      setF(blank); list.reload(); } catch (e) { setErr(e); }
  };
  const done = async (i: Interaction) => { await api.patch(`/advisor/interactions/${i.id}`, { follow_up_done: true }); list.reload(); };
  return <section className="card stack" style={{ flex: "3 1 520px", minWidth: 0 }}>
    <div className="between"><h2 className="h2">{t("Interaction log")}</h2><span className="cap">{t("Every touchpoint outside sessions")}</span></div>
    <form className="stack" style={{ gap: 10, background: "var(--bg2)", borderRadius: 12, padding: 16 }} onSubmit={submit}>
      <div className="grid" style={{ gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <div><label className="lb" htmlFor="ic">{t("Channel")}</label><select className="in" id="ic" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
          {Object.entries(channelLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label className="lb" htmlFor="iw">{t("When")}</label><input className="in" id="iw" type="datetime-local" value={f.occurred_at} onChange={(e) => setF({ ...f, occurred_at: e.target.value })} /></div>
        <div><label className="lb" htmlFor="if">{t("Follow up on (optional)")}</label><input className="in" id="if" type="date" min={todayISO()} value={f.follow_up_date} onChange={(e) => setF({ ...f, follow_up_date: e.target.value })} /></div>
      </div>
      <div><label className="lb" htmlFor="is">{t("What happened")}</label><textarea className="in" id="is" style={{ minHeight: 80 }} required value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} placeholder={t("e.g. Called about the Globant offer; she'll send her counter by Friday.")} /></div>
      <div className="between">
        <div className="seg" style={{ flex: "0 1 360px" }}>
          <button type="button" className={f.visibility === "private" ? "on" : ""} onClick={() => setF({ ...f, visibility: "private" })}>{t("Private (staff only)")}</button>
          <button type="button" className={f.visibility === "shared" ? "on" : ""} onClick={() => setF({ ...f, visibility: "shared" })}>{t("Shared with student")}</button>
        </div>
        <button className="btn bp">{t("Add to log")}</button>
      </div>
      <ErrorBox error={err} />
    </form>
    {list.data?.length === 0 && <div className="empty">{t("No interactions logged yet.")}</div>}
    {list.data?.map((i) => (
      <div key={i.id} style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line-soft)" }}>
        <span className="pill pg" style={{ alignSelf: "flex-start" }}>{channelLabel[i.channel]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ whiteSpace: "pre-line" }}>{i.summary}</div>
          <div className="cap">{relTime(i.occurred_at)}{i.advisor ? ` · ${i.advisor}` : ""} · {i.visibility === "shared" ? t("shared with student") : "private"}</div>
          {i.follow_up_date && !i.follow_up_done && <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
            <span className={`pill ${i.follow_up_date <= todayISO() ? "pa" : "pb"}`}>{t("Follow up")} {fmtDate(i.follow_up_date)}</span>
            <button className="btn bg sm" onClick={() => done(i)}>{t("Mark done")}</button></div>}
          {i.follow_up_done && <div className="cap">{t("Follow-up done")}</div>}
        </div>
      </div>))}
  </section>;
}

function Entries({ studentId, onDone }: { studentId: string; onDone: (m: string) => void }) {
  const list = useApi<{ items: Activity[] }>(`/students/${studentId}/activities`);
  const [rejecting, setRejecting] = useState<Activity | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const label = { outreach: t("Outreach"), linkedin_post: t("LinkedIn"), networking: t("Networking") } as const;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { await api.post(`/advisor/activities/${rejecting!.id}/reject`, { reason }); setRejecting(null); setReason(""); list.reload(); onDone(t("Entry rejected · points removed · student notified")); }
    catch (e) { setErr(e); }
  };
  const items = list.data?.items.slice(0, 12) || [];
  return <section className="card stack" style={{ flex: "2 1 340px", minWidth: 0 }}>
    <div className="between"><h2 className="h2">{t("Self-reported entries")}</h2><span className="cap">{t("Spot-check and reject if unverifiable")}</span></div>
    {items.length === 0 && <div className="empty">{t("Nothing logged yet.")}</div>}
    {items.map((a) => (
      <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--line-soft)" }}>
        <span className="pill pg">{label[a.kind]}</span>
        <div style={{ flex: 1, minWidth: 0, fontSize: 14 }}>
          {a.kind === "linkedin_post" ? (a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.post_type === "original" ? t("Original post") : t("Repost with commentary")}</a> : t("Post"))
            : [a.contact_name, a.company, a.notes].filter(Boolean).join(" · ")}
          <div className="cap">{fmtDate(a.occurred_on)}{a.platform ? ` · ${a.platform}` : ""}</div></div>
        {a.status === "rejected" ? <span className="pill pr" title={a.rejected_reason || ""}>{t("Rejected")}</span>
          : <button className="btn bd sm" onClick={() => setRejecting(a)}>{t("Reject")}{a.points_awarded ? ` · −${a.points_awarded}` : ""}</button>}
      </div>))}
    {rejecting && <Modal title={t("Reject this entry")} onClose={() => setRejecting(null)}>
      <form className="stack" onSubmit={submit}>
        <p className="cap" style={{ fontSize: 14 }}>{t("The points come off and the student sees your reason.")}</p>
        <div><label className="lb" htmlFor="rr">{t("Reason")}</label><textarea className="in" id="rr" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("e.g. Couldn't find this message in the screenshot you shared.")} /></div>
        <ErrorBox error={err} />
        <button className="btn bd">{t("Reject entry")}</button>
      </form></Modal>}
  </section>;
}

function Reinstate({ studentId, since, onDone }: { studentId: string; since: string | null; onDone: (m: string) => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pts, setPts] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { await api.post(`/admin/students/${studentId}/reinstate`, { reason, set_points: pts ? Number(pts) : null }); setOpen(false); onDone(t("Guarantee reinstated · logged")); }
    catch (e) { setErr(e); }
  };
  return <section className="callout" style={{ background: "var(--red-soft)", color: "#7F1D1D" }}>
    <div style={{ flex: "1 1 320px" }}><strong>{t("Job Guarantee suspended")}{since ? t(" on {v0}", { v0: fmtDate(since, { month: "short", day: "numeric", year: "numeric" }) }) : ""}.</strong> {t("Suspension is permanent; only an admin can reinstate it, with a reason.")}</div>
    {user?.role === "admin" && <button className="btn bd" onClick={() => setOpen(true)}>{t("Reinstate guarantee")}</button>}
    {open && <Modal title={t("Reinstate the Job Guarantee")} onClose={() => setOpen(false)}>
      <form className="stack" onSubmit={submit}>
        <div><label className="lb" htmlFor="rs">{t("Reason (saved in the audit log)")}</label><textarea className="in" id="rs" required minLength={10} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("e.g. Deduction was logged against the wrong student.")} /></div>
        <div><label className="lb" htmlFor="rp">{t("Correct the balance to (optional, 60 or more)")}</label><input className="in" id="rp" type="number" min={60} max={100} value={pts} onChange={(e) => setPts(e.target.value)} /></div>
        <ErrorBox error={err} />
        <button className="btn bp">{t("Reinstate")}</button>
      </form></Modal>}
  </section>;
}

function NotToBePlaced({ studentId, name, onClose, onDone }: { studentId: string; name: string; onClose: () => void; onDone: (m: string) => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await api.patch(`/advisor/students/${studentId}/status`, { status: "not_to_be_placed", reason }); onDone(t("{name} marked as not to be placed", { name: name })); }
    catch (e) { setErr(e); }
  };
  return <Modal title={t("Mark {v0} as not to be placed?", { v0: name.split(" ")[0] })} onClose={onClose}>
    <form className="stack" onSubmit={save}>
      <p className="cap" style={{ fontSize: 14 }}>{t("Weekly checks and deductions stop, and {first} won't appear in job matches or shortlists. You can reactivate at any time. Also update Placement Status in Notion so both match.", { first: name.split(" ")[0] })}</p>
      <div><label className="lb" htmlFor="ntr">{t("Reason (kept in the audit log)")}</label>
        <textarea className="in" id="ntr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("e.g. Decided to stay in their current job; not job hunting")} /></div>
      <ErrorBox error={err} />
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button type="button" className="btn bg" onClick={onClose}>{t("Cancel")}</button>
        <button className="btn bp" disabled={reason.trim().length < 10}>{t("Confirm")}</button></div>
    </form></Modal>;
}

function AssignTask({ studentId, first, onDone }: { studentId: string; first: string; onDone: (m: string) => void }) {
  const [desc, setDesc] = useState("");
  const [mode, setMode] = useState<"meeting" | "date">("meeting");
  const [due, setDue] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.post(`/advisor/students/${studentId}/homework`, { description: desc.trim(), due_date: mode === "date" ? due : null });
      setDesc(""); setDue(""); onDone(t("Task sent to {first}", { first: first }));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return <form className="card stack" style={{ gap: 12 }} onSubmit={save}>
    <h2 className="h2">{t("Send a task")}</h2>
    <div><label className="lb" htmlFor="tk">{t("What should {first} do?", { first })}</label>
      <textarea className="in" id="tk" style={{ minHeight: 80 }} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("e.g. Apply to the 3 Radar jobs I shared and log them")} /></div>
    <div className="seg" role="radiogroup" aria-label={t("Due")}>
      <button type="button" role="radio" aria-checked={mode === "meeting"} className={mode === "meeting" ? "on" : ""} onClick={() => setMode("meeting")}>{t("By next meeting")}</button>
      <button type="button" role="radio" aria-checked={mode === "date"} className={mode === "date" ? "on" : ""} onClick={() => setMode("date")}>{t("By a date")}</button>
    </div>
    {mode === "date" && <div><label className="lb" htmlFor="tkd">{t("Due date")}</label><input className="in" id="tkd" type="date" min={todayISO()} value={due} onChange={(e) => setDue(e.target.value)} /></div>}
    <div className="cap">{t("Done on time: +15. Still pending at the next 1:1: −15.")} {t("{first} gets it by email right away.", { first })}</div>
    <ErrorBox error={err} />
    <button className="btn bp" style={{ alignSelf: "flex-start" }} disabled={busy || desc.trim().length < 3 || (mode === "date" && !due)}>{busy ? t("Sending…") : t("Send task")}</button>
  </form>;
}

const fmtVal = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.map(fmtVal).join(", ");
  if (typeof v === "boolean") return v ? t("Yes") : "No";
  if (typeof v === "number") return v > 0 && v <= 1 && !Number.isInteger(v) ? `${Math.round(v * 100)}%` : v.toLocaleString(locale());
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? fmtDate(s, { month: "short", day: "numeric", year: "numeric" }) : s;
};

function FromNotion({ studentId }: { studentId: string }) {
  const n = useApi<NotionSnap>(`/advisor/students/${studentId}/notion`);
  if (!n.data || !n.data.connected) return null;
  const groups: [string, Record<string, unknown>][] = [[t("Career & Job Guarantee"), n.data.career], [t("Academic"), n.data.academic]];
  if (n.data.show_billing) groups.push([t("Billing (admins only)"), n.data.billing]);
  return <section className="card stack" style={{ gap: 14 }}>
    <div className="between"><h2 className="h2">{t("From")} <em>{t("Notion")}</em></h2>
      <span className="cap">{n.data.synced_at ? t("Synced {v0}", { v0: relTime(n.data.synced_at) }) : ""}{n.data.notion_url && <> · <a href={n.data.notion_url} target="_blank" rel="noreferrer">{t("Open in Notion")}</a></>}</span></div>
    {n.data.payments_behind !== null && <div className={n.data.payments_behind ? "err" : "ok"}>{n.data.payments_behind ? t("Payments are behind. Missed payments can cancel the Job Guarantee.") : t("Payments are up to date.")}</div>}
    <div className="grid" style={{ gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
      {groups.map(([title, vals]) => <div key={title} className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">{title}</div>
        {Object.keys(vals).length === 0 ? <div className="cap">{t("Nothing filled in Notion yet.")}</div> :
          Object.entries(vals).map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14, padding: "6px 0", borderBottom: "1px solid var(--line-soft)" }}>
            <span className="cap" style={{ fontSize: 14 }}>{k}</span><strong style={{ textAlign: "right" }}>{fmtVal(v)}</strong></div>)}
      </div>)}
    </div>
  </section>;
}
