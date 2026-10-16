import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/useApi";
import type { Homework, Interaction, SessionRec } from "../lib/types";
import { channelLabel, fmtDate, relTime, sessionType, signed } from "../lib/format";
import { ErrorBox, Spinner, useToast } from "../components/ui";
import { ICal, IX } from "../components/Icons";

export default function AdvisorHub() {
  const { data, error, loading, reload } = useApi<SessionRec[]>("/students/me/sessions");
  const notes = useApi<Interaction[]>("/students/me/interactions");
  const tasks = useApi<Homework[]>("/students/me/homework");
  const { refresh } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (loading) return <Spinner />;
  if (!data) return <div className="content"><ErrorBox error={error} /></div>;

  const upcoming = data.filter((s) => s.attendance === "scheduled" && new Date(s.session_date) >= new Date())
    .sort((a, b) => +new Date(a.session_date) - +new Date(b.session_date))[0];
  const past = data.filter((s) => s.attendance !== "scheduled");
  const isOpen = (s: SessionRec, i: number) => open[s.id] ?? i === 0;

  const complete = async (id: string, pts: number) => {
    await api.patch(`/homework/${id}/complete`);
    toast(`Homework done · +${pts}`); reload(); tasks.reload(); refresh();
  };

  return (
    <>
      <header className="top"><div><h1>Advisor Hub</h1><div className="sub">Notes and homework from your advisor appear here after every session.</div></div></header>
      <div className="content">
        <div className="row">
          <section className="card" style={{ flex: "2 1 420px", display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
            {upcoming ? <>
              <div style={{ width: 64, height: 68, borderRadius: 14, background: "var(--blue-tint)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--blue-deep)", letterSpacing: ".08em" }}>{fmtDate(upcoming.session_date, { month: "short" }).toUpperCase()}</span>
                <span className="num" style={{ fontSize: 26, lineHeight: 1 }}>{fmtDate(upcoming.session_date, { day: "numeric" })}</span></div>
              <div style={{ flex: "1 1 220px" }}><div className="eyebrow">Next meeting</div>
                <div style={{ fontWeight: 800, fontSize: 19 }}>{new Date(upcoming.session_date).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })} · {sessionType[upcoming.session_type]}</div>
                <div className="cap">{upcoming.title}{upcoming.advisor ? ` · with ${upcoming.advisor}` : ""}</div></div>
            </> : <div className="cap">No meeting scheduled yet. Your advisor will book the next one.</div>}
          </section>
          <section className="card stack" style={{ flex: "1 1 280px", background: "var(--bg2)", gap: 8 }}>
            <div style={{ fontWeight: 800 }}>Can't make it?</div>
            <p className="cap" style={{ fontSize: 14 }}>Ask your advisor to reschedule. You can reschedule twice in the program: the first costs 2 points, the second 5. After that a missed meeting counts as an absence (−10 and one of your 3 allowed misses).</p>
          </section>
        </div>

        {tasks.data && tasks.data.length > 0 && (
          <section className="card stack" style={{ gap: 10 }}>
            <div className="between"><h2 className="h2">Your tasks</h2><span className="cap">{tasks.data.length} open</span></div>
            {tasks.data.map((t) => (
              <label key={t.id} className="hw">
                <input type="checkbox" onChange={() => complete(t.id, t.point_value)} />
                <span style={{ flex: 1 }}>{t.description}
                  <span className="cap" style={{ display: "block" }}>{t.due_date ? `Due ${fmtDate(t.due_date, { weekday: "short", month: "short", day: "numeric" })}` : "Due before your next meeting"}</span></span>
                <span className="pill pa">+{t.point_value}</span>
              </label>))}
            <div className="cap">Tick a task when it's done. Anything still open at your next 1:1 costs 15 points.</div>
          </section>)}

        {notes.data && notes.data.length > 0 && (
          <section className="card stack" style={{ gap: 6 }}>
            <h2 className="h2">Notes from your advisor</h2>
            {notes.data.map((n) => <div key={n.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--line-soft)" }}>
              <div className="cap">{relTime(n.occurred_at)} · {channelLabel[n.channel]}{n.advisor ? ` · ${n.advisor}` : ""}</div>
              <div style={{ whiteSpace: "pre-line" }}>{n.summary}</div></div>)}
          </section>)}
        {past.length === 0 && <div className="card empty">Your first session notes will show up here.</div>}
        {past.map((s, i) => {
          const missed = s.attendance === "absent";
          return (
            <article key={s.id} className="card" style={{ padding: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "20px 24px", flexWrap: "wrap" }}>
                <span style={{ color: missed ? "var(--red-ink)" : "var(--blue-deep)" }}><ICal size={22} /></span>
                <div style={{ flex: "1 1 260px" }}>
                  <h2 className="h2">{s.title || sessionType[s.session_type]} · {fmtDate(s.session_date, { weekday: "long", month: "short", day: "numeric" })}</h2>
                  <div className="cap">{s.advisor ? `With ${s.advisor} · ` : ""}{missed ? "absent" : s.attendance === "excused" || s.attendance === "rescheduled" ? "rescheduled" : "attended"}
                    {s.homework.length ? ` · ${s.homework.length} homework task${s.homework.length > 1 ? "s" : ""}` : ""}</div>
                </div>
                {s.points != null && s.points !== 0 && <span className={`pill ${s.points < 0 ? "pr" : "pb"}`}>{signed(s.points)}{s.points > 0 ? " earned" : ""}</span>}
                {(s.summary || s.homework.length > 0) && <button className="btn bg sm" aria-expanded={isOpen(s, i)} onClick={() => setOpen({ ...open, [s.id]: !isOpen(s, i) })}>{isOpen(s, i) ? "Collapse" : "Expand"}</button>}
              </div>
              {isOpen(s, i) && (s.summary || s.homework.length > 0) && (
                <div style={{ padding: "20px 24px 24px", borderTop: "1px solid var(--line-soft)", display: "flex", flexDirection: "column", gap: 18 }}>
                  {s.summary && <p style={{ color: "var(--body)", whiteSpace: "pre-line" }}>{s.summary}</p>}
                  {s.homework.length > 0 && <div className="stack" style={{ gap: 10 }}>
                    <div className="eyebrow">Homework</div>
                    {s.homework.map((t) => t.status === "missed" ? (
                      <div key={t.id} className="hw" style={{ background: "var(--red-soft)", borderColor: "#F6CACC" }}>
                        <span style={{ color: "var(--red-ink)" }}><IX size={20} /></span><span style={{ flex: 1 }}>{t.description}</span><span className="pill pr">Missed</span></div>
                    ) : (
                      <label key={t.id} className="hw" style={t.status === "completed" ? { background: "#F8FBFF" } : undefined}>
                        <input type="checkbox" checked={t.status === "completed"} disabled={t.status === "completed"} onChange={() => complete(t.id, t.point_value)} />
                        <span style={{ flex: 1, textDecoration: t.status === "completed" ? "line-through" : undefined }}>{t.description}
                          {t.due_date && t.status === "pending" && <span className="cap"> · due {fmtDate(t.due_date)}</span>}</span>
                        <span className={`pill ${t.status === "completed" ? "pb" : "pa"}`}>{t.status === "completed" ? `Done · +${t.point_value}` : `Pending · +${t.point_value}`}</span>
                      </label>))}
                  </div>}
                  {s.resources.length > 0 && <div className="stack" style={{ gap: 10 }}><div className="eyebrow">Resources</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{s.resources.map((r) => <a key={r.url} className="chip" href={r.url} target="_blank" rel="noreferrer">{r.label || r.url}</a>)}</div></div>}
                </div>)}
            </article>);
        })}
      </div>
    </>);
}
