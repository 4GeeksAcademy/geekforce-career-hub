import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/useApi";
import type { Dashboard, PointsEvent } from "../lib/types";
import { fmtDate, relTime, signed, todayISO } from "../lib/format";
import { ErrorBox, Modal, Spinner, StatusPill, useToast } from "../components/ui";
import { IAlert, ICheck, IPause } from "../components/Icons";

export default function Points() {
  const dash = useApi<Dashboard>("/students/me/dashboard");
  const pts = useApi<{ events: PointsEvent[] }>("/students/me/points?limit=200");
  const [pausing, setPausing] = useState(false);
  const toast = useToast();
  const { refresh } = useAuth();
  if (dash.loading) return <Spinner />;
  const d = dash.data;
  if (!d) return <div className="content"><ErrorBox error={dash.error} /></div>;
  const r = d.rules, t = d.thresholds;

  const nextMonday = (() => { const x = new Date(); const add = ((8 - x.getDay()) % 7) || 7; x.setDate(x.getDate() + add); return x; })();
  const sunday = new Date(nextMonday); sunday.setDate(sunday.getDate() - 1);
  const upcoming = [
    { d: sunday, t: "Week closes · 11:59 PM", s: `${Math.max(0, d.week.target - d.week.applications)} applications to go` },
    { d: nextMonday, t: "Weekly check · 6:00 AM", s: `+${d.week.weekly_bonus} bonus or ${signed(d.week.weekly_penalty)}` },
    ...(d.next_session ? [{ d: new Date(d.next_session.session_date), t: `${d.next_session.title || "Advisor session"}`, s: d.pending_homework.length ? `${d.pending_homework.length} homework task(s) due` : "No homework pending" }] : []),
    ...(d.deadline.deadline ? [{ d: new Date(d.deadline.deadline + "T12:00:00"), t: "Job search deadline", s: `Day ${d.deadline.total_days}${d.deadline.extension_days ? ` (includes +${d.deadline.extension_days} pause days)` : ""}` }] : []),
  ].sort((a, b) => a.d.getTime() - b.d.getTime());

  const earn: [string, string, string?][] = [
    ["Job application", "pts_application"], [`${d.week.target}+ applications in a week (bonus)`, "pts_weekly_bonus"],
    ["Advisor 1:1 attended", "pts_meeting_attended"], ["Project submitted to advisor", "pts_project"],
    ["Homework done before the meeting", "pts_homework"], ["GeekForce session or mock interview", "pts_session_attended"],
    ["Networking action (referral, coffee chat)", "pts_networking"], [`LinkedIn post (max ${r.cap_linkedin_posts_week} a week)`, "pts_linkedin_post"],
    [`Recruiter outreach (max ${r.cap_outreach_week} a week)`, "pts_outreach"], ["Profile task (CV, GitHub, headshot, LinkedIn)", "pts_profile_task", " once"],
  ];
  const lose: [string, string, string?][] = [
    [`Week ends under ${d.week.target} applications`, "ded_weekly_target_missed"], ["Session missed without 24h notice", "ded_session_missed"],
    ["Homework not done by the meeting", "ded_homework_missed"], ["Homework missed 2 meetings in a row", "ded_homework_streak", " extra"],
    ["No LinkedIn activity for 2 weeks", "ded_linkedin_inactive"], ["No recruiter outreach for 2 weeks", "ded_outreach_inactive"],
    ["Valid offer rejected without justification", "ded_offer_rejected"], ["Inactive 30+ days without a pause", "ded_inactivity_initial", `, then ${signed(r.ded_inactivity_weekly)}/week`],
  ];

  return (
    <>
      <header className="top">
        <div><h1>Points &amp; Job Guarantee</h1><div className="sub">You started with {t.secured}. Stay at {t.secured} or above to keep your guarantee secured.</div></div>
        {d.pause.available > 0 && !d.pause.pending && !d.pause.active && <button className="btn bg" onClick={() => setPausing(true)}>Request a pause</button>}
      </header>
      <div className="content">
        <section className="card stack" style={{ gap: 18 }}>
          <div className="between" style={{ alignItems: "flex-end" }}>
            <div><div className="eyebrow">Your balance</div><div style={{ display: "flex", alignItems: "baseline", gap: 12 }}><span className="num" style={{ fontSize: 56, lineHeight: 1 }}>{d.points}</span><StatusPill status={d.status} paused={d.pause.active} /></div></div>
            <div className="cap">Floor {t.floor} · ceiling {t.ceiling}</div>
          </div>
          <div style={{ position: "relative", paddingTop: 24 }}>
            <div style={{ display: "flex", height: 16, borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${t.suspended_below}%`, background: "var(--red-soft)" }} /><div style={{ width: `${t.secured - t.suspended_below}%`, background: "var(--amber-soft)" }} /><div style={{ flex: 1, background: "var(--blue-tint)" }} />
            </div>
            <div style={{ position: "absolute", top: 16, left: `${d.points}%`, transform: "translateX(-50%)", width: 4, height: 32, borderRadius: 2, background: "var(--ink)" }} />
            <div style={{ position: "absolute", top: 0, left: `${Math.min(92, Math.max(4, d.points))}%`, transform: "translateX(-50%)", fontSize: 12, fontWeight: 800 }}>You · {d.points}</div>
            <div style={{ position: "relative", height: 20, marginTop: 10, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
              <span style={{ position: "absolute", left: 0 }}>0</span><span style={{ position: "absolute", left: `${t.suspended_below}%`, transform: "translateX(-50%)" }}>{t.suspended_below}</span>
              <span style={{ position: "absolute", left: `${t.secured}%`, transform: "translateX(-50%)" }}>{t.secured}</span><span style={{ position: "absolute", right: 0 }}>100</span></div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, color: "var(--body)" }}><span>Below {t.suspended_below}: suspended</span><span>{t.suspended_below}–{t.secured - 1}: at risk</span><span>{t.secured}+: secured</span></div>
          </div>
        </section>

        <div className="row">
          <section className="card" style={{ flex: "3 1 460px", display: "flex", flexDirection: "column" }}>
            <h2 className="h2" style={{ marginBottom: 6 }}>What keeps your guarantee secured</h2>
            {d.conditions.map((c) => (
              <div key={c.key} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "14px 0", borderBottom: "1px solid var(--line-soft)" }}>
                <span style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", background: c.ok ? "var(--blue-tint)" : "var(--amber-soft)", color: c.ok ? "var(--blue-deep)" : "var(--amber-ink)" }}>{c.ok ? <ICheck size={15} /> : <IAlert size={15} />}</span>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700 }}>{c.title}</div><div className="cap">{c.detail}</div></div>
                {c.badge && <span className={`pill ${c.ok ? "pb" : "pa"}`}>{c.badge}</span>}
              </div>))}
          </section>
          <section className="card stack" style={{ flex: "2 1 300px" }}>
            <h2 className="h2">Coming up</h2>
            {upcoming.map((u) => (
              <div key={u.t} style={{ display: "flex", gap: 14, alignItems: "center", padding: "6px 0" }}>
                <div style={{ width: 52, flex: "none", textAlign: "center", borderRadius: 10, background: "var(--bg)", padding: "6px 0" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)" }}>{u.d.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}</div>
                  <div className="num" style={{ fontSize: 18, lineHeight: 1.1 }}>{u.d.getDate()}</div></div>
                <div><div style={{ fontWeight: 700, fontSize: 14 }}>{u.t}</div><div className="cap">{u.s}</div></div>
              </div>))}
          </section>
        </div>

        <section className="card stack">
          <h2 className="h2">Points history</h2>
          {pts.loading ? <Spinner /> : <div className="tw"><table>
            <thead><tr><th>When</th><th>What happened</th><th>Source</th><th style={{ textAlign: "right" }}>Points</th><th style={{ textAlign: "right" }}>Balance</th></tr></thead>
            <tbody>{pts.data?.events.map((e) => (
              <tr key={e.id}><td style={{ whiteSpace: "nowrap" }}>{relTime(e.created_at)}</td>
                <td style={{ fontWeight: 600 }}>{e.title}{e.note && e.type === "manual_adjustment" && <div className="cap" style={{ fontWeight: 400 }}>{e.note}</div>}</td>
                <td className="cap" style={{ whiteSpace: "nowrap", textTransform: "capitalize" }}>{e.source.replace("_", " ")}</td>
                <td className={`num ${e.delta < 0 ? "neg" : "pos"}`} style={{ textAlign: "right" }}>{signed(e.delta)}</td>
                <td className="num" style={{ textAlign: "right" }}>{e.balance_after}</td></tr>))}</tbody></table></div>}
        </section>

        <div className="row">
          <RuleCard title="Earn points" rows={earn} r={r} />
          <RuleCard title="Lose points" rows={lose} r={r} />
        </div>

        {d.pause.pending ? (
          <section className="ok">Your {d.pause.pending.days}-day pause request ({fmtDate(d.pause.pending.start_date)} to {fmtDate(d.pause.pending.end_date)}) is waiting for approval.</section>
        ) : d.pause.active ? (
          <section className="ok">You're on an approved pause until {fmtDate(d.pause.until)}. Deductions are frozen.</section>
        ) : (
          <section style={{ background: "var(--navy)", color: "#fff", borderRadius: 16, padding: 28, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: "#1C2C44", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", color: "#CFE2FF" }}><IPause size={26} /></div>
            <div style={{ flex: "1 1 380px" }} className="stack">
              <h2 style={{ fontSize: 20, fontWeight: 800 }}>{d.pause.available ? `Need a break? You have ${d.pause.available} pause available.` : "You've used your pause for this program cycle."}</h2>
              <p style={{ color: "#CFE2FF", fontSize: 14 }}>Up to {d.pause.max_days} days for a medical situation, family emergency or approved travel. Deductions freeze, your guarantee status is frozen, and your deadline moves out by {d.pause.multiplier}× the days you pause.</p>
            </div>
            {d.pause.available > 0 && <button className="btn bw" onClick={() => setPausing(true)}>Request a pause</button>}
          </section>)}
      </div>
      {pausing && <PauseModal max={d.pause.max_days} mult={d.pause.multiplier} onClose={() => setPausing(false)}
        onDone={() => { setPausing(false); toast("Pause requested. Your advisor will review it."); dash.reload(); refresh(); }} />}
    </>);
}

function RuleCard({ title, rows, r }: { title: string; rows: [string, string, string?][]; r: Record<string, number> }) {
  return <section className="card" style={{ flex: "1 1 360px" }}>
    <h2 className="h2" style={{ marginBottom: 8 }}>{title}</h2>
    {rows.map(([l, k, suffix]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--line-soft)", fontSize: 14 }}>
      <span>{l}</span><strong className={r[k] < 0 ? "neg" : "pos"}>{signed(r[k])}{suffix || ""}</strong></div>)}
  </section>;
}

function PauseModal({ max, mult, onClose, onDone }: { max: number; mult: number; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ start_date: todayISO(), end_date: "", reason_type: "medical", reason: "" });
  const [err, setErr] = useState<unknown>(null);
  const days = f.end_date ? Math.round((new Date(f.end_date).getTime() - new Date(f.start_date).getTime()) / 86400000) + 1 : 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { await api.post("/pauses", f); onDone(); } catch (e) { setErr(e); }
  };
  return <Modal title="Request a pause" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <p className="cap" style={{ fontSize: 14 }}>One pause per program cycle, up to {max} days. Your advisor approves it.</p>
      <div className="grid" style={{ gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <div><label className="lb" htmlFor="ps">From</label><input className="in" id="ps" type="date" min={todayISO()} required value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></div>
        <div><label className="lb" htmlFor="pe">To</label><input className="in" id="pe" type="date" min={f.start_date} required value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></div>
      </div>
      <div><label className="lb" htmlFor="pr">Reason</label><select className="in" id="pr" value={f.reason_type} onChange={(e) => setF({ ...f, reason_type: e.target.value })}>
        <option value="medical">Medical situation</option><option value="family">Family emergency</option><option value="travel">Pre-approved travel</option><option value="other">Other</option></select></div>
      <div><label className="lb" htmlFor="pd">Details for your advisor</label><textarea className="in" id="pd" style={{ minHeight: 80 }} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
      {days > 0 && <div className={days > max ? "err" : "ok"}>{days > max ? `That's ${days} days. The maximum is ${max}.` : `${days} days. Your deadline would move out by ${Math.ceil(days * mult)} days.`}</div>}
      <ErrorBox error={err} />
      <button className="btn bp" disabled={!days || days > max}>Send request</button>
    </form></Modal>;
}
