import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import type { AppItem, Dashboard, PointsEvent, SessionRec } from "../lib/types";
import { fmtDate, relTime, sessionType, signed, statusLabel, statusNum } from "../lib/format";
import { ErrorBox, Spinner, StatusPill, useToast } from "../components/ui";
import { IBack } from "../components/Icons";

type Preview = { effects: { type: string; delta: number; title: string }[]; balance_before: number; balance_after: number;
  status_after: string; streak_after: number; missed_meetings_after: number; notes: string[]; emails: string[] };

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function StaffStudent() {
  const { id } = useParams();
  const dash = useApi<Dashboard>(`/students/${id}/dashboard`);
  const sessions = useApi<SessionRec[]>(`/students/${id}/sessions`);
  const points = useApi<{ events: PointsEvent[] }>(`/students/${id}/points?limit=8`);
  const apps = useApi<{ items: AppItem[] }>(`/students/${id}/applications?status=offer`);
  const toast = useToast();
  const reload = () => { dash.reload(); sessions.reload(); points.reload(); apps.reload(); };

  if (dash.loading) return <Spinner />;
  const d = dash.data;
  if (!d) return <div className="content"><ErrorBox error={dash.error} /></div>;
  const st = d.student;
  const scheduled = sessions.data?.find((s) => s.attendance === "scheduled");

  const setStatus = async (status: string) => {
    await api.patch(`/advisor/students/${st.id}/status`, { status });
    toast(status === "hired" ? `${st.name} marked as hired` : "Status updated"); reload();
  };

  return (
    <>
      <header className="top">
        <Link to="/staff" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700, minHeight: 44 }}><IBack size={18} />My students</Link>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a className="btn bg" href={`mailto:${st.email}`}>Email {st.name.split(" ")[0]}</a>
          {st.status === "active" ? <button className="btn bg" onClick={() => setStatus("hired")}>Mark as hired</button>
            : <button className="btn bg" onClick={() => setStatus("active")}>Reactivate</button>}
        </div>
      </header>
      <div className="content">
        <section className="card row" style={{ alignItems: "center" }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flex: "1 1 300px" }}>
            <div className="av" style={{ width: 60, height: 60, fontSize: 20 }}>{st.initials}</div>
            <div><h1 style={{ fontSize: 24, fontWeight: 800 }}>{st.name}</h1>
              <div className="cap">{[st.cohort, d.deadline.day ? `job search day ${d.deadline.day}` : null, st.email].filter(Boolean).join(" · ")}</div></div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", flex: "2 1 520px" }}>
            <Stat l="Points"><span className="num" style={{ fontSize: 24, color: statusNum(d.status) }}>{d.points}</span> <StatusPill status={d.status} paused={d.pause.active} /></Stat>
            <Stat l="Apps this week"><span className="num" style={{ fontSize: 24 }}>{d.week.applications} / {d.week.target}</span></Stat>
            <Stat l="Missed meetings"><span className="num" style={{ fontSize: 24 }}>{d.missed_meetings} / {d.max_missed_meetings}</span></Stat>
            <Stat l="Homework streak"><span className="num" style={{ fontSize: 24 }}>{d.homework_streak ? `${d.homework_streak} miss` : "Clear"}</span></Stat>
            <Stat l="Deadline"><span className="num" style={{ fontSize: 18 }}>{fmtDate(d.deadline.deadline, { month: "short", day: "numeric", year: "numeric" })}</span></Stat>
          </div>
        </section>

        <div className="row" style={{ alignItems: "flex-start" }}>
          <LogSession d={d} scheduledId={scheduled?.id} scheduledDate={scheduled?.session_date} onSaved={(m) => { toast(m); reload(); }} />
          <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
            <Schedule studentId={st.id} scheduled={scheduled} onDone={(m) => { toast(m); reload(); }} />
            <Adjust studentId={st.id} onDone={(m) => { toast(m); reload(); }} />
            <Offer studentId={st.id} offers={apps.data?.items || []} onDone={(m) => { toast(m); reload(); }} />
            <Project studentId={st.id} onDone={(m) => { toast(m); reload(); }} />
            <section className="card stack" style={{ gap: 10 }}>
              <h2 className="h2">Recent points</h2>
              {points.data?.events.map((e) => <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14 }}>
                <span>{e.title}<span className="cap" style={{ display: "block" }}>{relTime(e.created_at)}</span></span>
                <strong className={e.delta < 0 ? "neg" : "pos"}>{signed(e.delta)}</strong></div>)}
            </section>
          </div>
        </div>

        <section className="card stack">
          <h2 className="h2">Session history</h2>
          {sessions.data?.filter((s) => s.attendance !== "scheduled").map((s) => (
            <div key={s.id} style={{ borderBottom: "1px solid var(--line-soft)", padding: "12px 0" }}>
              <div className="between"><strong>{s.title || sessionType[s.session_type]} · {fmtDate(s.session_date, { weekday: "short", month: "short", day: "numeric" })}</strong>
                <span className={`pill ${s.attendance === "absent" ? "pr" : s.attendance === "excused" ? "pg" : "pb"}`}>{s.attendance}{s.points ? ` · ${signed(s.points)}` : ""}</span></div>
              {s.summary && <p className="cap" style={{ fontSize: 14, marginTop: 4 }}>{s.summary}</p>}
              {s.homework.length > 0 && <div className="cap" style={{ marginTop: 4 }}>Homework: {s.homework.map((h) => `${h.description} (${h.status})`).join(" · ")}</div>}
            </div>))}
          {sessions.data?.length === 0 && <div className="empty">No sessions logged yet.</div>}
        </section>
      </div>
    </>);
}

