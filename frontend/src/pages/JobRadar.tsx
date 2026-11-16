import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { t } from "../lib/i18n";
import { RadarTabs } from "./JobTracking";
import { ShareDetail } from "../components/JobShares";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { relTime, stageLabel, statusLabel } from "../lib/format";
import { ErrorBox, Modal, Spinner, useToast } from "../components/ui";
import { IPlus } from "../components/Icons";

type Job = { id: string; source: string; title: string; company: string | null; location: string | null; work_mode: string | null;
  url: string | null; program: string | null; posted_at: string | null; found_at: string; salary_min: number | null; salary_max: number | null;
  contact_name: string | null; contact_handle: string | null; outreach_status: string; is_partner: boolean; notes: string | null;
  shared_count: number; description: string | null; fits: number; country: string | null };
type List = { items: Job[]; sources: Record<string, number>; countries: Record<string, number>; programs: Record<string, string>; adzuna_connected: boolean; ingest_ready: boolean };
type Fit = { id: string; name: string; initials: string; cohort: string | null; points: number; guarantee_status: string; stage: string | null; mine: boolean };

const SOURCE: Record<string, string> = { adzuna: t("Adzuna"), grokbot: "grokbot · X", partner: t("Partner"), manual: t("Added by team"), x: "X", n8n: "n8n" };
const COUNTRY: Record<string, string> = { US: t("United States"), ES: t("Spain"), MX: t("Mexico"), CO: t("Colombia"), VE: t("Venezuela"),
  AR: t("Argentina"), CL: t("Chile"), PE: t("Peru"), UY: t("Uruguay"), CR: t("Costa Rica"), EC: t("Ecuador"), PA: t("Panama"), DO: t("Dominican Republic") };
const OUTREACH: Record<string, string> = { none: t("Not contacted"), contacted: t("Contacted"), replied: t("Replied"), interviewing: t("Interviewing"), closed: t("Closed") };
const PROG_DOT: Record<string, string> = { full_stack: "#2381FF", ai_engineering: "#0E1B2C", data_science: "#F5B93E", cybersecurity: "#E5484D" };

