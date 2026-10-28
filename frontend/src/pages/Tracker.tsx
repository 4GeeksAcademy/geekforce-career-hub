import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/useApi";
import type { Activity, AppItem } from "../lib/types";
import { appStatus, fmtDate, sourceLabel, todayISO } from "../lib/format";
import { Bar, ErrorBox, Modal, Spinner, useToast } from "../components/ui";
import { IPlug, IPlus } from "../components/Icons";
import { t } from "../lib/i18n";

type Apps = { items: AppItem[]; counts: Record<string, number>; total: number; this_week: number; target: number };
type Acts = { items: Activity[]; counts: Record<string, number>;
  week: { outreach: number; outreach_cap: number; linkedin: number; linkedin_cap: number } };
type Tab = "applications" | "outreach" | "linkedin" | "networking";

const FILTERS: [string, string][] = [["", t("All")], ["applied", t("Applied")], ["phone_screen,technical,final", t("Interviewing")], ["offer", t("Offer")], ["rejected,withdrawn", t("Closed")]];

export default function Tracker() {
  const loc = useLocation();
  const [tab, setTab] = useState<Tab>("applications");
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const apps = useApi<Apps>(`/students/me/applications?${new URLSearchParams({ ...(filter && { status: filter }), ...(q && { q }) })}`);
  const acts = useApi<Acts>("/students/me/activities");
  const { refresh } = useAuth();
  const toast = useToast();

  useEffect(() => {
    if (loc.hash === "#outreach") setTab("outreach");
    if (loc.hash === "#linkedin") setTab("linkedin");
  }, [loc.hash]);

  const reloadAll = () => { apps.reload(); acts.reload(); refresh(); };
  const setStatus = async (a: AppItem, status: string) => {
    await api.patch(`/applications/${a.id}`, { status });
    apps.reload();
  };

  const counts = apps.data?.counts || {};
  const stage = (keys: string[]) => keys.reduce((s, k) => s + (counts[k] || 0), 0);
  const total = apps.data?.total || 0;
  const wk = apps.data?.this_week || 0, target = apps.data?.target || 15;

  return (
    <>
      <header className="top">
        <div><h1>{t("Job Tracker")}</h1><div className="sub">{t("Every application, outreach message and post in one place. Points are added automatically.")}</div></div>
        <button className="btn bp" onClick={() => setAdding(true)}><IPlus size={18} />{t("Add application")}</button>
      </header>
      <div className="content">
        <div className="card row" style={{ padding: "20px 24px", alignItems: "center", gap: 24 }}>
          <div style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="between"><span style={{ fontWeight: 800 }}>{t("This week: {n} of {total} applications", { n: wk, total: target })}</span><span className="cap">{t("Closes Sunday 11:59 PM")}</span></div>
            <Bar value={wk} max={target} color={wk >= target ? "var(--blue)" : "var(--amber)"} />
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", background: "var(--blue-tint)", borderRadius: 12, padding: "10px 14px", flex: "1 1 320px", color: "#0F3F85", fontSize: 14 }}>
            <IPlug /><span><strong>{t("Use the GeekForce extension.")}</strong> {t("Applications on LinkedIn, Indeed, Glassdoor and Greenhouse log themselves.")}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Stage n={total} label={t("Applied")} />
          <Stage n={stage(["phone_screen", "technical", "final", "offer"])} label={t("Got a reply")} />
          <Stage n={stage(["technical", "final", "offer"])} label={t("Technical")} />
          <Stage n={stage(["final", "offer"])} label={t("Final round")} />
          <Stage n={counts.offer || 0} label={t("Offer")} hi />
        </div>

        <section className="card" style={{ padding: "0 0 8px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="tabs" role="tablist" style={{ padding: "0 16px" }}>
            {([["applications", t("Applications"), total], ["outreach", t("Recruiter outreach"), acts.data?.counts.outreach || 0],
              ["linkedin", t("LinkedIn posts"), acts.data?.counts.linkedin_post || 0], ["networking", t("Networking"), acts.data?.counts.networking || 0]] as [Tab, string, number][])
              .map(([k, l, n]) => <button key={k} className={`tab ${tab === k ? "on" : ""}`} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l} <span className="pill pg">{n}</span></button>)}
          </div>
          <div style={{ padding: "0 24px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
            {tab === "applications" && <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {FILTERS.map(([v, l]) => <button key={l} className={`chip ${filter === v ? "on" : ""}`} onClick={() => setFilter(v)}>{l}</button>)}
                <span style={{ flex: 1 }} />
                <label style={{ flex: "0 1 260px" }}><span className="sr">{t("Search applications")}</span><input className="in" type="search" placeholder={t("Search company or role")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
              </div>
              {apps.loading ? <Spinner /> : <ErrorBox error={apps.error} />}
              {apps.data && (apps.data.items.length === 0 ? <div className="empty">{t("No applications yet. Install the extension or add one manually.")}</div> :
                <div className="tw"><table>
                  <thead><tr><th>{t("Company")}</th><th>{t("Role")}</th><th>{t("Status")}</th><th>{t("Logged by")}</th><th>{t("Applied")}</th><th>{t("Follow-up")}</th></tr></thead>
                  <tbody>{apps.data.items.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 700 }}>{a.job_url ? <a href={a.job_url} target="_blank" rel="noreferrer" style={{ color: "var(--ink)" }}>{a.company}</a> : a.company}</td>
                      <td>{a.role}</td>
                      <td><label><span className="sr">{t("Status for")} {a.company}</span>
                        <select className="in" style={{ minHeight: 36, padding: "4px 8px", width: "auto", fontWeight: 700 }} value={a.status} onChange={(e) => setStatus(a, e.target.value)}>
                          {Object.entries(appStatus).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label></td>
                      <td className="cap" style={{ whiteSpace: "nowrap" }}>{sourceLabel(a.source)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(a.applied_at)}</td>
                      <td><label><span className="sr">{t("Follow-up date for")} {a.company}</span>
                        <input type="date" className="in" style={{ minHeight: 36, padding: "4px 8px", width: 150 }} value={a.followup_date || ""}
                          onChange={async (e) => { await api.patch(`/applications/${a.id}`, { followup_date: e.target.value || null }); apps.reload(); }} /></label></td>
                    </tr>))}</tbody></table></div>)}
            </>}
            {tab !== "applications" && acts.data && <ActivityList items={acts.data.items.filter((x) => x.kind === (tab === "linkedin" ? "linkedin_post" : tab))} />}
          </div>
        </section>

        <div className="row">
          <OutreachForm week={acts.data?.week} onDone={(m) => { toast(m); reloadAll(); }} />
          <LinkedinForm week={acts.data?.week} onDone={(m) => { toast(m); reloadAll(); }} />
          <NetworkingForm onDone={(m) => { toast(m); reloadAll(); }} />
        </div>
      </div>
      {adding && <AddApplication onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); toast(m); reloadAll(); }} />}
    </>);
}