function Stat({ l, children }: { l: string; children: React.ReactNode }) {
  return <div style={{ flex: "1 1 120px", display: "flex", flexDirection: "column", gap: 2, padding: "12px 16px", borderRadius: 12, background: "var(--bg2)" }}>
    <span className="cap">{l}</span><span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{children}</span></div>;
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
    const t = setTimeout(async () => {
      try { setPreview(await api.post<Preview>("/advisor/sessions/preview", payload())); } catch { /* preview is best-effort */ }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, type, att, done, summary.length > 0, hw.filter((h) => h.description.trim().length >= 3).length]);

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
      <div className="between"><h2 style={{ fontSize: 20, fontWeight: 800 }}>Log session</h2><span className="cap">{first} gets your notes by email as soon as you save</span></div>
      <div className="grid" style={{ gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
        <div><label className="lb" htmlFor="sd">Date and time</label><input className="in" id="sd" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label className="lb" htmlFor="stp">Session type</label><select className="in" id="stp" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="one_on_one">1:1 meeting</option><option value="group_workshop">GeekForce session</option><option value="mock_interview">Mock interview</option></select></div>
      </div>
      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend className="lb">Attendance</legend>
        <div className="seg" role="radiogroup">
          {[["attended", "Attended"], ["excused", "Absent, notified 24h+"], ["absent", "Absent, no notice"]].map(([v, l]) =>
            <button type="button" key={v} role="radio" aria-checked={att === v} className={att === v ? "on" : ""} onClick={() => setAtt(v)}>{l}</button>)}
        </div>
      </fieldset>
      <div><label className="lb" htmlFor="ss">Session notes</label><textarea className="in" id="ss" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What you covered, decisions, next steps" /></div>

      {type === "one_on_one" && d.pending_homework.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="lb" style={{ margin: 0 }}>Homework still pending</div>
          {d.pending_homework.map((t) => {
            const on = done.includes(t.id);
            return <label key={t.id} className="hw" style={on ? undefined : { borderColor: "#F6CACC", background: "#FFF8F8" }}>
              <input type="checkbox" checked={on} onChange={() => setDone(on ? done.filter((x) => x !== t.id) : [...done, t.id])} />
              <span style={{ flex: 1, fontSize: 14 }}>{t.description}{t.due_date && <span className="cap"> · due {fmtDate(t.due_date)}</span>}</span>
              <span className={`pill ${on ? "pb" : "pr"}`}>{on ? `Done · +${t.point_value}` : "Will be marked missed"}</span></label>;
          })}
          <div className="cap">Tick the tasks {first} actually completed. Unticked tasks count as missed.</div>
        </div>)}

      <div className="stack" style={{ gap: 10 }}>
        <div className="lb" style={{ margin: 0 }}>New homework</div>
        {hw.map((h, i) => (
          <div key={i} style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0,3fr) minmax(0,1.3fr) auto" }}>
            <label><span className="sr">Task {i + 1}</span><input className="in" placeholder="e.g. Publish one original LinkedIn post" value={h.description} onChange={(e) => setHw(hw.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} /></label>
            <label><span className="sr">Due date {i + 1}</span><input className="in" type="date" value={h.due_date} onChange={(e) => setHw(hw.map((x, j) => j === i ? { ...x, due_date: e.target.value } : x))} /></label>
            <button type="button" className="icon-btn" aria-label="Remove task" onClick={() => setHw(hw.length > 1 ? hw.filter((_, j) => j !== i) : [{ description: "", due_date: "" }])}>✕</button>
          </div>))}
        <button type="button" className="btn bg sm" style={{ alignSelf: "flex-start" }} onClick={() => setHw([...hw, { description: "", due_date: "" }])}>+ Add task</button>
      </div>
      <div className="grid" style={{ gap: 10, gridTemplateColumns: "minmax(0,1fr) minmax(0,2fr)" }}>
        <div><label className="lb" htmlFor="rl">Resource name</label><input className="in" id="rl" value={resource.label} onChange={(e) => setResource({ ...resource, label: e.target.value })} /></div>
        <div><label className="lb" htmlFor="ru">Resource link</label><input className="in" id="ru" type="url" placeholder="https://…" value={resource.url} onChange={(e) => setResource({ ...resource, url: e.target.value })} /></div>
      </div>

      {preview && (
        <div style={{ background: "var(--blue-tint)", borderRadius: 14, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 4 }} aria-live="polite">
          <div style={{ fontWeight: 800, color: "#0F3F85", marginBottom: 4 }}>When you save, this happens automatically</div>
          {preview.effects.length === 0 && <div style={{ fontSize: 14 }}>No point changes.</div>}
          {preview.effects.map((e, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", fontSize: 14, borderBottom: "1px dashed var(--blue-line)" }}>
            <span>{e.title}</span><strong className={e.delta < 0 ? "neg" : "pos"}>{signed(e.delta)}</strong></div>)}
          {preview.notes.map((n) => <div key={n} style={{ fontSize: 14, padding: "8px 0", borderBottom: "1px dashed var(--blue-line)" }}>{n}</div>)}
          {preview.emails.map((n) => <div key={n} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "8px 0", borderBottom: "1px dashed var(--blue-line)" }}><span>Email: {n}</span><strong>Brevo</strong></div>)}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, paddingTop: 8 }}><span>Balance</span>
            <span>{preview.balance_before} → {preview.balance_after} · {statusLabel[preview.status_after] || preview.status_after}</span></div>
        </div>)}
      <ErrorBox error={err} />
      <button className="btn bp" style={{ alignSelf: "flex-start" }} disabled={busy}>{busy ? "Saving…" : "Save session"}</button>
    </form>);
}

