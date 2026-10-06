import { Link } from "react-router-dom";
import { useEffect } from "react";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import type { Dashboard as D } from "../lib/types";
import { fmtDate, relTime, signed } from "../lib/format";
import { Bar, ErrorBox, Gauge, Legend, Spinner, StatusPill } from "../components/ui";
import { IArrow, IBell, IPlus, IShield } from "../components/Icons";

export default function Dashboard() {
  const { data: d, error, loading } = useApi<D>("/students/me/dashboard");
  const { user, refresh } = useAuth();
  useEffect(() => { if (d && user?.student && d.points !== user.student.points) refresh(); }, [d, user, refresh]);
  if (loading) return <Spinner />;
  if (error || !d) return <div className="content"><ErrorBox error={error} /></div>;

  const first = user?.name.split(" ")[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const w = d.week;
  const appsLeft = Math.max(0, w.target - w.applications);
  const plan = d.student.enrollment_plan;
  const banner = d.student.on_hold
    ? { bg: "var(--red-soft)", fg: "#7F1D1D", title: "Your GeekForce process is on hold.", body: "You haven't had your first 1:1 yet. Book it now: on day 30 without it, the Job Guarantee is lost." }
    : d.pause.active
    ? { bg: "#F0F2F5", fg: "var(--ink)", title: `You're on an approved pause until ${fmtDate(d.pause.until)}.`, body: "Automatic deductions are frozen and your guarantee status is on hold." }
    : d.status === "not_eligible"
      ? { bg: "var(--blue-tint)", fg: "#0F3F85", title: `${plan === "professional_support" ? "Professional Support" : "Career support"}: keep your momentum.`, body: `Your plan doesn't include the Job Guarantee, but points track your progress. Weekly target: ${w.target} applications.` }
    : d.status === "secured"
      ? { bg: "var(--blue-tint)", fg: "#0F3F85", title: "Your Job Guarantee is secured.", body: `Keep your weekly rhythm: ${w.target} applications, one original LinkedIn post, and your homework before each meeting.` }
      : d.status === "at_risk"
        ? { bg: "var(--amber-soft)", fg: "var(--ink)", title: `Your Job Guarantee is at risk. You're ${d.gap_to_secure} points from securing it.`, body: `Below ${d.thresholds.suspended_below} the guarantee is suspended permanently.` }
        : { bg: "var(--red-soft)", fg: "#7F1D1D", title: "Your Job Guarantee has been suspended.", body: "You keep full career support, sessions and points. Keep going: your advisor is still here to help you land the job." };

  return (
    <>
      <header className="top">
        <div><h1>{greet}, {first}</h1>
          <div className="sub">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} · This week closes Sunday at 11:59 PM
            {d.deadline.day ? ` · Job search day ${d.deadline.day}` : ""}</div></div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link className="icon-btn" to="/notifications" aria-label={`Notifications, ${d.unread_notifications} unread`}>
            <IBell />{d.unread_notifications > 0 && <span className="dot">{d.unread_notifications}</span>}</Link>
          <Link className="btn bp" to="/tracker"><IPlus size={18} />Log activity</Link>
        </div>
      </header>
      <div className="content">
        <div className="callout" style={{ background: banner.bg, color: banner.fg }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><IShield size={22} /></div>
          <div style={{ flex: "1 1 320px" }}><div style={{ fontWeight: 800, fontSize: 17 }}>{banner.title}</div><div style={{ fontSize: 14 }}>{banner.body}</div></div>
          <Link className="btn bp" to="/points">See my plan <IArrow size={16} /></Link>
        </div>

        <div className="row">
          <section className="card stack" style={{ flex: "1 1 300px", alignItems: "center" }} aria-label="Career points">
            <div className="eyebrow" style={{ alignSelf: "flex-start" }}>Career points</div>
            <Gauge points={d.points} status={d.status} secured={d.thresholds.secured} suspended={d.thresholds.suspended_below} />
            <StatusPill status={d.status} paused={d.pause.active} />
            <Legend />
          </section>
          <div className="grid" style={{ flex: "2 1 520px" }}>
            <Stat label="Applications this week" value={w.applications} of={`of ${w.target}`} max={w.target} warn={w.quota_applies && appsLeft > 0}
              note={!w.quota_applies ? "Your weekly target starts when you reach Stage 3 · Job hunting." : appsLeft ? `${appsLeft} more by Sunday: +${appsLeft * w.pts_application} pts, a +${w.weekly_bonus} bonus, and no ${signed(w.weekly_penalty)} on Monday.` : `Weekly goal met. +${w.weekly_bonus} bonus lands Monday.`} />
            <Stat label="LinkedIn posts this week" value={w.linkedin_posts} of={`of 1 original required`} max={1} warn={w.linkedin_posts === 0}
              note={`Up to ${w.linkedin_cap} posts a week earn +${d.rules.pts_linkedin_post ?? 5} each.`} />
            <Stat label="Recruiter outreach this week" value={w.outreach} of={`of ${w.outreach_cap} that earn points`} max={w.outreach_cap}
              note={`+${d.rules.pts_outreach ?? 5} each. Two weeks with none costs ${signed(d.rules.ded_outreach_inactive ?? -10)}.`} />
            <section className="card stack" style={{ gap: 12 }}>
              <div className="eyebrow">Missed meetings</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span className="big">{d.missed_meetings}</span><span className="cap" style={{ fontSize: 15 }}>of {d.max_missed_meetings} allowed</span></div>
              <div style={{ display: "flex", gap: 6 }}>{Array.from({ length: d.max_missed_meetings }, (_, i) =>
                <span key={i} style={{ flex: 1, height: 8, borderRadius: 4, background: i < d.missed_meetings ? "var(--red)" : "var(--line)" }} />)}</div>
              <div className="cap">Tell your advisor 24h ahead and it doesn't count.</div>
            </section>
          </div>
        </div>

        <div className="row">
          <section className="card stack" style={{ flex: "3 1 460px" }}>
            <div className="between"><h2 className="h2">{d.status === "at_risk" ? `Your fastest way back to ${d.thresholds.secured}` : d.status === "secured" ? "Keep your guarantee secured" : "Your next best moves"}</h2><span className="cap">Ranked by impact</span></div>
            {d.actions.length === 0 && <div className="empty">You're all caught up this week.</div>}
            {d.actions.map((a, i) => (
              <Link key={a.title} className="act" to={a.link}><span className="rank">{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontWeight: 700 }}>{a.title}</span><span className="cap" style={{ display: "block" }}>{a.why}</span></span>
                <span className="pill pb">+{a.points}</span></Link>))}
          </section>
          <section className="card stack" style={{ flex: "2 1 320px" }}>
            <div className="eyebrow">Next advisor meeting</div>
            {d.next_session ? (
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 56, height: 60, borderRadius: 12, background: "var(--blue-tint)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "var(--blue-deep)", letterSpacing: ".08em" }}>{fmtDate(d.next_session.session_date, { month: "short" }).toUpperCase()}</span>
                  <span className="num" style={{ fontSize: 22, lineHeight: 1 }}>{fmtDate(d.next_session.session_date, { day: "numeric" })}</span></div>
                <div><div style={{ fontWeight: 800, fontSize: 18 }}>{new Date(d.next_session.session_date).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })}</div>
                  <div className="cap">{d.next_session.title || "Session"}{d.next_session.advisor ? ` with ${d.next_session.advisor}` : ""}</div></div>
              </div>) : <div className="cap">No meeting scheduled yet. Your advisor will book the next one.</div>}
            {d.pending_homework.length > 0 && (
              <div style={{ background: "var(--red-soft)", borderRadius: 12, padding: "14px 16px", fontSize: 14, color: "#7F1D1D" }}>
                <strong>{d.pending_homework.length} homework task{d.pending_homework.length > 1 ? "s" : ""} still pending.</strong> Each one not done by the meeting costs {signed(d.rules.ded_homework_missed ?? -15)}
                {d.homework_streak > 0 ? `, and a second miss in a row adds ${signed(d.rules.ded_homework_streak ?? -10)}.` : "."}</div>)}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: "auto" }}>
              <Link className="btn bp" to="/advisor">{d.pending_homework.length ? "Do homework" : "Advisor Hub"}</Link>
            </div>
          </section>
        </div>

        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="between" style={{ marginBottom: 6 }}><h2 className="h2">Recent activity</h2><Link to="/points" style={{ fontWeight: 700, fontSize: 14 }}>Full points history</Link></div>
          {d.recent.length === 0 && <div className="empty">Your points history starts with your first application.</div>}
          <div className="list">{d.recent.map((e) => (
            <div className="li" key={e.id}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", flex: "none", background: e.delta < 0 ? "var(--red)" : "var(--blue)" }} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600 }}>{e.title}</div><div className="cap">{relTime(e.created_at)}{e.note ? ` · ${e.note}` : ""}</div></div>
              <div style={{ textAlign: "right", flex: "none" }}><div className={`num ${e.delta < 0 ? "neg" : "pos"}`} style={{ fontSize: 16 }}>{signed(e.delta)}</div><div className="cap">Balance {e.balance_after}</div></div>
            </div>))}</div>
        </section>
      </div>
    </>);
}

function Stat({ label, value, of, max, note, warn }: { label: string; value: number; of: string; max: number; note: string; warn?: boolean }) {
  return (
    <section className="card stack" style={{ gap: 12 }}>
      <div className="eyebrow">{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span className="big" style={{ color: warn ? "var(--amber-num)" : "var(--ink)" }}>{value}</span><span className="cap" style={{ fontSize: 15 }}>{of}</span></div>
      <Bar value={value} max={max} color={warn ? "var(--amber)" : "var(--blue)"} />
      <div className="cap">{note}</div>
    </section>);
}