function Stage({ n, label, hi }: { n: number; label: string; hi?: boolean }) {
  return <div className="stage" style={hi ? { background: "var(--blue-tint)", borderColor: "var(--blue-line)" } : undefined}>
    <span className="num" style={{ fontSize: 30, color: hi ? "var(--blue-deep)" : undefined }}>{n}</span><span className="cap">{label}</span></div>;
}

function ActivityList({ items }: { items: Activity[] }) {
  if (!items.length) return <div className="empty">{t("Nothing logged yet. Use the forms below.")}</div>;
  return <div className="tw"><table>
    <thead><tr><th>{t("Date")}</th><th>{t("Details")}</th><th>{t("Platform")}</th><th style={{ textAlign: "right" }}>{t("Points")}</th></tr></thead>
    <tbody>{items.map((a) => (
      <tr key={a.id}><td style={{ whiteSpace: "nowrap" }}>{fmtDate(a.occurred_on)}</td>
        <td>{a.kind === "linkedin_post" ? (a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.post_type === "original" ? t("Original post") : t("Repost with commentary")}</a> : a.post_type)
          : [a.contact_name, a.company, a.notes].filter(Boolean).join(" · ")}</td>
        <td className="cap">{a.platform || "—"}</td>
        <td className={`num ${a.points_awarded ? "pos" : ""}`} style={{ textAlign: "right" }}>{a.status === "rejected"
          ? <span className="pill pr" title={a.rejected_reason || ""}>{t("Rejected")}</span> : a.points_awarded ? `+${a.points_awarded}` : "cap reached"}</td></tr>))}</tbody></table></div>;
}