function Schedule({ studentId, scheduled, onDone }: { studentId: string; scheduled?: SessionRec; onDone: (m: string) => void }) {
  const [date, setDate] = useState("");
  const [type, setType] = useState("one_on_one");
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { await api.post("/advisor/sessions/schedule", { student_id: studentId, session_date: new Date(date).toISOString(), session_type: type, title: type === "one_on_one" ? "1:1 meeting" : sessionType[type] }); setDate(""); onDone("Session scheduled · student notified"); }
    catch (e) { setErr(e); }
  };
  return <form className="card stack" onSubmit={submit}>
    <h2 className="h2">Next session</h2>
    {scheduled && <div className="ok">Booked: {new Date(scheduled.session_date).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>}
    <div className="grid" style={{ gap: 10, gridTemplateColumns: "1fr 1fr" }}>
      <div><label className="lb" htmlFor="nd">When</label><input className="in" id="nd" type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div><label className="lb" htmlFor="nt">Type</label><select className="in" id="nt" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="one_on_one">1:1</option><option value="group_workshop">Workshop</option><option value="mock_interview">Mock interview</option></select></div>
    </div>
    <ErrorBox error={err} />
    <button className="btn bg" style={{ alignSelf: "flex-start" }}>Schedule</button>
  </form>;
}

