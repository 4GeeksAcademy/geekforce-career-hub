import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { fmtDate, relTime } from "../lib/format";
import { useApi } from "../lib/useApi";
import { ErrorBox, Modal, Spinner, useToast } from "./ui";
import { ICheck, IDownload, IFile, ISpark, IX } from "./Icons";

// ── types ──
export type Link = { label: string; url: string };
export type RData = {
  basics: { name: string; headline: string; email: string; phone: string; location: string; links: Link[] };
  summary: string;
  skills: { group: string; items: string[] }[];
  experience: { title: string; company: string; location: string; start: string; end: string; bullets: string[] }[];
  projects: { name: string; link: string; tech: string; bullets: string[] }[];
  education: { school: string; degree: string; start: string; end: string; details: string }[];
  certifications: { name: string; issuer: string; date: string }[];
  languages: string[];
};
type Version = { id: string; kind: "master" | "tailored"; label: string; template: string; job_title: string | null; company: string | null;
  created_at: string; downloads: number; match_score: number | null; data?: RData };
type Comment = { id: string; section: string | null; body: string; resolved: boolean; author: string | null; created_at: string };
type AiState = { available: boolean; spent_usd: number; budget_usd: number; configured: boolean };
type State = { student: { id: string; name: string }; data: RData; template: string; templates: Record<string, string>;
  status: "draft" | "in_review" | "changes_requested" | "approved"; submitted_at: string | null; approved_at: string | null;
  updated_at: string | null; can_download: boolean; is_empty: boolean; comments: Comment[]; versions: Version[];
  tailor_cap: { used: number; limit: number }; ai: AiState };
type Change = { id: string; path: string; before: unknown; after: unknown; reason: string };
type Review = { match_score: number | null; missing_keywords: string[]; summary_of_fit: string; changes: Change[]; dropped: number;
  job_title?: string; company?: string };

const STATUS: Record<State["status"], [string, string]> = {
  draft: ["Draft", "pg"], in_review: ["In review", "pa"], changes_requested: ["Changes requested", "pr"], approved: ["Approved", "pb"],
};
const TEMPLATE_NOTE: Record<string, string> = {
  classic: "Centered header, black and white. Safe for any company.",
  modern: "Blue accents, left-aligned. Good for startups and product teams.",
  technical: "Skills and projects first. Best for career changers.",
};

export type ResumeTemplate = { id: string; name: string; program: string | null; description: string | null; layout: string;
  active: boolean; position: number; data: RData; updated_at: string | null };
export const LAYOUTS: Record<string, string> = { classic: "Classic", modern: "Modern", technical: "Technical (projects first)" };

export const EMPTY: RData = { basics: { name: "", headline: "", email: "", phone: "", location: "", links: [] }, summary: "", skills: [],
  experience: [], projects: [], education: [], certifications: [], languages: [] };