function useSubmit(onDone: (m: string) => void) {
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setErr(null);
    try { onDone(await fn()); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return { err, busy, run };
}

function AddApplication({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ company: "", role: "", job_url: "", notes: "" });
  const { err, busy, run } = useSubmit(onDone);
  const submit = (e: FormEvent) => { e.preventDefault(); run(async () => {
    const r = await api.post<{ created: boolean; points: number }>("/applications", { ...f, job_url: f.job_url || null, source: "manual" });
    return r.created ? `Application added · +3 points (now ${r.points})` : t("Already tracked: no duplicate points");
  }); };
  return <Modal title={t("Add application")} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div><label className="lb" htmlFor="c">{t("Company")}</label><input className="in" id="c" required value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></div>
      <div><label className="lb" htmlFor="r">{t("Role")}</label><input className="in" id="r" required value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} /></div>
      <div><label className="lb" htmlFor="u">{t("Job link (optional)")}</label><input className="in" id="u" type="url" value={f.job_url} onChange={(e) => setF({ ...f, job_url: e.target.value })} /></div>
      <div><label className="lb" htmlFor="n">{t("Notes (optional)")}</label><textarea className="in" id="n" style={{ minHeight: 80 }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <ErrorBox error={err} />
      <button className="btn bp" disabled={busy}>{t("Add application · +3")}</button>
    </form></Modal>;
}