function Adjust({ studentId, onDone }: { studentId: string; onDone: (m: string) => void }) {
  const [dir, setDir] = useState(1);
  const [amount, setAmount] = useState("10");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { const r = await api.post<{ points: number }>("/advisor/points/manual", { student_id: studentId, delta: dir * Number(amount), reason }); setReason(""); onDone(`Adjustment applied · now ${r.points}`); }
    catch (e) { setErr(e); }
  };
  return <form className="card stack" onSubmit={submit}>
    <h2 className="h2">Adjust points</h2>
    <div className="seg"><button type="button" className={dir > 0 ? "on" : ""} onClick={() => setDir(1)}>Add</button><button type="button" className={dir < 0 ? "on" : ""} onClick={() => setDir(-1)}>Remove</button></div>
    <div><label className="lb" htmlFor="pa">Points</label><input className="in" id="pa" type="number" min={1} max={100} required value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
    <div><label className="lb" htmlFor="pr">Reason (required, visible to admins)</label><textarea className="in" id="pr" style={{ minHeight: 84 }} required minLength={5} placeholder="e.g. Grace points: documented medical appointment" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
    <ErrorBox error={err} />
    <button className="btn bp" style={{ alignSelf: "flex-start" }}>Apply adjustment</button>
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
      setJust(""); setOk(false); onDone(ok ? "Offer rejection recorded, justified (no deduction)" : "Offer rejection recorded · −30"); }
    catch (e) { setErr(e); }
  };
  return <form className="card stack" onSubmit={submit}>
    <div className="between"><h2 className="h2">Report offer rejected</h2><span className="pill pr">−30 unless justified</span></div>
    {offers.length > 0 ? <div><label className="lb" htmlFor="oc">Offer</label><select className="in" id="oc" required value={appId} onChange={(e) => setAppId(e.target.value)}>
      <option value="">Choose…</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.company} · {o.role}</option>)}</select></div>
      : <div><label className="lb" htmlFor="ocn">Company</label><input className="in" id="ocn" required value={company} onChange={(e) => setCompany(e.target.value)} /></div>}
    <div><label className="lb" htmlFor="oj">Student's written reason</label><textarea className="in" id="oj" style={{ minHeight: 84 }} value={just} onChange={(e) => setJust(e.target.value)} /></div>
    <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><input type="checkbox" style={{ width: 18, height: 18, accentColor: "var(--blue-deep)" }} checked={ok} onChange={(e) => setOk(e.target.checked)} />Justification approved (no deduction)</label>
    <ErrorBox error={err} />
    <button className="btn bd" style={{ alignSelf: "flex-start" }}>Submit report</button>
  </form>;
}

function Project({ studentId, onDone }: { studentId: string; onDone: (m: string) => void }) {
  const [title, setTitle] = useState("");
  const submit = async (e: FormEvent) => { e.preventDefault(); await api.post("/advisor/project", { student_id: studentId, title }); setTitle(""); onDone("Project recorded · +20"); };
  return <form className="card stack" onSubmit={submit}>
    <div className="between"><h2 className="h2">Project received</h2><span className="pill pb">+20</span></div>
    <div><label className="lb" htmlFor="pj">Project</label><input className="in" id="pj" required placeholder="e.g. Portfolio site v2" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
    <button className="btn bg" style={{ alignSelf: "flex-start" }}>Confirm receipt</button>
  </form>;
}