export async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// ── main workspace ──
export function ResumeWorkspace({ studentId, staff }: { studentId: string; staff?: boolean }) {
  const base = `/students/${studentId}/resume`;
  const st = useApi<State>(base);
  const toast = useToast();
  const [tab, setTab] = useState<"resume" | "tailor" | "versions">("resume");
  const [data, setData] = useState<RData>(EMPTY);
  const [template, setTemplate] = useState("classic");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [importing, setImporting] = useState(false);
  const [decision, setDecision] = useState<"approve" | "changes" | null>(null);
  const [printData, setPrintData] = useState<{ data: RData; template: string } | null>(null);
  const [saveTpl, setSaveTpl] = useState(false);

  useEffect(() => { if (st.data) { setData(st.data.data); setTemplate(st.data.template); setDirty(false); } }, [st.data]);
  useEffect(() => {
    if (!printData) return;
    const t = setTimeout(() => { window.print(); setPrintData(null); }, 50);
    return () => clearTimeout(t);
  }, [printData]);

  if (st.loading && !st.data) return <Spinner />;
  if (st.error) return <ErrorBox error={st.error} />;
  const s = st.data!;
  const first = s.student.name.split(" ")[0];
  const empty = s.is_empty && !dirty;

  const edit = (d: RData) => { setData(d); setDirty(true); };
  const save = async (quiet = false) => {
    setSaving(true); setErr(null);
    try { await api.put(base, { data, template }); setDirty(false); if (!quiet) toast("Resume saved"); await st.reload(); return true; }
    catch (e) { setErr(e); return false; } finally { setSaving(false); }
  };
  const submit = async () => {
    if (dirty && !(await save(true))) return;
    try { await api.post(`${base}/submit`); toast(`Sent to your advisor for review`); st.reload(); } catch (e) { setErr(e); }
  };
  const download = async (version?: Version) => {
    if (dirty && !version && !(await save(true))) return;
    try {
      const q = version ? `?version=${version.id}` : `?template=${template}`;
      await api.download(`${base}/docx${q}`, `${(data.basics.name || "resume").replace(/\s+/g, "-")}-Resume${version?.company ? "-" + version.company : ""}.docx`);
      st.reload();
    } catch (e) { setErr(e); }
  };
  const [label, pill] = STATUS[s.status];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="no-print">{/* status strip */}
        <div className="card" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", padding: "16px 20px" }}>
          <span className={`pill ${pill}`}>{label}</span>
          <span className="cap" style={{ flex: "1 1 240px" }}>
            {s.status === "approved" ? `Approved ${relTime(s.approved_at!)}. ${staff ? first + " can download any version." : "You can download any version."}`
              : s.status === "in_review" ? (staff ? `${first} sent this for review ${relTime(s.submitted_at!)}.` : "Your advisor is reviewing it. You can keep editing.")
              : s.status === "changes_requested" ? (staff ? `Waiting for ${first}'s changes.` : "Your advisor left comments. Make the changes and send it again.")
              : s.approved_at ? (staff ? "Edited after approval. Downloads stay unlocked." : "Edited since your last approval. Downloads stay unlocked.")
              : staff ? `Not reviewed yet. ${first} can download once you approve it.` : "Downloads unlock after your advisor approves your first resume."}
          </span>
          {dirty && <span className="cap" style={{ color: "var(--amber-num)", fontWeight: 700 }}>Unsaved changes</span>}
          <button className="btn bg sm" disabled={saving || !dirty} onClick={() => save()}>{saving ? "Saving…" : "Save"}</button>
          {!staff && !s.approved_at && s.status !== "in_review" && <button className="btn bp sm" disabled={empty} onClick={submit}>Send for review</button>}
          {!staff && s.approved_at && s.status !== "in_review" && <button className="btn bg sm" disabled={empty} onClick={submit}>Ask for another review</button>}
          {staff && <><button className="btn bg sm" onClick={() => setDecision("changes")}>Request changes</button>
            {(s.status !== "approved" || dirty) && <button className="btn by sm" disabled={empty} onClick={() => setDecision("approve")}><ICheck size={15} />Approve</button>}</>}
        </div>
      </div>
      <ErrorBox error={err} />

      <div className="tabs no-print" role="tablist">
        {([["resume", "Master resume"], ["tailor", "Tailor for a job"], ["versions", `Versions (${s.versions.length})`]] as const).map(([k, l]) =>
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === "resume" && (empty
        ? <StartPanel base={base} staff={staff} ai={s.ai} first={first} onStarter={(t) => {
            const b = data.basics;
            edit({ ...EMPTY, ...structuredClone(t.data), basics: { ...b, headline: t.data.basics.headline || b.headline, location: b.location || t.data.basics.location } });
            setTemplate(t.layout); toast(`"${t.name}" loaded. Replace everything in [brackets].`);
          }} onScratch={() => edit({ ...data, summary: " " })} importing={importing} setImporting={setImporting}
          onImported={() => { st.reload(); toast("Resume imported. Check every section."); }} />
        : <div className="grid no-print" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,440px),1fr))", gap: 20, alignItems: "start" }}>
            <div className="stack" style={{ gap: 16 }}>
              <TemplatePicker value={template} templates={s.templates} onChange={(t) => { setTemplate(t); setDirty(true); }} />
              <Editor data={data} onChange={edit} />
              {(staff || s.comments.length > 0) && <Comments base={base} staff={staff} comments={s.comments} onChange={st.reload} />}
              {staff && <div className="cap">Is this a great example? <button className="linkbtn" onClick={() => setSaveTpl(true)}>Save a copy as a template</button> so other students can start from it (contact details are removed).</div>}
              <div className="cap">Want to replace this with a new CV? <button className="linkbtn" onClick={() => edit({ ...EMPTY, basics: data.basics })}>Start over</button> (your current version is kept in Versions when you import).</div>
            </div>
            <div className="stack" style={{ gap: 12, position: "sticky", top: 16 }}>
              <div className="between"><span className="lb" style={{ margin: 0 }}>Preview · {s.templates[template]}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn bg sm" disabled={!s.can_download} title={s.can_download ? "" : "Unlocks after the first approval"}
                    onClick={() => setPrintData({ data, template })}>PDF</button>
                  <button className="btn bp sm" disabled={!s.can_download} onClick={() => download()}><IDownload size={15} />.docx</button></div></div>
              {!s.can_download && <div className="strip"><b>Locked</b><span>Download unlocks after your advisor approves your first resume.</span></div>}
              <Placeholders data={data} />
              <Preview data={data} template={template} />
            </div>
          </div>)}

      {tab === "tailor" && <div className="no-print"><Tailor base={base} staff={staff} state={s} master={data} dirty={dirty} saveFirst={() => save(true)}
        template={template} onSaved={() => { st.reload(); setTab("versions"); }} /></div>}

      {tab === "versions" && <div className="no-print"><Versions base={base} state={s} onDownload={download} onChanged={st.reload}
        onPdf={(v) => setPrintData({ data: v.data!, template: v.template })} /></div>}

      {printData && <div className="print-area"><Preview data={printData.data} template={printData.template} bare /></div>}
      {saveTpl && <SaveTemplate data={data} layout={template} onClose={() => setSaveTpl(false)}
        onDone={(n) => { setSaveTpl(false); toast(`Saved "${n}" to the template library`); }} />}
      {decision && <Decision base={`/advisor/students/${studentId}/resume`} kind={decision} first={first} firstApproval={!s.approved_at}
        beforeSave={dirty ? () => save(true) : undefined} onClose={() => setDecision(null)}
        onDone={(m) => { setDecision(null); toast(m); st.reload(); }} />}
    </div>);
}

// ── start: upload CV / template / scratch ──
function StartPanel({ base, staff, ai, first, onStarter, onScratch, importing, setImporting, onImported }: {
  base: string; staff?: boolean; ai: AiState; first: string; onStarter: (t: ResumeTemplate) => void; onScratch: () => void;
  importing: boolean; setImporting: (b: boolean) => void; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const tpls = useApi<ResumeTemplate[]>("/resume/templates");
  const [peek, setPeek] = useState<ResumeTemplate | null>(null);
  const [up, setUp] = useState<{ text: string; prompt: string } | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();

  const upload = async (f: File) => {
    setBusy(true); setErr(null);
    try { const fd = new FormData(); fd.append("file", f); setUp(await api.form(`${base}/upload`, fd)); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const doImport = async () => {
    setImporting(true); setErr(null);
    try { await api.post(`${base}/import`, { answer }); onImported(); } catch (e) { setErr(e); } finally { setImporting(false); }
  };
  const aiImport = async () => {
    setImporting(true); setErr(null);
    try { await api.post(base.replace("/students/", "/advisor/students/") + "/ai/import", { text: up!.text }); onImported(); }
    catch (e) { setErr(e); } finally { setImporting(false); }
  };

  if (up) return (
    <section className="card stack" style={{ gap: 16 }}>
      <div><div className="kick">Import the CV</div><h2 className="h2">Turn the CV into an editable resume</h2></div>
      {staff && ai.available && <div className="strip" style={{ background: "var(--blue-tint)" }}><ISpark size={18} />
        <span style={{ flex: 1 }}>Use the hub's AI (about $0.02). This month: ${ai.spent_usd.toFixed(2)} of ${ai.budget_usd.toFixed(0)}.</span>
        <button className="btn bp sm" disabled={importing} onClick={aiImport}>{importing ? "Importing…" : "Import with AI"}</button></div>}
      <PromptSteps prompt={up.prompt} what="the CV" answer={answer} setAnswer={setAnswer} staff={staff} first={first}
        onCopied={() => toast("Prompt copied")} />
      <ErrorBox error={err} />
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button className="btn bg" onClick={() => { setUp(null); setAnswer(""); }}>Back</button>
        <button className="btn bp" disabled={importing || answer.trim().length < 20} onClick={doImport}>{importing ? "Importing…" : "Import answer"}</button></div>
    </section>);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))", gap: 16 }}>
        <section className="card stack" style={{ gap: 12 }}>
          <span className="ynum">1</span><h2 className="h2" style={{ fontSize: 19 }}>Upload {staff ? `${first}'s` : "your"} CV</h2>
          <p className="cap" style={{ fontSize: 14 }}>PDF or Word. We read it and give you a prompt that turns it into an editable resume.</p>
          <input ref={fileRef} type="file" accept=".pdf,.docx" className="sr" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <button className="btn bp" style={{ marginTop: "auto" }} disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Reading…" : "Choose file"}</button>
        </section>
        <section className="card stack" style={{ gap: 12 }}>
          <span className="ynum">2</span><h2 className="h2" style={{ fontSize: 19 }}>Start from a template</h2>
          <p className="cap" style={{ fontSize: 14 }}>Example resumes from the career team, with typical skills and a project. Replace what's in [brackets].</p>
          <div className="stack" style={{ gap: 8, marginTop: "auto" }}>
            {tpls.loading && <Spinner />}
            {tpls.data?.length === 0 && <span className="cap">No templates yet.</span>}
            {tpls.data?.map((t) => <button key={t.id} className="btn bg" style={{ justifyContent: "space-between" }} onClick={() => setPeek(t)}>
              <span>{t.name}</span>{t.program && <span className="cap" style={{ fontSize: 12 }}>{t.program}</span>}</button>)}</div>
        </section>
        <section className="card stack" style={{ gap: 12 }}>
          <span className="ynum">3</span><h2 className="h2" style={{ fontSize: 19 }}>Start from scratch</h2>
          <p className="cap" style={{ fontSize: 14 }}>An empty resume with every section ready to fill in.</p>
          <button className="btn bg" style={{ marginTop: "auto" }} onClick={onScratch}>Open the editor</button>
        </section>
      </div>
      <ErrorBox error={err} />
      {peek && <Modal title={peek.name} onClose={() => setPeek(null)}>
        {peek.description && <p className="cap" style={{ fontSize: 14 }}>{peek.description}</p>}
        <div style={{ maxHeight: "60vh", overflow: "auto", border: "1px solid var(--line)", borderRadius: 12 }}>
          <Preview data={{ ...peek.data, basics: { ...peek.data.basics, name: peek.data.basics.name || "Your Name" } }} template={peek.layout} /></div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn bg" onClick={() => setPeek(null)}>Back</button>
          <button className="btn bp" onClick={() => { onStarter(peek); setPeek(null); }}>Use this template</button></div>
      </Modal>}
    </div>);
}