function OutreachForm({ week, onDone }: { week?: Acts["week"]; onDone: (m: string) => void }) {
  const [f, setF] = useState({ contact_name: "", company: "", platform: t("LinkedIn message"), occurred_on: todayISO() });
  const { err, busy, run } = useSubmit(onDone);
  const submit = (e: FormEvent) => { e.preventDefault(); run(async () => {
    const r = await api.post<{ activity: Activity }>("/activities", { kind: "outreach", ...f });
    setF({ ...f, contact_name: "", company: "" });
    return r.activity.points_awarded ? `Outreach logged · +${r.activity.points_awarded}` : t("Outreach logged (weekly points cap reached)");
  }); };
  return <form id="outreach" className="card stack" style={{ flex: "1 1 340px" }} onSubmit={submit}>
    <div className="between"><h2 className="h2">{t("Log recruiter outreach")}</h2>{week && <span className="pill pb">+5 · {t("{n} of {total} this week", { n: week.outreach, total: week.outreach_cap })}</span>}</div>
    <div className="grid" style={{ gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
      <div><label className="lb" htmlFor="o1">{t("Contact name")}</label><input className="in" id="o1" required value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></div>
      <div><label className="lb" htmlFor="o2">{t("Company")}</label><input className="in" id="o2" required value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></div>
      <div><label className="lb" htmlFor="o3">{t("Platform")}</label><select className="in" id="o3" value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>
        <option>{t("LinkedIn message")}</option><option>{t("InMail")}</option><option>{t("Cold email")}</option><option>{t("Event follow-up")}</option></select></div>
      <div><label className="lb" htmlFor="o4">{t("Date")}</label><input className="in" id="o4" type="date" max={todayISO()} value={f.occurred_on} onChange={(e) => setF({ ...f, occurred_on: e.target.value })} /></div>
    </div>
    <div className="cap">{t("Your advisor spot-checks outreach in your 1:1. No outreach for 14 days costs −10.")}</div>
    <ErrorBox error={err} />
    <button className="btn bp" style={{ alignSelf: "flex-start" }} disabled={busy}>{t("Log outreach")}</button>
  </form>;
}

function LinkedinForm({ week, onDone }: { week?: Acts["week"]; onDone: (m: string) => void }) {
  const [f, setF] = useState({ url: "", post_type: "original", occurred_on: todayISO() });
  const { err, busy, run } = useSubmit(onDone);
  const submit = (e: FormEvent) => { e.preventDefault(); run(async () => {
    const r = await api.post<{ activity: Activity }>("/activities", { kind: "linkedin_post", platform: "LinkedIn", ...f });
    setF({ ...f, url: "" });
    return r.activity.points_awarded ? `Post logged · +${r.activity.points_awarded}` : t("Post logged (weekly points cap reached)");
  }); };
  return <form id="linkedin" className="card stack" style={{ flex: "1 1 340px" }} onSubmit={submit}>
    <div className="between"><h2 className="h2">{t("Log a LinkedIn post")}</h2>{week && <span className="pill pb">+5 · {t("{n} of {total} this week", { n: week.linkedin, total: week.linkedin_cap })}</span>}</div>
    <div><label className="lb" htmlFor="l1">{t("Post link")}</label><input className="in" id="l1" type="url" required placeholder="https://www.linkedin.com/posts/…" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></div>
    <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <legend className="lb">{t("What kind of post?")}</legend>
      <label style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 36 }}><input type="radio" name="pt" checked={f.post_type === "original"} onChange={() => setF({ ...f, post_type: "original" })} /> {t("Original post I wrote")} <span className="pill pa">{t("1 required each week")}</span></label>
      <label style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 36 }}><input type="radio" name="pt" checked={f.post_type === "commentary"} onChange={() => setF({ ...f, post_type: "commentary" })} /> {t("Repost or comment with my own commentary")}</label>
    </fieldset>
    <div className="cap">{t("Likes and reactions without commentary don't count.")}</div>
    <ErrorBox error={err} />
    <button className="btn bp" style={{ alignSelf: "flex-start" }} disabled={busy}>{t("Log post")}</button>
  </form>;
}

function NetworkingForm({ onDone }: { onDone: (m: string) => void }) {
  const [f, setF] = useState({ contact_name: "", company: "", notes: "", occurred_on: todayISO() });
  const { err, busy, run } = useSubmit(onDone);
  const submit = (e: FormEvent) => { e.preventDefault(); run(async () => {
    await api.post("/activities", { kind: "networking", platform: "Networking", ...f });
    setF({ ...f, contact_name: "", company: "", notes: "" });
    return t("Networking action logged · +2");
  }); };
  return <form className="card stack" style={{ flex: "1 1 340px" }} onSubmit={submit}>
    <div className="between"><h2 className="h2">{t("Log networking")}</h2><span className="pill pb">{t("+2 each")}</span></div>
    <div><label className="lb" htmlFor="n1">{t("What happened?")}</label><input className="in" id="n1" required placeholder={t("Coffee chat, referral, meetup…")} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
    <div className="grid" style={{ gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
      <div><label className="lb" htmlFor="n2">{t("With")}</label><input className="in" id="n2" value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></div>
      <div><label className="lb" htmlFor="n3">{t("Company")}</label><input className="in" id="n3" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></div>
    </div>
    <div className="cap">{t("Add enough detail for your advisor to verify it.")}</div>
    <ErrorBox error={err} />
    <button className="btn bp" style={{ alignSelf: "flex-start" }} disabled={busy}>{t("Log networking")}</button>
  </form>;
}
