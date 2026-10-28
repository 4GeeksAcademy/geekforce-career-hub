import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/useApi";
import type { Dashboard, PointsEvent } from "../lib/types";
import { fmtDate, relTime, signed, todayISO } from "../lib/format";
import { ErrorBox, Modal, Spinner, StatusPill, useToast } from "../components/ui";
import { IAlert, ICheck, IPause } from "../components/Icons";
import { locale, t } from "../lib/i18n";

export default function Points() {
  const dash = useApi<Dashboard>("/students/me/dashboard");
  const pts = useApi<{ events: PointsEvent[] }>("/students/me/points?limit=200");
  const [pausing, setPausing] = useState(false);
  const toast = useToast();
  const { refresh } = useAuth();
  if (dash.loading) return <Spinner />;
  const d = dash.data;
  if (!d) return <div className="content"><ErrorBox error={dash.error} /></div>;
  const r = d.rules, it = d.thresholds;

  const nextMonday = (() => { const x = new Date(); const add = ((8 - x.getDay()) % 7) || 7; x.setDate(x.getDate() + add); return x; })();
  const sunday = new Date(nextMonday); sunday.setDate(sunday.getDate() - 1);
  const upcoming = [
    { d: sunday, t: t("Week closes · 11:59 PM"), s: `${Math.max(0, d.week.target - d.week.applications)} applications to go` },
    { d: nextMonday, t: t("Weekly check · 6:00 AM"), s: `+${d.week.weekly_bonus} bonus or ${signed(d.week.weekly_penalty)}` },
    ...(d.next_session ? [{ d: new Date(d.next_session.session_date), t: `${d.next_session.title || t("Advisor session")}`, s: d.pending_homework.length ? `${d.pending_homework.length} homework task(s) due` : t("No homework pending") }] : []),
    ...(d.deadline.deadline ? [{ d: new Date(d.deadline.deadline + "T12:00:00"), t: t("Job search deadline"), s: `Day ${d.deadline.total_days}${d.deadline.extension_days ? ` (includes +${d.deadline.extension_days} pause days)` : ""}` }] : []),
  ].sort((a, b) => a.d.getTime() - b.d.getTime());

  const earn: [string, string, string?][] = [
    [t("Job application"), "pts_application"], [`${d.week.target}+ applications in a week (bonus)`, "pts_weekly_bonus"],
    [t("Advisor 1:1 attended"), "pts_meeting_attended"], [t("Project submitted to advisor"), "pts_project"],
    [t("Homework done before the meeting"), "pts_homework"], [t("GeekForce session or mock interview"), "pts_session_attended"],
    [t("Networking action (referral, coffee chat)"), "pts_networking"], [`LinkedIn post (max ${r.cap_linkedin_posts_week} a week)`, "pts_linkedin_post"],
    [`Recruiter outreach (max ${r.cap_outreach_week} a week)`, "pts_outreach"], [t("Profile task (CV, GitHub, headshot, LinkedIn)"), "pts_profile_task", " once"],
  ];
  const lose: [string, string, string?][] = [
    [`Week ends under ${d.week.target} applications`, "ded_weekly_target_missed"], [t("Session missed without 24h notice"), "ded_session_missed"],
    [t("Homework not done by the meeting"), "ded_homework_missed"], [t("Homework missed 2 meetings in a row"), "ded_homework_streak", " extra"],
    [t("No LinkedIn activity for 2 weeks"), "ded_linkedin_inactive"], [t("No recruiter outreach for 2 weeks"), "ded_outreach_inactive"],
    [t("Valid offer rejected without justification"), "ded_offer_rejected"], [t("Inactive 30+ days without a pause"), "ded_inactivity_initial", `, then ${signed(r.ded_inactivity_weekly)}/week`],
  ];

  return (
    <>
      <header className="top">
        <div><h1>{t("Points & Job Guarantee")}</h1><div className="sub">{t("You started with {n}. Stay at {n} or above to keep your guarantee secured.", { n: it.secured })}</div></div>
        {d.pause.available > 0 && !d.pause.pending && !d.pause.active && <button className="btn bg" onClick={() => setPausing(true)}>{t("Request a pause")}</button>}
      </header>
      <div className="content">
        <section className="card stack" style={{ gap: 18 }}>
          <div className="between" style={{ alignItems: "flex-end" }}>
            <div><div className="eyebrow">{t("Your balance")}</div><div style={{ display: "flex", alignItems: "baseline", gap: 12 }}><span className="num" style={{ fontSize: 56, lineHeight: 1 }}>{d.points}</span><StatusPill status={d.status} paused={d.pause.active} /></div></div>
            <div className="cap">{t("Floor {floor} · ceiling {ceiling}", { floor: it.floor, ceiling: it.ceiling })}</div>
          </div>
          <div style={{ position: "relative", paddingTop: 24 }}>
            <div style={{ display: "flex", height: 16, borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${it.suspended_below}%`, background: "var(--red-soft)" }} /><div style={{ width: `${it.secured - it.suspended_below}%`, background: "var(--amber-soft)" }} /><div style={{ flex: 1, background: "var(--blue-tint)" }} />
            </div>
            <div style={{ position: "absolute", top: 16, left: `${d.points}%`, transform: "translateX(-50%)", width: 4, height: 32, borderRadius: 2, background: "var(--ink)" }} />
            <div style={{ position: "absolute", top: 0, left: `${Math.min(92, Math.max(4, d.points))}%`, transform: "translateX(-50%)", fontSize: 12, fontWeight: 800 }}>{t("You ·")} {d.points}</div>
            <div style={{ position: "relative", height: 20, marginTop: 10, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
              <span style={{ position: "absolute", left: 0 }}>0</span><span style={{ position: "absolute", left: `${it.suspended_below}%`, transform: "translateX(-50%)" }}>{it.suspended_below}</span>
              <span style={{ position: "absolute", left: `${it.secured}%`, transform: "translateX(-50%)" }}>{it.secured}</span><span style={{ position: "absolute", right: 0 }}>100</span></div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, color: "var(--body)" }}><span>{t("Below {n}: suspended", { n: it.suspended_below })}</span><span>{it.suspended_below}–{it.secured - 1}{t(": at risk")}</span><span>{it.secured}{t("+: secured")}</span></div>
          </div>
        </section>

        <div className="row">
          <section className="card" style={{ flex: "3 1 460px", display: "flex", flexDirection: "column" }}>
            <h2 className="h2" style={{ marginBottom: 6 }}>{t("What keeps your guarantee secured")}</h2>
            {d.conditions.map((c) => (
              <div key={c.key} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "14px 0", borderBottom: "1px solid var(--line-soft)" }}>
                <span style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", background: c.ok ? "var(--blue-tint)" : "var(--amber-soft)", color: c.ok ? "var(--blue-deep)" : "var(--amber-ink)" }}>{c.ok ? <ICheck size={15} /> : <IAlert size={15} />}</span>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700 }}>{c.title}</div><div className="cap">{c.detail}</div></div>
                {c.badge && <span className={`pill ${c.ok ? "pb" : "pa"}`}>{c.badge}</span>}
              </div>))}
          </section>
          <section className="card stack" style={{ flex: "2 1 300px" }}>
            <h2 className="h2">{t("Coming up")}</h2>
            {upcoming.map((u) => (
              <div key={u.t} style={{ display: "flex", gap: 14, alignItems: "center", padding: "6px 0" }}>
                <div style={{ width: 52, flex: "none", textAlign: "center", borderRadius: 10, background: "var(--bg)", padding: "6px 0" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)" }}>{u.d.toLocaleDateString(locale(), { month: "short" }).toUpperCase()}</div>
                  <div className="num" style={{ fontSize: 18, lineHeight: 1.1 }}>{u.d.getDate()}</div></div>
                <div><div style={{ fontWeight: 700, fontSize: 14 }}>{u.t}</div><div className="cap">{u.s}</div></div>
              </div>))}
          </section>
        </div>

        <section className="card stack">
          <h2 className="h2">{t("Points history")}</h2>
          {pts.loading ? <Spinner /> : <div className="tw"><table>
            <thead><tr><th>{t("When")}</th><th>{t("What happened")}</th><th>{t("Source")}</th><th style={{ textAlign: "right" }}>{t("Points")}</th><th style={{ textAlign: "right" }}>{t("Balance")}</th></tr></thead>
            <tbody>{pts.data?.events.map((e) => (
              <tr key={e.id}><td style={{ whiteSpace: "nowrap" }}>{relTime(e.created_at)}</td>
                <td style={{ fontWeight: 600 }}>{e.title}{e.note && e.type === "manual_adjustment" && <div className="cap" style={{ fontWeight: 400 }}>{e.note}</div>}</td>
                <td className="cap" style={{ whiteSpace: "nowrap", textTransform: "capitalize" }}>{e.source.replace("_", " ")}</td>
                <td className={`num ${e.delta < 0 ? "neg" : "pos"}`} style={{ textAlign: "right" }}>{signed(e.delta)}</td>
                <td className="num" style={{ textAlign: "right" }}>{e.balance_after}</td></tr>))}</tbody></table></div>}
        </section>

        <div className="row">
          <RuleCard title={t("Earn points")} rows={earn} r={r} />
          <RuleCard title={t("Lose points")} rows={lose} r={r} />
        </div>

        {d.pause.pending ? (
          <section className="ok">{t("Your {days}-day pause request ({start} to {end}) is waiting for approval.", { days: d.pause.pending.days, start: fmtDate(d.pause.pending.start_date), end: fmtDate(d.pause.pending.end_date) })}</section>
        ) : d.pause.active ? (
          <section className="ok">{t("You're on an approved pause until {date}. Deductions are frozen.", { date: fmtDate(d.pause.until) })}</section>
        ) : (
          <section style={{ background: "var(--navy)", color: "#fff", borderRadius: 16, padding: 28, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: "#1C2C44", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", color: "#CFE2FF" }}><IPause size={26} /></div>
            <div style={{ flex: "1 1 380px" }} className="stack">
              <h2 style={{ fontSize: 20, fontWeight: 800 }}>{d.pause.available ? t("Need a break? You have {available} pause available.", { available: d.pause.available }) : t("You've used your pause for this program cycle.")}</h2>
              <p style={{ color: "#CFE2FF", fontSize: 14 }}>{t("Up to {days} days for a medical situation, family emergency or approved travel. Deductions freeze, your guarantee status is frozen, and your deadline moves out by {x}× the days you pause.", { days: d.pause.max_days, x: d.pause.multiplier })}</p>
            </div>
            {d.pause.available > 0 && <button className="btn bw" onClick={() => setPausing(true)}>{t("Request a pause")}</button>}
          </section>)}
      </div>
      {pausing && <PauseModal max={d.pause.max_days} mult={d.pause.multiplier} onClose={() => setPausing(false)}
        onDone={() => { setPausing(false); toast(t("Pause requested. Your advisor will review it.")); dash.reload(); refresh(); }} />}
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
  return <Modal title={t("Request a pause")} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <p className="cap" style={{ fontSize: 14 }}>{t("One pause per program cycle, up to {max} days. Your advisor approves it.", { max })}</p>
      <div className="grid" style={{ gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <div><label className="lb" htmlFor="ps">{t("From")}</label><input className="in" id="ps" type="date" min={todayISO()} required value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></div>
        <div><label className="lb" htmlFor="pe">{t("To")}</label><input className="in" id="pe" type="date" min={f.start_date} required value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></div>
      </div>
      <div><label className="lb" htmlFor="pr">{t("Reason")}</label><select className="in" id="pr" value={f.reason_type} onChange={(e) => setF({ ...f, reason_type: e.target.value })}>
        <option value="medical">{t("Medical situation")}</option><option value="family">{t("Family emergency")}</option><option value="travel">{t("Pre-approved travel")}</option><option value="other">{t("Other")}</option></select></div>
      <div><label className="lb" htmlFor="pd">{t("Details for your advisor")}</label><textarea className="in" id="pd" style={{ minHeight: 80 }} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
      {days > 0 && <div className={days > max ? "err" : "ok"}>{days > max ? t("That's {days} days. The maximum is {max}.", { days: days, max: max }) : t("{days} days. Your deadline would move out by {v1} days.", { days: days, v1: Math.ceil(days * mult) })}</div>}
      <ErrorBox error={err} />
      <button className="btn bp" disabled={!days || days > max}>{t("Send request")}</button>
    </form></Modal>;
}