/** The copy-paste flow: no hub tokens are used. */
export function PromptSteps({ prompt, what, answer, setAnswer, staff, first, onCopied }: {
  prompt: string; what: string; answer: string; setAnswer: (s: string) => void; staff?: boolean; first: string; onCopied: () => void }) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="hw" style={{ alignItems: "flex-start" }}><span className="ynum">1</span>
        <div style={{ flex: 1 }} className="stack"><strong>Copy the prompt</strong>
          <span className="cap">It already includes {what}. {staff ? `${first} can also do this in their own account.` : "Nothing is sent anywhere until you paste it."}</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn bp sm" onClick={async () => { if (await copy(prompt)) onCopied(); }}>Copy prompt</button>
            <details><summary className="cap" style={{ cursor: "pointer", paddingTop: 6 }}>See the prompt</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 220, overflow: "auto", background: "var(--bg2)", padding: 12, borderRadius: 10, marginTop: 8 }}>{prompt}</pre></details>
          </div></div></div>
      <div className="hw" style={{ alignItems: "flex-start" }}><span className="ynum">2</span>
        <div style={{ flex: 1 }} className="stack"><strong>Paste it into a free AI chat</strong>
          <span className="cap">Use {staff ? "any" : "your own"} free account. Start a new chat and paste.</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="btn bg sm" href="https://chatgpt.com/" target="_blank" rel="noreferrer">Open ChatGPT</a>
            <a className="btn bg sm" href="https://claude.ai/new" target="_blank" rel="noreferrer">Open Claude</a>
            <a className="btn bg sm" href="https://gemini.google.com/" target="_blank" rel="noreferrer">Open Gemini</a></div></div></div>
      <div className="hw" style={{ alignItems: "flex-start" }}><span className="ynum">3</span>
        <div style={{ flex: 1 }} className="stack"><label htmlFor="ans"><strong>Paste the whole answer here</strong></label>
          <textarea id="ans" className="in" style={{ minHeight: 140, fontFamily: "ui-monospace,Menlo,monospace", fontSize: 12 }} value={answer}
            onChange={(e) => setAnswer(e.target.value)} placeholder='{ "basics": { … } }' /></div></div>
    </div>);
}

// ── template picker ──
export function TemplatePicker({ value, templates, onChange }: { value: string; templates: Record<string, string>; onChange: (t: string) => void }) {
  return (
    <section className="card stack" style={{ gap: 10 }}>
      <span className="lb" style={{ margin: 0 }}>Template</span>
      <div className="grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }} role="radiogroup" aria-label="Template">
        {Object.entries(templates).map(([k, l]) => <button key={k} role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          style={{ textAlign: "left", padding: 12, borderRadius: 12, cursor: "pointer", background: value === k ? "var(--blue-tint)" : "#fff",
            border: `2px solid ${value === k ? "var(--blue-deep)" : "var(--line)"}` }}>
          <Thumb t={k} /><div style={{ fontWeight: 700, fontSize: 13, marginTop: 8 }}>{l.split(" (")[0]}</div>
          <div className="cap" style={{ fontSize: 12 }}>{TEMPLATE_NOTE[k]}</div></button>)}
      </div>
      <span className="cap" style={{ fontSize: 12 }}>All three are single column with real text, so applicant tracking systems read them correctly.</span>
    </section>);
}

function Thumb({ t }: { t: string }) {
  const c = t === "classic" ? "#0B0B0F" : "#1B6FE0";
  const line = (w: string, h = 3, col = "#C9CED6", m = "3px 0") => <div style={{ width: w, height: h, background: col, borderRadius: 2, margin: m }} />;
  return <div aria-hidden style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: 8, height: 64,
    display: "flex", flexDirection: "column", alignItems: t === "classic" ? "center" : "flex-start" }}>
    {line("55%", 5, t === "modern" ? c : "#0B0B0F", "0 0 3px")}{line("35%", 3, c)}
    {line("30%", 3, c, "5px 0 2px")}{line(t === "technical" ? "80%" : "90%")}{line("70%")}</div>;
}