export default function JobRadar() {
  const { user } = useAuth();
  const [program, setProgram] = useState("");
  const [source, setSource] = useState("");
  const [country, setCountry] = useState("");
  const [q, setQ] = useState("");
  const [days, setDays] = useState("7");
  const params = new URLSearchParams({ days, ...(program && { program }), ...(source && { source }), ...(country && { country }), ...(q && { q }) });
  const list = useApi<List>(`/advisor/jobs?${params}`);
  const [picked, setPicked] = useState<{ job: Job; tab?: "shared" } | null>(null);
  const [adding, setAdding] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const toast = useToast();

  const sweep = async () => {
    setSweeping(true);
    try { const r = await api.post<{ created?: number; found?: number; error?: string }>("/admin/jobs/job_radar");
      toast(r.error ? r.error : t("Sweep done · {v0} found · {v1} new", { v0: r.found ?? 0, v1: r.created ?? 0 })); list.reload(); }
    catch { toast(t("The sweep failed. Try again in a minute.")); } finally { setSweeping(false); }
  };
  const setOutreach = async (j: Job, v: string) => { await api.patch(`/advisor/jobs/${j.id}`, { outreach_status: v }); list.reload(); };

  const d = list.data;
  const total = d?.items.length ?? 0;
  const partners = d?.items.filter((j) => j.is_partner).length ?? 0;
  const fitsTotal = d?.items.reduce((a, j) => a + (j.fits > 0 ? 1 : 0), 0) ?? 0;

  return (
    <>
      <header className="top">
        <div><div className="kick">{t("Opportunities")}</div><h1>{t("Job")} <em>{t("Radar.")}</em></h1>
          <div className="sub">{t("Open jobs from Adzuna, grokbot and partners, matched to your students by program.")}</div></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn bg" onClick={() => setAdding(true)}><IPlus size={18} />{t("Add a job")}</button>
          {user?.role === "admin" && <button className="btn bp" disabled={sweeping || !d?.adzuna_connected} onClick={sweep}>{sweeping ? t("Sweeping…") : t("Run sweep now")}</button>}
        </div>
      </header>
      <div className="content">
        <RadarTabs on="jobs" />
        <section className="hero">
          <div style={{ flex: "1 1 360px" }}>
            <span className="chipy">{t("DAILY SWEEP · 10:00 AM ET")}</span>
            <h2>{t("{n} open job(s) in the last {days} days.", { n: total, days })} <em>{t("{n} have students who fit.", { n: fitsTotal })}</em></h2>
            <p>{partners} {t("from partner companies ·")} {Object.entries(d?.sources || {}).map(([k, v]) => `${SOURCE[k] || k} ${v}`).join(" · ") || t("No jobs yet")}</p>
          </div>
        </section>
        {d && (!d.adzuna_connected || !d.ingest_ready) && <div className="strip"><b>{t("Setup:")}</b>
          <span>{!d.adzuna_connected && t("Adzuna keys are missing in Railway. ")}{!d.ingest_ready && t("grokbot's inbox needs JOBS_INGEST_SECRET in Railway.")}</span></div>}

        <section className="stack" style={{ gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={`chip${program === "" ? " on" : ""}`} onClick={() => setProgram("")}>{t("All programs")}</button>
            {Object.entries(d?.programs || {}).map(([k, v]) => <button key={k} className={`chip${program === k ? " on" : ""}`} onClick={() => setProgram(k)}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: PROG_DOT[k], display: "inline-block", marginRight: 6 }} />{v}</button>)}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label><span className="sr">{t("Source")}</span><select className="in" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">{t("All sources")}</option>{Object.entries(SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label><span className="sr">{t("Country")}</span><select className="in" value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="">{t("All countries")}</option>{Object.entries(d?.countries || {}).map(([k, n]) => <option key={k} value={k}>{COUNTRY[k] || k} ({n})</option>)}</select></label>
            <label><span className="sr">{t("Period")}</span><select className="in" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="1">{t("Last 24 hours")}</option><option value="7">{t("Last 7 days")}</option><option value="14">{t("Last 14 days")}</option><option value="30">{t("Last 30 days")}</option></select></label>
            <label style={{ flex: "1 1 240px" }}><span className="sr">{t("Search")}</span><input className="in" type="search" placeholder={t("Title, company or city")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
          </div>
        </section>

        {list.loading ? <Spinner /> : <ErrorBox error={list.error} />}
        {d && d.items.length === 0 && <div className="card empty">{t("No jobs here yet. The sweep runs every morning at 10:00 AM ET, and grokbot sends jobs as it finds them.")}</div>}
        <div className="stack" style={{ gap: 12 }}>
          {d?.items.map((j) => (
            <article key={j.id} className="card" style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap", padding: 20 }}>
              <div className="av soft" style={{ width: 44, height: 44, borderRadius: 12 }}>{(j.company || j.title).slice(0, 2).toUpperCase()}</div>
              <div style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {j.url ? <a href={j.url} target="_blank" rel="noreferrer" style={{ fontWeight: 800, fontSize: 16, color: "var(--ink)" }}>{j.title}</a> : <strong style={{ fontSize: 16 }}>{j.title}</strong>}
                  {j.is_partner && <span className="pill pn">{t("Hiring partner")}</span>}
                </div>
                <div className="cap">{[j.company, j.location, j.work_mode && !(j.location || "").toLowerCase().includes(j.work_mode) ? j.work_mode : null].filter(Boolean).join(" · ")}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span className="pill pb">{SOURCE[j.source] || j.source}</span>
                  {j.program && <span className="pill pg">{d.programs[j.program]}</span>}
                  {j.country && <span className="pill pg">{COUNTRY[j.country] || j.country}</span>}
                  <span className="pill pg">{j.posted_at ? t("Posted {v0}", { v0: relTime(j.posted_at) }) : t("Found {v0}", { v0: relTime(j.found_at) })}</span>
                  {j.salary_min && <span className="pill pg">${Math.round(j.salary_min / 1000)}k{j.salary_max && j.salary_max !== j.salary_min ? `–${Math.round(j.salary_max / 1000)}k` : ""}</span>}
                  {j.shared_count > 0 && <button className="pill pa" style={{ border: "none", cursor: "pointer" }} onClick={() => setPicked({ job: j, tab: "shared" })}>{t("Shared with {n} · see responses", { n: j.shared_count })}</button>}
                </div>
                {(j.contact_name || j.contact_handle) && <div className="cap">{t("Contact:")} {[j.contact_name, j.contact_handle].filter(Boolean).join(" · ")}</div>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", flex: "0 0 auto" }}>
                <label><span className="sr">{t("Outreach")}</span><select className="in" style={{ minHeight: 38 }} value={j.outreach_status} onChange={(e) => setOutreach(j, e.target.value)}>
                  {Object.entries(OUTREACH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <button className="btn bp sm" onClick={() => setPicked({ job: j })}>{j.fits ? t("Share · {n} fit", { n: j.fits }) : t("Share with students")}</button>
              </div>
            </article>))}
        </div>
      </div>
      {picked && <ShareJob job={picked.job} startTab={picked.tab} programs={d?.programs || {}} onClose={() => setPicked(null)} onDone={(m) => { setPicked(null); toast(m); list.reload(); }} />}
      {adding && <AddJob programs={d?.programs || {}} onClose={() => setAdding(false)} onDone={() => { setAdding(false); toast(t("Job added")); list.reload(); }} />}
    </>);
}

type Row = { id: string; name: string; initials: string; cohort: string | null; status: string; display_stage: string | null; program: string | null };
type Share = { id: string; student_id: string; name: string; cohort: string | null; status: string; response_note: string | null; seen: boolean; shared_at: string };
const SHARE_STATUS: Record<string, [string, string]> = { new: [t("Not answered"), "pg"], interested: [t("Interested"), "pb"], applied: [t("Applied"), "pn"], not_a_fit: [t("Not a fit"), "pr"] };

/** Share a job in the app: suggested students, hand-picked students, or a whole group. */
function ShareJob({ job, programs, startTab, onClose, onDone }: { job: Job; programs: Record<string, string>; startTab?: "fits" | "pick" | "group" | "shared";
  onClose: () => void; onDone: (m: string) => void }) {
  const [tab, setTab] = useState<"fits" | "pick" | "group" | "shared">(startTab || (job.fits ? "fits" : "pick"));
  const fits = useApi<{ students: Fit[] }>(`/advisor/jobs/${job.id}/fits`);
  const all = useApi<{ items: Row[]; cohorts: { id: string; name: string }[] }>("/advisor/students?status=active");
  const shares = useApi<Share[]>(`/advisor/jobs/${job.id}/shares`);
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [cohortF, setCohortF] = useState("");
  const [group, setGroup] = useState({ cohort_id: "", program: job.program || "", stage: "" });
  const [preview, setPreview] = useState<{ would_share: number; already: number } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const done = new Set((shares.data || []).map((s) => s.student_id));
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);

  const groupBody = { cohort_id: group.cohort_id || null, program: group.program || null, stage: group.stage || null };
  const hasGroup = !!(group.cohort_id || group.program || group.stage);
  useEffect(() => {
    if (tab !== "group" || !hasGroup) { setPreview(null); return; }
    api.post<{ would_share: number; already: number }>(`/advisor/jobs/${job.id}/share?dry_run=true`, groupBody).then(setPreview).catch(() => setPreview(null));
  }, [tab, group.cohort_id, group.program, group.stage]); // eslint-disable-line

  const share = async () => {
    setBusy(true); setErr(null);
    try {
      const body = tab === "group" ? { ...groupBody, note: note || null } : { student_ids: sel, note: note || null };
      const r = await api.post<{ shared: number; already: number }>(`/advisor/jobs/${job.id}/share`, body);
      onDone(r.shared ? t("Shared with {n} student(s). They'll see it in Jobs for you.", { n: r.shared }) : t("Everyone selected already had this job."));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const count = tab === "group" ? preview?.would_share || 0 : sel.length;
  const rows = (all.data?.items || []).filter((r) => r.status === "active" && (!q || r.name.toLowerCase().includes(q.toLowerCase())) && (!cohortF || r.cohort === cohortF));

  const Person = ({ id, name, initials, sub, right }: { id: string; name: string; initials: string; sub: string; right?: React.ReactNode }) => {
    const on = sel.includes(id), had = done.has(id);
    return <label className="hw" style={{ ...(on ? { borderColor: "var(--blue-line)", background: "#F7FAFF" } : {}), opacity: had ? 0.6 : 1, cursor: had ? "default" : "pointer" }}>
      <input type="checkbox" disabled={had} checked={on || had} onChange={() => toggle(id)} />
      <span className="av soft" style={{ width: 32, height: 32, fontSize: 12 }}>{initials}</span>
      <span style={{ flex: 1, minWidth: 0 }}><strong>{name}</strong><span className="cap" style={{ display: "block" }}>{sub}</span></span>
      {had ? <span className="pill pg">{t("Already shared")}</span> : right}
    </label>;
  };

  return <Modal title={t("Share · {title}", { title: job.title })} onClose={onClose}>
    <div className="tabs" role="tablist">
      {([["fits", t("Suggested ({n})", { n: job.fits })], ["pick", t("Pick students")], ["group", t("A group")], ["shared", t("Shared ({n})", { n: shares.data?.length ?? job.shared_count })]] as const).map(([k, l]) =>
        <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}
    </div>

    {tab === "fits" && <div className="stack" style={{ gap: 8, maxHeight: "42vh", overflow: "auto" }}>
      <p className="cap">{t("Same program, actively job hunting, guarantee not suspended. Your students first.")}</p>
      {fits.loading && <Spinner />}
      {fits.data?.students.sort((a, b) => Number(b.mine) - Number(a.mine)).map((s) =>
        <Person key={s.id} id={s.id} name={s.name} initials={s.initials} sub={[s.cohort, s.stage ? stageLabel[s.stage] : null].filter(Boolean).join(" · ")}
          right={<span className="pill pg">{s.points} · {statusLabel[s.guarantee_status] || s.guarantee_status}</span>} />)}
      {fits.data?.students.length === 0 && <div className="empty">{t("No suggested students for this job. Pick students or a group instead.")}</div>}
    </div>}

    {tab === "pick" && <div className="stack" style={{ gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="in" style={{ flex: "1 1 180px" }} aria-label={t("Search students")} placeholder={t("Search students")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="in" style={{ flex: "0 1 200px" }} aria-label={t("Cohort")} value={cohortF} onChange={(e) => setCohortF(e.target.value)}>
          <option value="">{t("All cohorts")}</option>{all.data?.cohorts.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
        <button className="btn bg sm" onClick={() => setSel(Array.from(new Set([...sel, ...rows.filter((r) => !done.has(r.id)).map((r) => r.id)])))}>{t("Select all shown")}</button>
      </div>
      <div className="stack" style={{ gap: 8, maxHeight: "38vh", overflow: "auto" }}>
        {all.loading && <Spinner />}
        {rows.map((r) => <Person key={r.id} id={r.id} name={r.name} initials={r.initials} sub={[r.cohort, stageLabel[r.display_stage || "not_started"]].filter(Boolean).join(" · ")} />)}
        {!all.loading && rows.length === 0 && <div className="empty">{t("No active students match.")}</div>}
      </div>
    </div>}

    {tab === "group" && <div className="stack" style={{ gap: 10 }}>
      <p className="cap">{t("Everyone active who matches all the filters you choose. Good for sharing with a whole cohort or everyone in Stage 3.")}</p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
        <div><label className="lb" htmlFor="gc">{t("Cohort")}</label><select id="gc" className="in" value={group.cohort_id} onChange={(e) => setGroup({ ...group, cohort_id: e.target.value })}>
          <option value="">{t("Any cohort")}</option>{all.data?.cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="lb" htmlFor="gp">{t("Program")}</label><select id="gp" className="in" value={group.program} onChange={(e) => setGroup({ ...group, program: e.target.value })}>
          <option value="">{t("Any program")}</option>{Object.entries(programs).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></div>
        <div><label className="lb" htmlFor="gs">{t("Stage")}</label><select id="gs" className="in" value={group.stage} onChange={(e) => setGroup({ ...group, stage: e.target.value })}>
          <option value="">{t("Any stage")}</option>{["not_started", "profile", "interview_prep", "job_hunting"].map((k) => <option key={k} value={k}>{stageLabel[k]}</option>)}</select></div>
      </div>
      {hasGroup && preview && <div className="strip" style={{ background: "var(--blue-tint)" }}><b>{t("{n} student(s)", { n: preview.would_share })}</b>
        <span>{preview.already ? t("will get it ({n} already have it).", { n: preview.already }) : t("will get it.")}</span></div>}
    </div>}

    {tab === "shared" && <div className="stack" style={{ gap: 8, maxHeight: "48vh", overflow: "auto" }}>
      {shares.loading && <Spinner />}
      {shares.data?.length === 0 && <div className="empty">{t("Not shared with anyone yet.")}</div>}
      {shares.data && shares.data.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {Object.entries(SHARE_STATUS).map(([k, [l, c]]) => { const n = shares.data!.filter((s) => s.status === k).length; return n ? <span key={k} className={`pill ${c}`}>{t(l)} · {n}</span> : null; })}</div>}
      {shares.data?.map((s) => <div key={s.id} className="hw" role="button" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => setDetail(s.id)}
        onKeyDown={(e) => e.key === "Enter" && setDetail(s.id)}>
        <span style={{ flex: 1, minWidth: 0 }}><strong>{s.name}</strong>
          <span className="cap" style={{ display: "block" }}>{[s.cohort, t("shared {when}", { when: relTime(s.shared_at) }), s.seen ? t("seen") : t("not opened yet")].filter(Boolean).join(" · ")}</span>
          {s.response_note && <span className="cap" style={{ display: "block", fontStyle: "italic" }}>“{s.response_note}”</span>}</span>
        <span className={`pill ${SHARE_STATUS[s.status]?.[1] || "pg"}`}>{t(SHARE_STATUS[s.status]?.[0] || s.status)}</span></div>)}
    </div>}

    {tab === "shared" && shares.data && shares.data.length > 0 && <Link className="btn bg sm" style={{ alignSelf: "flex-start" }} to={`/staff/jobs/shared?job=${job.id}`} onClick={onClose}>{t("Open full tracking")}</Link>}
    {detail && <ShareDetail shareId={detail} staff onClose={() => setDetail(null)} onChanged={shares.reload} />}
    {tab !== "shared" && <>
      <div><label className="lb" htmlFor="sn">{t("Note to the students (optional)")}</label>
        <textarea className="in" id="sn" style={{ minHeight: 70 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. Strong match for your React projects. Apply this week.")} /></div>
      <p className="cap" style={{ fontSize: 13 }}>{t("Students see the job in Jobs for you and get a notification. They can mark it Interested, Applied (logged in their tracker with points) or Not a fit.")}</p>
      <ErrorBox error={err} />
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button className="btn bg" onClick={onClose}>{t("Cancel")}</button>
        <button className="btn bp" disabled={!count || busy} onClick={share}>{busy ? t("Sharing…") : t("Share with {n} student(s)", { n: count || "" })}</button></div>
    </>}
  </Modal>;
}

function AddJob({ programs, onClose, onDone }: { programs: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: "", company: "", location: "", url: "", program: "", is_partner: false, contact_name: "", contact_handle: "" });
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await api.post("/advisor/jobs", { ...f, program: f.program || null }); onDone(); } catch (e) { setErr(e); }
  };
  const set = (k: string, v: string | boolean) => setF({ ...f, [k]: v });
  return <Modal title={t("Add a job")} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div><label className="lb" htmlFor="jt">{t("Job title")}</label><input className="in" id="jt" required value={f.title} onChange={(e) => set("title", e.target.value)} /></div>
      <div className="grid" style={{ gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <div><label className="lb" htmlFor="jc">{t("Company")}</label><input className="in" id="jc" value={f.company} onChange={(e) => set("company", e.target.value)} /></div>
        <div><label className="lb" htmlFor="jl">{t("Location")}</label><input className="in" id="jl" placeholder={t("Miami, FL · Remote")} value={f.location} onChange={(e) => set("location", e.target.value)} /></div>
      </div>
      <div><label className="lb" htmlFor="ju">{t("Link")}</label><input className="in" id="ju" type="url" placeholder="https://…" value={f.url} onChange={(e) => set("url", e.target.value)} /></div>
      <div><label className="lb" htmlFor="jp">{t("Program")}</label><select className="in" id="jp" value={f.program} onChange={(e) => set("program", e.target.value)}>
        <option value="">{t("Detect from the title")}</option>{Object.entries(programs).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="grid" style={{ gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <div><label className="lb" htmlFor="jn">{t("Contact name")}</label><input className="in" id="jn" value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} /></div>
        <div><label className="lb" htmlFor="jh">{t("Contact email or handle")}</label><input className="in" id="jh" value={f.contact_handle} onChange={(e) => set("contact_handle", e.target.value)} /></div>
      </div>
      <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={f.is_partner} onChange={(e) => set("is_partner", e.target.checked)} style={{ width: 18, height: 18 }} />{t("This is a hiring partner")}</label>
      <ErrorBox error={err} />
      <button className="btn bp">{t("Add job")}</button>
    </form></Modal>;
}

