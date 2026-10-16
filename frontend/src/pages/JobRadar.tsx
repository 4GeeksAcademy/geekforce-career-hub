import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { relTime, stageLabel, statusLabel } from "../lib/format";
import { ErrorBox, Modal, Spinner, useToast } from "../components/ui";
import { IPlus } from "../components/Icons";

type Job = { id: string; source: string; title: string; company: string | null; location: string | null; work_mode: string | null;
  url: string | null; program: string | null; posted_at: string | null; found_at: string; salary_min: number | null; salary_max: number | null;
  contact_name: string | null; contact_handle: string | null; outreach_status: string; is_partner: boolean; notes: string | null;
  shared_count: number; description: string | null; fits: number };
type List = { items: Job[]; sources: Record<string, number>; programs: Record<string, string>; adzuna_connected: boolean; ingest_ready: boolean };
type Fit = { id: string; name: string; initials: string; cohort: string | null; points: number; guarantee_status: string; stage: string | null; mine: boolean };

const SOURCE: Record<string, string> = { adzuna: "Adzuna", grokbot: "grokbot · X", partner: "Partner", manual: "Added by team", x: "X" };
const OUTREACH: Record<string, string> = { none: "Not contacted", contacted: "Contacted", replied: "Replied", interviewing: "Interviewing", closed: "Closed" };
const PROG_DOT: Record<string, string> = { full_stack: "#2381FF", ai_engineering: "#0E1B2C", data_science: "#F5B93E", cybersecurity: "#E5484D" };