// ── editor ──
export function Editor({ data, onChange }: { data: RData; onChange: (d: RData) => void }) {
  const set = <K extends keyof RData>(k: K, v: RData[K]) => onChange({ ...data, [k]: v });
  const b = data.basics;
  const setB = (k: keyof RData["basics"], v: string) => set("basics", { ...b, [k]: v });
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Section title="Header">
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
          <F label="Full name" v={b.name} on={(v) => setB("name", v)} />
          <F label="Headline (target job title)" v={b.headline} on={(v) => setB("headline", v)} ph="Junior Frontend Developer" />
          <F label="Email" v={b.email} on={(v) => setB("email", v)} />
          <F label="Phone" v={b.phone} on={(v) => setB("phone", v)} />
          <F label="City, state" v={b.location} on={(v) => setB("location", v)} ph="Miami, FL" />
        </div>
        <ListEdit items={b.links} add={{ label: "LinkedIn", url: "" }} addLabel="Add link" onChange={(links) => set("basics", { ...b, links })}
          render={(l, up) => <div style={{ display: "flex", gap: 8 }}><F label="Label" v={l.label} on={(v) => up({ ...l, label: v })} w={130} />
            <F label="URL" v={l.url} on={(v) => up({ ...l, url: v })} ph="linkedin.com/in/…" /></div>} />
      </Section>
      <Section title="Summary">
        <T label="2–3 sentences" v={data.summary.trim() ? data.summary : ""} on={(v) => set("summary", v)} rows={3} />
      </Section>
      <Section title="Experience">
        <ListEdit items={data.experience} addLabel="Add job" add={{ title: "", company: "", location: "", start: "", end: "", bullets: [""] }}
          onChange={(v) => set("experience", v)} render={(e, up) => <div className="stack" style={{ gap: 8 }}>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
              <F label="Job title" v={e.title} on={(v) => up({ ...e, title: v })} /><F label="Company" v={e.company} on={(v) => up({ ...e, company: v })} />
              <F label="Location" v={e.location} on={(v) => up({ ...e, location: v })} />
              <F label="Start" v={e.start} on={(v) => up({ ...e, start: v })} ph="MM/YYYY" /><F label="End" v={e.end} on={(v) => up({ ...e, end: v })} ph="Present" /></div>
            <Bullets v={e.bullets} on={(bs) => up({ ...e, bullets: bs })} /></div>} />
      </Section>
      <Section title="Projects">
        <ListEdit items={data.projects} addLabel="Add project" add={{ name: "", link: "", tech: "", bullets: [""] }}
          onChange={(v) => set("projects", v)} render={(p, up) => <div className="stack" style={{ gap: 8 }}>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
              <F label="Name" v={p.name} on={(v) => up({ ...p, name: v })} /><F label="Tech" v={p.tech} on={(v) => up({ ...p, tech: v })} ph="React, Flask" />
              <F label="Link" v={p.link} on={(v) => up({ ...p, link: v })} ph="github.com/…" /></div>
            <Bullets v={p.bullets} on={(bs) => up({ ...p, bullets: bs })} /></div>} />
      </Section>
      <Section title="Skills">
        <ListEdit items={data.skills} addLabel="Add skill group" add={{ group: "", items: [] }} onChange={(v) => set("skills", v)}
          render={(g, up) => <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><F label="Group" v={g.group} on={(v) => up({ ...g, group: v })} w={150} ph="Frontend" />
            <CommaField label="Skills, separated by commas" v={g.items} on={(items) => up({ ...g, items })} /></div>} />
      </Section>
      <Section title="Education">
        <ListEdit items={data.education} addLabel="Add school" add={{ school: "", degree: "", start: "", end: "", details: "" }}
          onChange={(v) => set("education", v)} render={(e, up) => <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
            <F label="School" v={e.school} on={(v) => up({ ...e, school: v })} /><F label="Degree / program" v={e.degree} on={(v) => up({ ...e, degree: v })} />
            <F label="Start" v={e.start} on={(v) => up({ ...e, start: v })} /><F label="End" v={e.end} on={(v) => up({ ...e, end: v })} />
            <F label="Details (optional)" v={e.details} on={(v) => up({ ...e, details: v })} /></div>} />
      </Section>
      <Section title="Certifications & languages">
        <ListEdit items={data.certifications} addLabel="Add certification" add={{ name: "", issuer: "", date: "" }} onChange={(v) => set("certifications", v)}
          render={(c, up) => <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
            <F label="Name" v={c.name} on={(v) => up({ ...c, name: v })} /><F label="Issuer" v={c.issuer} on={(v) => up({ ...c, issuer: v })} />
            <F label="Date" v={c.date} on={(v) => up({ ...c, date: v })} /></div>} />
        <CommaField label="Languages, separated by commas" v={data.languages} on={(v) => set("languages", v)} ph="English (native), Spanish (fluent)" />
      </Section>
    </div>);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card stack" style={{ gap: 12 }}><h3 className="h2" style={{ fontSize: 17 }}>{title}</h3>{children}</section>;
}
let uid = 0;
export function F({ label, v, on, ph, w }: { label: string; v: string; on: (v: string) => void; ph?: string; w?: number }) {
  const id = useMemo(() => `f${++uid}`, []);
  return <div style={{ flex: w ? `0 0 ${w}px` : "1 1 160px", minWidth: 0 }}><label className="lb" htmlFor={id} style={{ fontSize: 12 }}>{label}</label>
    <input id={id} className="in" value={v} placeholder={ph} onChange={(e) => on(e.target.value)} /></div>;
}
function T({ label, v, on, rows = 3 }: { label: string; v: string; on: (v: string) => void; rows?: number }) {
  const id = useMemo(() => `t${++uid}`, []);
  return <div><label className="lb" htmlFor={id} style={{ fontSize: 12 }}>{label}</label>
    <textarea id={id} className="in" rows={rows} style={{ minHeight: 0 }} value={v} onChange={(e) => on(e.target.value)} /></div>;
}
function CommaField({ label, v, on, ph }: { label: string; v: string[]; on: (v: string[]) => void; ph?: string }) {
  const [txt, setTxt] = useState(v.join(", "));
  useEffect(() => { if (txt.split(",").map((s) => s.trim()).filter(Boolean).join("|") !== v.join("|")) setTxt(v.join(", ")); }, [v]); // eslint-disable-line
  return <F label={label} v={txt} ph={ph} on={(t) => { setTxt(t); on(t.split(",").map((s) => s.trim()).filter(Boolean)); }} />;
}
function Bullets({ v, on }: { v: string[]; on: (v: string[]) => void }) {
  const [txt, setTxt] = useState(v.join("\n"));
  useEffect(() => { if (txt.split("\n").filter((s) => s.trim()).join("|") !== v.filter((s) => s.trim()).join("|")) setTxt(v.join("\n")); }, [v]); // eslint-disable-line
  return <T label="Bullets, one per line. Start with a verb and add a result." v={txt} rows={Math.max(3, v.length + 1)}
    on={(t) => { setTxt(t); on(t.split("\n")); }} />;
}
function ListEdit<X>({ items, add, addLabel, onChange, render }: { items: X[]; add: X; addLabel: string; onChange: (v: X[]) => void;
  render: (x: X, update: (x: X) => void) => React.ReactNode }) {
  const up = (i: number, x: X) => onChange(items.map((y, j) => (j === i ? x : y)));
  const move = (i: number, d: number) => { const n = [...items]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); };
  return <div className="stack" style={{ gap: 10 }}>
    {items.map((x, i) => <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, position: "relative" }}>
      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", marginBottom: 4 }}>
        <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
        <button className="icon-btn" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
        <button className="icon-btn" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}><IX size={14} /></button></div>
      {render(x, (y) => up(i, y))}</div>)}
    <button className="btn bg sm" style={{ alignSelf: "flex-start" }} onClick={() => onChange([...items, structuredClone(add)])}>+ {addLabel}</button>
  </div>;
}