export default function JobRadar() {
  const { user } = useAuth();
  const [program, setProgram] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [days, setDays] = useState("7");
  const params = new URLSearchParams({ days, ...(program && { program }), ...(source && { source }), ...(q && { q }) });
  const list = useApi<List>(`/advisor/jobs?${params}`);
  const [picked, setPicked] = useState<Job | null>(null);
  const [adding, setAdding] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const toast = useToast();

  const sweep = async () => {
    setSweeping(true);
    try { const r = await api.post<{ created?: number; found?: number; error?: string }>("/admin/jobs/job_radar");
      toast(r.error ? r.error : `Sweep done · ${r.found ?? 0} found · ${r.created ?? 0} new`); list.reload(); }
    catch { toast("The sweep failed. Try again in a minute."); } finally { setSweeping(false); }
  };
  const setOutreach = async (j: Job, v: string) => { await api.patch(`/advisor/jobs/${j.id}`, { outreach_status: v }); list.reload(); };

  const d = list.data;
  const total = d?.items.length ?? 0;
  const partners = d?.items.filter((j) => j.is_partner).length ?? 0;
  const fitsTotal = d?.items.reduce((a, j) => a + (j.fits > 0 ? 1 : 0), 0) ?? 0;

  return (
    <>
      <header className="top">
        <div><div className="kick">Opportunities</div><h1>Job <em>Radar.</em></h1>
          <div className="sub">Open jobs from Adzuna, grokbot and partners, matched to your students by program.</div></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn bg" onClick={() => setAdding(true)}><IPlus size={18} />Add a job</button>
          {user?.role === "admin" && <button className="btn bp" disabled={sweeping || !d?.adzuna_connected} onClick={sweep}>{sweeping ? "Sweeping…" : "Run sweep now"}</button>}
        </div>
      </header>
      <div className="content">
        <section className="hero">
          <div style={{ flex: "1 1 360px" }}>
            <span className="chipy">DAILY SWEEP · 10:00 AM ET</span>
            <h2>{total} open {total === 1 ? "job" : "jobs"} in the last {days} days. <em>{fitsTotal} have students who fit.</em></h2>
            <p>{partners} from partner companies · {Object.entries(d?.sources || {}).map(([k, v]) => `${SOURCE[k] || k} ${v}`).join(" · ") || "No jobs yet"}</p>
          </div>
        </section>
        {d && (!d.adzuna_connected || !d.ingest_ready) && <div className="strip"><b>Setup:</b>
          <span>{!d.adzuna_connected && "Adzuna keys are missing in Railway. "}{!d.ingest_ready && "grokbot's inbox needs JOBS_INGEST_SECRET in Railway."}</span></div>}

        <section className="stack" style={{ gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={`chip${program === "" ? " on" : ""}`} onClick={() => setProgram("")}>All programs</button>
            {Object.entries(d?.programs || {}).map(([k, v]) => <button key={k} className={`chip${program === k ? " on" : ""}`} onClick={() => setProgram(k)}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: PROG_DOT[k], display: "inline-block", marginRight: 6 }} />{v}</button>)}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label><span className="sr">Source</span><select className="in" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">All sources</option>{Object.entries(SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label><span className="sr">Period</span><select className="in" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option></select></label>
            <label style={{ flex: "1 1 240px" }}><span className="sr">Search</span><input className="in" type="search" placeholder="Title, company or city" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          </div>
        </section>

        {list.loading ? <Spinner /> : <ErrorBox error={list.error} />}
        {d && d.items.length === 0 && <div className="card empty">No jobs here yet. The sweep runs every morning at 10:00 AM ET, and grokbot sends jobs as it finds them.</div>}
        <div className="stack" style={{ gap: 12 }}>
          {d?.items.map((j) => (
            <article key={j.id} className="card" style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap", padding: 20 }}>
              <div className="av soft" style={{ width: 44, height: 44, borderRadius: 12 }}>{(j.company || j.title).slice(0, 2).toUpperCase()}</div>
              <div style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {j.url ? <a href={j.url} target="_blank" rel="noreferrer" style={{ fontWeight: 800, fontSize: 16, color: "var(--ink)" }}>{j.title}</a> : <strong style={{ fontSize: 16 }}>{j.title}</strong>}
                  {j.is_partner && <span className="pill pn">Hiring partner</span>}
                </div>
                <div className="cap">{[j.company, j.location, j.work_mode && !(j.location || "").toLowerCase().includes(j.work_mode) ? j.work_mode : null].filter(Boolean).join(" · ")}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span className="pill pb">{SOURCE[j.source] || j.source}</span>
                  {j.program && <span className="pill pg">{d.programs[j.program]}</span>}
                  <span className="pill pg">{j.posted_at ? `Posted ${relTime(j.posted_at)}` : `Found ${relTime(j.found_at)}`}</span>
                  {j.salary_min && <span className="pill pg">${Math.round(j.salary_min / 1000)}k{j.salary_max && j.salary_max !== j.salary_min ? `–${Math.round(j.salary_max / 1000)}k` : ""}</span>}
                  {j.shared_count > 0 && <span className="pill pa">Shared with {j.shared_count}</span>}
                </div>
                {(j.contact_name || j.contact_handle) && <div className="cap">Contact: {[j.contact_name, j.contact_handle].filter(Boolean).join(" · ")}</div>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", flex: "0 0 auto" }}>
                <label><span className="sr">Outreach</span><select className="in" style={{ minHeight: 38 }} value={j.outreach_status} onChange={(e) => setOutreach(j, e.target.value)}>
                  {Object.entries(OUTREACH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <button className="btn bp sm" disabled={!j.fits} onClick={() => setPicked(j)}>{j.fits ? `Who fits (${j.fits})` : "No students fit yet"}</button>
              </div>
            </article>))}
        </div>
      </div>
      {picked && <WhoFits job={picked} onClose={() => setPicked(null)} onDone={(m) => { setPicked(null); toast(m); list.reload(); }} />}
      {adding && <AddJob programs={d?.programs || {}} onClose={() => setAdding(false)} onDone={() => { setAdding(false); toast("Job added"); list.reload(); }} />}
    </>);
}

function WhoFits({ job, onClose, onDone }: { job: Job; onClose: () => void; onDone: (m: string) => void }) {
  const fits = useApi<{ students: Fit[] }>(`/advisor/jobs/${job.id}/fits`);
  const [sel, setSel] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const share = async () => {
    setErr(null);
    try { const r = await api.post<{ shared: number }>(`/advisor/jobs/${job.id}/share`, { student_ids: sel, note: note || null });
      onDone(`Shared with ${r.shared} student${r.shared === 1 ? "" : "s"}`); } catch (e) { setErr(e); }
  };
  return <Modal title={`Who fits · ${job.title}`} onClose={onClose}>
    <p className="cap">Same program, actively job hunting, guarantee not suspended. Your students first.</p>
    {fits.loading && <Spinner />}
    <div className="stack" style={{ gap: 8 }}>
      {fits.data?.students.sort((a, b) => Number(b.mine) - Number(a.mine)).map((s) => {
        const on = sel.includes(s.id);
        return <label key={s.id} className="hw" style={on ? { borderColor: "var(--blue-line)", background: "#F7FAFF" } : undefined}>
          <input type="checkbox" checked={on} onChange={() => setSel(on ? sel.filter((x) => x !== s.id) : [...sel, s.id])} />
          <span className="av soft" style={{ width: 32, height: 32, fontSize: 12 }}>{s.initials}</span>
          <span style={{ flex: 1 }}><strong>{s.name}</strong><span className="cap" style={{ display: "block" }}>{[s.cohort, s.stage ? stageLabel[s.stage] : null].filter(Boolean).join(" · ")}</span></span>
          <span className="pill pg">{s.points} · {statusLabel[s.guarantee_status] || s.guarantee_status}</span>
        </label>;
      })}
      {fits.data?.students.length === 0 && <div className="empty">No students match this job right now.</div>}
    </div>
    <div><label className="lb" htmlFor="sn">Note to the students (optional)</label>
      <textarea className="in" id="sn" style={{ minHeight: 70 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Strong match for your React projects. Apply today." /></div>
    <ErrorBox error={err} />
    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
      <button className="btn bg" onClick={onClose}>Cancel</button>
      <button className="btn bp" disabled={!sel.length} onClick={share}>Share with {sel.length || ""} student{sel.length === 1 ? "" : "s"}</button></div>
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
  return <Modal title="Add a job" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div><label className="lb" htmlFor="jt">Job title</label><input className="in" id="jt" required value={f.title} onChange={(e) => set("title", e.target.value)} /></div>
      <div className="grid" style={{ gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <div><label className="lb" htmlFor="jc">Company</label><input className="in" id="jc" value={f.company} onChange={(e) => set("company", e.target.value)} /></div>
        <div><label className="lb" htmlFor="jl">Location</label><input className="in" id="jl" placeholder="Miami, FL · Remote" value={f.location} onChange={(e) => set("location", e.target.value)} /></div>
      </div>
      <div><label className="lb" htmlFor="ju">Link</label><input className="in" id="ju" type="url" placeholder="https://…" value={f.url} onChange={(e) => set("url", e.target.value)} /></div>
      <div><label className="lb" htmlFor="jp">Program</label><select className="in" id="jp" value={f.program} onChange={(e) => set("program", e.target.value)}>
        <option value="">Detect from the title</option>{Object.entries(programs).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="grid" style={{ gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <div><label className="lb" htmlFor="jn">Contact name</label><input className="in" id="jn" value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} /></div>
        <div><label className="lb" htmlFor="jh">Contact email or handle</label><input className="in" id="jh" value={f.contact_handle} onChange={(e) => set("contact_handle", e.target.value)} /></div>
      </div>
      <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={f.is_partner} onChange={(e) => set("is_partner", e.target.checked)} style={{ width: 18, height: 18 }} />This is a hiring partner</label>
      <ErrorBox error={err} />
      <button className="btn bp">Add job</button>
    </form></Modal>;
}