// ── preview (mirrors the .docx templates) ──
export function Preview({ data, template, bare }: { data: RData; template: string; bare?: boolean }) {
  const d = data, b = d.basics;
  const accent = template === "classic" ? "#0B0B0F" : "#1B6FE0";
  const center = template === "classic";
  const H = ({ t }: { t: string }) => <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em", color: accent, margin: "14px 0 4px",
    borderBottom: `1px solid ${template === "classic" ? "#0B0B0F" : "#CFE2FF"}`, paddingBottom: 2 }}>{t.toUpperCase()}</div>;
  const ul = (xs: string[]) => xs.filter((x) => x.trim()).length > 0 &&
    <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>{xs.filter((x) => x.trim()).map((x, i) => <li key={i} style={{ marginBottom: 1 }}>{hl(x)}</li>)}</ul>;
  const join = (xs: (string | undefined)[], sep = " · ") => xs.filter(Boolean).join(sep);
  const sec = {
    summary: d.summary.trim() && <div key="s"><H t="Summary" /><div>{hl(d.summary)}</div></div>,
    skills: d.skills.length > 0 && <div key="k"><H t="Skills" />{d.skills.map((g, i) => <div key={i}>{g.group && <b>{g.group}: </b>}{g.items.join(", ")}</div>)}</div>,
    experience: d.experience.length > 0 && <div key="e"><H t="Experience" />{d.experience.map((e, i) => <div key={i} style={{ marginTop: 6 }}>
      <b>{join([e.title, e.company])}</b> <i style={{ color: "#5C6470" }}>{join([e.location, join([e.start, e.end], " – ")])}</i>{ul(e.bullets)}</div>)}</div>,
    projects: d.projects.length > 0 && <div key="p"><H t="Projects" />{d.projects.map((p, i) => <div key={i} style={{ marginTop: 6 }}>
      <b>{p.name}</b> <i style={{ color: "#5C6470" }}>{join([p.tech, p.link])}</i>{ul(p.bullets)}</div>)}</div>,
    education: d.education.length > 0 && <div key="d"><H t="Education" />{d.education.map((e, i) => <div key={i}>
      <b>{join([e.degree, e.school])}</b> <i style={{ color: "#5C6470" }}>{join([e.start, e.end], " – ")}</i>{e.details && <div>{e.details}</div>}</div>)}</div>,
    extra: <div key="x">{d.certifications.length > 0 && <><H t="Certifications" />{d.certifications.map((c, i) => <div key={i}>{join([c.name, c.issuer, c.date])}</div>)}</>}
      {d.languages.length > 0 && <><H t="Languages" /><div>{d.languages.join(", ")}</div></>}</div>,
  };
  const order = template === "technical" ? ["summary", "skills", "projects", "experience", "education", "extra"]
    : ["summary", "experience", "projects", "skills", "education", "extra"];
  return (
    <div className={bare ? "" : "card"} style={{ background: "#fff", padding: bare ? 0 : "36px 40px", fontSize: 13, lineHeight: 1.45, color: "#0B0B0F",
      fontFamily: template === "modern" ? "Calibri, Inter, sans-serif" : "Arial, Helvetica, sans-serif", ...(bare ? {} : { boxShadow: "0 8px 30px rgba(14,27,44,.08)" }) }}>
      <div style={{ textAlign: center ? "center" : "left" }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: template === "modern" ? accent : "#0B0B0F", lineHeight: 1.15 }}>{b.name || "Your Name"}</div>
        {b.headline && <div style={{ fontSize: 15, color: accent }}>{b.headline}</div>}
        <div style={{ fontSize: 12, color: "#3F4752", marginTop: 2 }}>{join([b.location, b.email, b.phone, ...b.links.map((l) => l.url)])}</div>
      </div>
      {order.map((k) => sec[k as keyof typeof sec])}
    </div>);
}
/** Highlight [placeholders] the student still needs to fill in. */
function hl(t: string) {
  const parts = t.split(/(\[[^\]]+\])/g);
  return parts.map((p, i) => p.startsWith("[") && p.endsWith("]")
    ? <mark key={i} style={{ background: "#FDF3D7", color: "#7A4E00", borderRadius: 3, padding: "0 2px" }}>{p}</mark> : p);
}

// ── tailoring ──
function Tailor({ base, staff, state, master, dirty, saveFirst, template, onSaved }: {
  base: string; staff?: boolean; state: State; master: RData; dirty: boolean; saveFirst: () => Promise<boolean>; template: string; onSaved: () => void }) {
  const toast = useToast();
  const [jobText, setJobText] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<RData | null>(null);
  const [custom, setCustom] = useState<RData | null>(null);  // full manual edit of the tailored version
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [vLabel, setVLabel] = useState("");
  const [vTemplate, setVTemplate] = useState(template);
  const cap = state.tailor_cap;
  const capped = !staff && cap.used >= cap.limit;

  const chosen = review ? review.changes.filter((c) => accepted[c.id]) : [];
  useEffect(() => {
    if (!review) return;
    let alive = true;
    api.post<{ data: RData }>(`${base}/tailor/apply`, { changes: chosen }).then((r) => alive && setPreview(r.data)).catch(() => {});
    return () => { alive = false; };
  }, [review, JSON.stringify(accepted)]); // eslint-disable-line

  if (state.is_empty) return <div className="card"><p className="cap" style={{ fontSize: 15 }}>Build the master resume first (upload a CV or start from a template). Tailored versions start from it.</p></div>;

  const job = { job_text: jobText, job_title: jobTitle, company };
  const getPrompt = async () => {
    setBusy("prompt"); setErr(null);
    try {
      if (dirty && !(await saveFirst())) return;
      const r = await api.post<{ prompt: string }>(`${base}/tailor/prompt`, { job_text: jobText }); setPrompt(r.prompt);
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const start = (r: Review) => {
    setReview(r); setCustom(null); setAccepted(Object.fromEntries(r.changes.map((c) => [c.id, true])));
    setVLabel([company || r.company, jobTitle || r.job_title].filter(Boolean).join(" · ") || "Tailored resume");
  };
  const doReview = async () => {
    setBusy("review"); setErr(null);
    try { start(await api.post<Review>(`${base}/tailor/review`, { answer })); } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const runAi = async () => {
    setBusy("ai"); setErr(null);
    try {
      if (dirty && !(await saveFirst())) return;
      start(await api.post<Review>(base.replace("/students/", "/advisor/students/") + "/ai/tailor", { job_text: jobText }));
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const saveVersion = async () => {
    setBusy("save"); setErr(null);
    try {
      await api.post(`${base}/versions`, { label: vLabel, data: custom || preview || master, template: vTemplate, kind: "tailored",
        job_title: jobTitle || review?.job_title || null, company: company || review?.company || null,
        analysis: review ? { match_score: review.match_score, missing_keywords: review.missing_keywords, summary_of_fit: review.summary_of_fit } : null });
      toast("Tailored version saved"); onSaved();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };

  if (review) return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,440px),1fr))", gap: 20, alignItems: "start" }}>
      <div className="stack" style={{ gap: 16 }}>
        <section className="card stack" style={{ gap: 14 }}>
          <div className="between"><div><div className="kick">Fit for this job</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span className="num" style={{ fontSize: 44, lineHeight: 1, color: "var(--amber-num)" }}>{review.match_score ?? "—"}</span><span className="cap">/ 100 match</span></div></div>
            <button className="btn bg sm" onClick={() => { setReview(null); setCustom(null); setAnswer(""); }}>Start again</button></div>
          {review.summary_of_fit && <p style={{ fontSize: 14 }}>{review.summary_of_fit}</p>}
          {review.missing_keywords.length > 0 && <div><div className="lb">Missing keywords · add only what's true</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{review.missing_keywords.map((k) => <span key={k} className="pill pa">{k}</span>)}</div></div>}
        </section>
        {custom ? <section className="stack" style={{ gap: 12 }}>
          <div className="strip" style={{ background: "var(--blue-tint)" }}><b>Editing this version</b><span style={{ flex: 1 }}>Change anything you like. The master resume stays as it is.</span>
            <button className="linkbtn" onClick={() => setCustom(null)}>Back to the suggestions</button></div>
          <Editor data={custom} onChange={setCustom} />
        </section> : <section className="card stack" style={{ gap: 12 }}>
          <div className="between"><h3 className="h2" style={{ fontSize: 17 }}>Suggested changes · {chosen.length} of {review.changes.length} kept</h3>
            {review.dropped > 0 && <span className="cap">{review.dropped} skipped (didn't match the resume)</span>}</div>
          {review.changes.length === 0 && <p className="cap">No usable changes. Check you pasted the whole answer, or try again.</p>}
          {review.changes.map((c) => <label key={c.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", border: `1px solid ${accepted[c.id] ? "var(--blue-line)" : "var(--line)"}`,
            background: accepted[c.id] ? "#F7FAFF" : "#fff", borderRadius: 12, padding: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={!!accepted[c.id]} onChange={(e) => setAccepted({ ...accepted, [c.id]: e.target.checked })} style={{ marginTop: 4, width: 18, height: 18 }} />
            <span className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
              <span className="cap" style={{ fontWeight: 700, fontSize: 12 }}>{pathLabel(c.path, master)}</span>
              {fmt(c.before) && <span style={{ fontSize: 13, color: "var(--muted)", textDecoration: "line-through" }}>{fmt(c.before)}</span>}
              {accepted[c.id]
                ? <textarea className="in" aria-label="Suggested text (you can edit it)" rows={Math.max(2, Math.ceil(fmt(c.after).length / 70))}
                    style={{ minHeight: 0, fontSize: 14, fontWeight: 600, background: placeholders({ ...EMPTY, summary: fmt(c.after) }).length ? "#FFFBEF" : "#fff" }}
                    value={fmt(c.after)} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => { const v = Array.isArray(c.before) ? e.target.value.split(",").map((x) => x.trim()) : e.target.value;
                      setReview({ ...review, changes: review.changes.map((x) => (x.id === c.id ? { ...x, after: v } : x)) }); }} />
                : <span style={{ fontSize: 14, fontWeight: 600 }}>{hl(fmt(c.after))}</span>}
              {c.reason && <span className="cap" style={{ fontSize: 12 }}>Why: {c.reason}</span>}</span></label>)}
          <div className="cap" style={{ fontSize: 12 }}>You can edit each suggestion. Replace anything in [brackets] with your real number or detail. To change other parts too, use "Edit the whole resume".</div>
        </section>}
        <section className="card stack" style={{ gap: 12 }}>
          <h3 className="h2" style={{ fontSize: 17 }}>Save this version</h3>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <F label="Name" v={vLabel} on={setVLabel} ph="Acme · Junior Frontend" />
            <div style={{ flex: "0 0 170px" }}><label className="lb" htmlFor="vt" style={{ fontSize: 12 }}>Template</label>
              <select id="vt" className="in" value={vTemplate} onChange={(e) => setVTemplate(e.target.value)}>
                {Object.entries(state.templates).map(([k, l]) => <option key={k} value={k}>{l.split(" (")[0]}</option>)}</select></div></div>
          {!staff && <div className="cap">{cap.used} of {cap.limit} tailored versions saved this week.</div>}
          <ErrorBox error={err} />
          <button className="btn bp" style={{ alignSelf: "flex-start" }} disabled={busy === "save" || capped || vLabel.trim().length < 2} onClick={saveVersion}>
            {busy === "save" ? "Saving…" : "Save tailored version"}</button>
          <div className="cap" style={{ fontSize: 12 }}>The master resume doesn't change. Each tailored version is saved on its own.</div>
        </section>
      </div>
      <div className="stack" style={{ gap: 12, position: "sticky", top: 16 }}>
        <div className="between"><span className="lb" style={{ margin: 0 }}>{custom ? "Preview of your edited version" : "Preview with the changes you kept"}</span>
          {!custom && <button className="btn bg sm" onClick={() => setCustom(structuredClone(preview || master))}>Edit the whole resume</button>}</div>
        <Placeholders data={custom || preview || master} />
        <Preview data={custom || preview || master} template={vTemplate} />
      </div>
    </div>);

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 860 }}>
      <section className="card stack" style={{ gap: 12 }}>
        <div className="between"><div><div className="kick">Tailor for a job</div><h2 className="h2">Which job is {staff ? "it" : "this"} for?</h2></div>
          {!staff && <span className={`pill ${capped ? "pr" : "pg"}`}>{cap.used} of {cap.limit} this week</span>}</div>
        {capped && <div className="strip"><b>Weekly limit reached.</b><span>You can save {cap.limit} tailored versions a week. It resets on Monday.</span></div>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <F label="Company" v={company} on={setCompany} ph="Acme" /><F label="Job title" v={jobTitle} on={setJobTitle} ph="Junior Frontend Developer" /></div>
        <div><label className="lb" htmlFor="jd" style={{ fontSize: 12 }}>Paste the full job description</label>
          <textarea id="jd" className="in" style={{ minHeight: 170 }} value={jobText} onChange={(e) => { setJobText(e.target.value); setPrompt(null); }} /></div>
        {jobText.length > 0 && jobText.length < 80 && <div className="cap">Paste the whole posting so the suggestions fit the job.</div>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn bp" disabled={capped || jobText.trim().length < 80 || !!busy} onClick={getPrompt}>{busy === "prompt" ? "Preparing…" : "Get the tailoring prompt"}</button>
          {staff && <button className="btn by" disabled={jobText.trim().length < 80 || !state.ai.available || !!busy} onClick={runAi}
            title={state.ai.available ? "" : state.ai.configured ? "This month's AI budget is used up" : "AI isn't configured"}>
            <ISpark size={16} />{busy === "ai" ? "Tailoring… (about 20 s)" : "Run with AI"}</button>}
        </div>
        {staff && <div className="cap" style={{ fontSize: 12 }}>Hub AI this month: ${state.ai.spent_usd.toFixed(2)} of ${state.ai.budget_usd.toFixed(0)}. Students only see the copy-paste prompt.</div>}
        {!prompt && <ErrorBox error={err} />}
      </section>
      {prompt && <section className="card stack" style={{ gap: 14 }}>
        <PromptSteps prompt={prompt} what="the job and the resume" answer={answer} setAnswer={setAnswer} staff={staff} first={state.student.name.split(" ")[0]}
          onCopied={() => toast("Prompt copied")} />
        <ErrorBox error={err} />
        <button className="btn bp" style={{ alignSelf: "flex-end" }} disabled={answer.trim().length < 20 || busy === "review"} onClick={doReview}>
          {busy === "review" ? "Checking…" : "Review the suggestions"}</button>
      </section>}
    </div>);
}

/** Every "[...]" placeholder still in the resume. */
export function placeholders(d: RData): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => { if (typeof v === "string") out.push(...(v.match(/\[[^\]]+\]/g) || [])); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  walk(d); return out;
}
export function Placeholders({ data }: { data: RData }) {
  const ph = placeholders(data);
  if (!ph.length) return null;
  return <div className="strip"><b>{ph.length} to fill in</b><span>Replace {ph.slice(0, 3).map((x) => <mark key={x} style={{ background: "#fff", color: "#7A4E00", borderRadius: 3, padding: "0 3px", marginRight: 4 }}>{x}</mark>)}{ph.length > 3 ? "…" : ""} with your real details before sending.</span></div>;
}

function fmt(v: unknown): string { return Array.isArray(v) ? v.join(", ") : String(v ?? ""); }
function pathLabel(path: string, d: RData): string {
  const p = path.split(".");
  const n = (i: string) => (i === "+" ? "new" : `#${Number(i) + 1}`);
  if (p[0] === "basics") return p[1] === "headline" ? "Headline" : `Header · ${p[1]}`;
  if (p[0] === "summary") return "Summary";
  if (p[0] === "skills") return `Skills · ${d.skills[+p[1]]?.group || n(p[1])}`;
  if (p[0] === "experience") { const e = d.experience[+p[1]]; return `Experience · ${e ? [e.title, e.company].filter(Boolean).join(" at ") : n(p[1])}${p[2] === "bullets" ? ` · bullet ${n(p[3])}` : ` · ${p[2]}`}`; }
  if (p[0] === "projects") { const x = d.projects[+p[1]]; return `Project · ${x?.name || n(p[1])}${p[2] === "bullets" ? ` · bullet ${n(p[3])}` : ` · ${p[2]}`}`; }
  return path;
}

// ── versions ──
function Versions({ base, state, onDownload, onPdf, onChanged }: { base: string; state: State; onDownload: (v: Version) => void; onPdf: (v: Version) => void; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const full = useApi<Version>(open ? `${base}/versions/${open}` : null);
  const [draft, setDraft] = useState<RData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  useEffect(() => { setDraft(null); setErr(null); }, [open]);
  const saveDraft = async () => {
    setBusy(true); setErr(null);
    try { await api.put(`${base}/versions/${open}`, { data: draft }); toast("Version updated"); setDraft(null); full.reload(); onChanged(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  if (state.versions.length === 0) return <div className="card"><p className="cap" style={{ fontSize: 15 }}>No versions yet. Tailor the resume for a job to save the first one.</p></div>;
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))", gap: 20, alignItems: "start" }}>
      <div className="stack" style={{ gap: 10 }}>
        {!state.can_download && <div className="strip"><b>Locked</b><span>Downloads unlock after the first approval.</span></div>}
        {draft && <section className="stack" style={{ gap: 12 }}>
          <div className="strip" style={{ background: "var(--blue-tint)" }}><b>Editing {full.data?.label}</b><span style={{ flex: 1 }} />
            <button className="btn bg sm" onClick={() => setDraft(null)}>Cancel</button>
            <button className="btn bp sm" disabled={busy} onClick={saveDraft}>{busy ? "Saving…" : "Save version"}</button></div>
          <ErrorBox error={err} />
          <Editor data={draft} onChange={setDraft} />
        </section>}
        {!draft && state.versions.map((v) => <div key={v.id} className="act" style={{ background: open === v.id ? "var(--blue-tint)" : "#fff", alignItems: "center", gap: 12 }}>
          <IFile size={20} />
          <button style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0, minWidth: 0 }} onClick={() => { if (!draft || confirm("Discard your unsaved edits?")) setOpen(v.id); }}>
            <span style={{ display: "block", fontWeight: 700 }}>{v.label}</span>
            <span className="cap">{v.kind === "tailored" ? "Tailored" : "Master"} · {fmtDate(v.created_at)} · {state.templates[v.template]?.split(" (")[0]}{v.downloads ? ` · downloaded ${v.downloads}×` : ""}</span></button>
          {v.match_score != null && <span className="pill pa">{v.match_score}</span>}
          <button className="btn bg sm" disabled={!state.can_download} onClick={() => onDownload(v)} aria-label={`Download ${v.label}`}><IDownload size={15} /></button>
        </div>)}
      </div>
      <div className="stack" style={{ gap: 12, position: "sticky", top: 16 }}>
        {!open ? <div className="card cap">Select a version to preview it.</div>
          : full.loading || !full.data ? <Spinner /> : <>
            <div className="between"><span className="lb" style={{ margin: 0 }}>{full.data.label}</span>
              <div style={{ display: "flex", gap: 8 }}>
                {!draft && <button className="btn bp sm" onClick={() => setDraft(structuredClone(full.data!.data!))}>Edit</button>}
                <button className="btn bg sm" disabled={!state.can_download || !!draft} onClick={() => onPdf(full.data!)}>PDF</button></div></div>
            <Placeholders data={draft || full.data.data!} />
            <Preview data={draft || full.data.data!} template={full.data.template} /></>}
      </div>
    </div>);
}

// ── comments & review decisions ──
function Comments({ base, staff, comments, onChange }: { base: string; staff?: boolean; comments: Comment[]; onChange: () => void }) {
  const [body, setBody] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const add = async () => {
    try { await api.post(base.replace("/students/", "/advisor/students/") + "/comments", { body }); setBody(""); onChange(); } catch (e) { setErr(e); }
  };
  const toggle = async (c: Comment) => { await api.patch(`${base}/comments/${c.id}`); onChange(); };
  return (
    <section className="card stack" style={{ gap: 10 }}>
      <h3 className="h2" style={{ fontSize: 17 }}>Advisor comments</h3>
      {comments.length === 0 && <p className="cap">No comments yet.</p>}
      {comments.map((c) => <div key={c.id} className="hw" style={{ alignItems: "flex-start", opacity: c.resolved ? 0.6 : 1 }}>
        <button className="ynum" aria-label={c.resolved ? "Mark as open" : "Mark as done"} onClick={() => toggle(c)}
          style={{ border: "none", cursor: "pointer", ...(c.resolved ? { background: "var(--blue-deep)", color: "#fff" } : { background: "#fff", boxShadow: "inset 0 0 0 2px var(--line)" }) }}>{c.resolved ? "✓" : ""}</button>
        <div style={{ flex: 1 }}><div style={{ fontSize: 14, whiteSpace: "pre-wrap", textDecoration: c.resolved ? "line-through" : undefined }}>{c.body}</div>
          <div className="cap" style={{ fontSize: 12 }}>{c.author} · {relTime(c.created_at)}</div></div></div>)}
      {staff && <><textarea className="in" aria-label="New comment" rows={2} style={{ minHeight: 0 }} value={body} onChange={(e) => setBody(e.target.value)}
        placeholder="e.g. Add a number to the second Publix bullet." />
        <ErrorBox error={err} />
        <button className="btn bg sm" style={{ alignSelf: "flex-start" }} disabled={body.trim().length < 2} onClick={add}>Add comment</button></>}
    </section>);
}

function Decision({ base, kind, first, firstApproval, beforeSave, onClose, onDone }: { base: string; kind: "approve" | "changes"; first: string;
  firstApproval: boolean; beforeSave?: () => Promise<boolean>; onClose: () => void; onDone: (m: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      if (beforeSave && !(await beforeSave())) return;
      await api.post(`${base}/${kind === "approve" ? "approve" : "request-changes"}`, { note: note || null });
      onDone(kind === "approve" ? `${first}'s resume is approved` : `Sent your changes to ${first}`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return <Modal title={kind === "approve" ? `Approve ${first}'s resume?` : `Ask ${first} for changes`} onClose={onClose}>
    <p className="cap" style={{ fontSize: 14 }}>{kind === "approve"
      ? firstApproval ? `${first} can then download this and every tailored version. "Resume ready" is ticked in Stage 1 and ${first} gets an email.` : `${first} gets an email that it's approved.`
      : `${first} gets an email with your note. It's also added to the comments.`}</p>
    <div><label className="lb" htmlFor="dn">{kind === "approve" ? "Note (optional)" : "What should change?"}</label>
      <textarea id="dn" className="in" style={{ minHeight: 90 }} value={note} onChange={(e) => setNote(e.target.value)} /></div>
    <ErrorBox error={err} />
    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
      <button className="btn bg" onClick={onClose}>Cancel</button>
      <button className={`btn ${kind === "approve" ? "by" : "bp"}`} disabled={busy || (kind === "changes" && note.trim().length < 5)} onClick={go}>
        {busy ? "Saving…" : kind === "approve" ? "Approve" : "Send to " + first}</button></div>
  </Modal>;
}

function SaveTemplate({ data, layout, onClose, onDone }: { data: RData; layout: string; onClose: () => void; onDone: (name: string) => void }) {
  const [name, setName] = useState(data.basics.headline || "");
  const [program, setProgram] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await api.post("/advisor/resume-templates", { name, program, description, data, layout, active: false }); onDone(name); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return <Modal title="Save as a template" onClose={onClose}>
    <p className="cap" style={{ fontSize: 14 }}>A copy goes to the template library, hidden from students until you turn it on there. Name, email, phone and links are removed. Check the rest doesn't identify the student (employers, dates) before you publish it.</p>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <F label="Template name" v={name} on={setName} ph="AI Engineer · career changer" /><F label="Program" v={program} on={setProgram} ph="AI Engineering" /></div>
    <F label="Short description (optional)" v={description} on={setDescription} ph="Strong projects section, retail background" />
    <ErrorBox error={err} />
    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
      <button className="btn bg" onClick={onClose}>Cancel</button>
      <button className="btn bp" disabled={busy || name.trim().length < 2} onClick={go}>{busy ? "Saving…" : "Save template"}</button></div>
  </Modal>;
}
