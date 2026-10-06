import { useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/useApi";
import type { Analysis } from "../lib/types";
import { fmtDate } from "../lib/format";
import { ErrorBox, Spinner, useToast } from "../components/ui";
import { IAlert, ICheck, IDownload, ISpark, IX } from "../components/Icons";

type Version = { id: string; title: string; score: number; projected?: number; created_at: string; analysis: Analysis; job_description: string };
type Task = { task: string; done: boolean };

export default function Resume() {
  const versions = useApi<Version[]>("/resume/versions");
  const tasks = useApi<Task[]>("/students/me/profile-tasks");
  const { refresh } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [jd, setJd] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [current, setCurrent] = useState<Version | null>(null);

  const hasBase = (versions.data?.length || 0) > 0;
  const step = current ? 3 : jd ? 2 : file || text || hasBase ? 1 : 0;
  const shown = current || null;

  const analyze = async () => {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("job_description", jd);
      fd.append("title", title);
      if (file) fd.append("file", file);
      else if (text) fd.append("resume_text", text);
      const r = await api.form<{ id: string; title: string; analysis: Analysis; created_at: string }>("/resume/analyze", fd);
      setCurrent({ ...r, score: r.analysis.tailoring_score, job_description: jd });
      versions.reload(); tasks.reload(); refresh();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const markTask = async (t: string) => {
    await api.post(`/students/me/profile-tasks/${t}`);
    toast("Profile task done · +5"); tasks.reload(); refresh();
  };

  const labels: Record<string, string> = { cv: "CV uploaded", github: "GitHub profile ready", linkedin: "LinkedIn optimized", headshot: "Professional headshot" };
  const steps = ["Your resume", "Job description", "Review feedback", "Download"];

  return (
    <>
      <header className="top">
        <div><h1>AI Resume Builder</h1><div className="sub">Tailor your resume to each job in under a minute.</div></div>
      </header>
      <div className="content">
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }} aria-label="Progress">
          {steps.map((s, i) => (
            <li key={s} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: i === step ? 800 : 600, color: i <= step ? "var(--ink)" : "var(--muted)", flex: i < 3 ? "1 1 auto" : undefined }}>
              <span style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flex: "none",
                background: i < step ? "var(--blue-deep)" : i === step ? "var(--blue-tint)" : "#F0F2F5", color: i < step ? "#fff" : i === step ? "var(--blue-deep)" : "var(--muted)",
                border: i === step ? "2px solid var(--blue-deep)" : "none" }}>{i < step ? <ICheck size={14} /> : i + 1}</span>{s}
              {i < 3 && <span aria-hidden="true" style={{ flex: 1, height: 2, minWidth: 24, background: i < step ? "var(--blue-deep)" : "var(--line)" }} />}
            </li>))}
        </ol>

        <div className="row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 380px", display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
            <section className="card stack">
              <h2 className="h2">Your resume</h2>
              <input ref={fileRef} type="file" accept=".pdf,.docx" className="sr" id="resume-file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              {file ? (
                <div style={{ display: "flex", gap: 14, alignItems: "center", border: "1px solid var(--line)", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ width: 40, height: 48, borderRadius: 8, background: "var(--red-soft)", color: "var(--red-ink)", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{file.name.split(".").pop()?.toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</div><div className="cap">Ready to analyze</div></div>
                  <button className="btn bg sm" onClick={() => fileRef.current?.click()}>Replace</button>
                </div>) : (
                <label htmlFor="resume-file" style={{ border: "2px dashed #D5DAE3", borderRadius: 14, padding: 28, textAlign: "center", cursor: "pointer", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Upload .pdf or .docx</span>
                  <span className="cap">{hasBase ? "Or leave empty to reuse your last resume" : "First upload earns +5 (profile task)"}</span>
                  <span className="btn bg sm">Choose file</span>
                </label>)}
              {!file && <details><summary className="cap" style={{ cursor: "pointer" }}>Or paste plain text</summary>
                <textarea className="in" aria-label="Resume text" style={{ marginTop: 8 }} value={text} onChange={(e) => setText(e.target.value)} /></details>}
            </section>
            <section className="card stack">
              <h2 className="h2">Job description</h2>
              <div><label className="lb" htmlFor="t">Save as (company · role)</label><input className="in" id="t" placeholder="Spotify · Frontend Developer" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div><label className="lb" htmlFor="jd">Paste the full job description</label><textarea className="in" id="jd" style={{ minHeight: 180 }} value={jd} onChange={(e) => setJd(e.target.value)} /></div>
              <ErrorBox error={err} />
              <button className="btn bp" disabled={busy || jd.length < 100 || (!file && !text && !hasBase)} onClick={analyze}>
                <ISpark size={18} />{busy ? "Analyzing… (about 20 seconds)" : "Analyze & tailor with AI"}</button>
              {jd.length > 0 && jd.length < 100 && <div className="cap">Paste the whole posting for an accurate analysis.</div>}
            </section>
          </div>

          <div style={{ flex: "1.3 1 460px", display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
            {busy ? <section className="card"><Spinner /><p className="cap" style={{ textAlign: "center" }}>Reading your resume against the job…</p></section>
              : shown ? <Feedback v={shown} onDownload={async () => {
                await api.download(`/resume/versions/${shown.id}/docx`, `${shown.title || "resume"}.docx`); refresh();
              }} /> : (
                <section className="card stack" style={{ background: "var(--bg2)" }}>
                  <h2 className="h2">How it works</h2>
                  <p className="cap" style={{ fontSize: 14 }}>Upload your resume once, paste a job description, and get a match score, missing keywords, a tailored summary and stronger bullets. Download a tailored .docx for each application.</p>
                </section>)}

            <section className="card stack">
              <h2 className="h2">Profile checklist</h2>
              {tasks.data?.map((t) => (
                <div key={t.task} className="between" style={{ padding: "6px 0" }}>
                  <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ width: 24, height: 24, borderRadius: "50%", background: t.done ? "var(--blue-tint)" : "#F0F2F5", color: "var(--blue-deep)", display: "flex", alignItems: "center", justifyContent: "center" }}>{t.done && <ICheck size={13} />}</span>
                    {labels[t.task]}</span>
                  {t.done ? <span className="pill pb">+5 earned</span> : t.task !== "cv" && <button className="btn bg sm" onClick={() => markTask(t.task)}>Mark done · +5</button>}
                </div>))}
            </section>

            {versions.data && versions.data.length > 0 && (
              <section className="card stack">
                <h2 className="h2">Saved versions</h2>
                {versions.data.map((v) => (
                  <button key={v.id} className="act" style={{ background: current?.id === v.id ? "var(--blue-tint)" : "#fff", textAlign: "left", cursor: "pointer" }} onClick={() => setCurrent(v)}>
                    <span style={{ flex: 1 }}><span style={{ display: "block", fontWeight: 700 }}>{v.title}</span><span className="cap">{fmtDate(v.created_at)}</span></span>
                    <span className="pill pg">{v.score} → {v.projected ?? "—"}</span></button>))}
              </section>)}
          </div>
        </div>
      </div>
    </>);
}

function Feedback({ v, onDownload }: { v: Version; onDownload: () => void }) {
  const a = v.analysis;
  const toast = useToast();
  const style = { good: ["var(--blue-tint)", "var(--blue-deep)", <ICheck size={16} />], warn: ["var(--amber-soft)", "var(--amber-ink)", <IAlert size={16} />], bad: ["var(--red-soft)", "var(--red-ink)", <IX size={16} />] } as const;
  return (
    <section className="card stack" style={{ gap: 18 }}>
      <div className="row" style={{ gap: 20, alignItems: "center" }}>
        <div style={{ flex: "1 1 200px" }}><div className="eyebrow">Match score</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span className="num" style={{ fontSize: 44, lineHeight: 1, color: "var(--amber-num)" }}>{a.tailoring_score}</span>
            {a.projected_score != null && <><span className="cap">→</span><span className="num" style={{ fontSize: 44, lineHeight: 1, color: "var(--blue-deep)" }}>{a.projected_score}</span></>}
          </div><div className="cap">Now → after applying the suggestions</div></div>
        {a.keyword_gaps.length > 0 && <div style={{ flex: "1 1 220px" }}><div className="lb">Missing keywords</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{a.keyword_gaps.map((k) => <span key={k} className="pill pa" style={{ fontSize: 13 }}>{k}</span>)}</div></div>}
      </div>
      <div className="stack" style={{ gap: 10 }}>{a.feedback.map((f, i) => {
        const [bg, fg, icon] = style[f.type] || style.warn;
        return <div key={i} style={{ display: "flex", gap: 12, padding: "14px 16px", borderRadius: 12, background: bg, fontSize: 14 }}><span style={{ color: fg, flex: "none", marginTop: 2 }}>{icon}</span><span>{f.text}</span></div>;
      })}</div>
      {a.suggested_summary && <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 16 }} className="stack">
        <div className="between"><span className="lb" style={{ margin: 0 }}>Suggested summary</span>
          <button className="btn bg sm" onClick={() => { navigator.clipboard.writeText(a.suggested_summary); toast("Summary copied"); }}>Copy</button></div>
        <p style={{ fontSize: 14, color: "var(--body)" }}>{a.suggested_summary}</p></div>}
      {a.suggested_bullets.length > 0 && <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 16 }} className="stack">
        <span className="lb" style={{ margin: 0 }}>Bullet rewrites</span>
        {a.suggested_bullets.map((b, i) => <div key={i} className="stack" style={{ gap: 4 }}>
          <div style={{ fontSize: 14, color: "var(--muted)", textDecoration: "line-through" }}>{b.before}</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{b.after}</div></div>)}
        <div className="cap">Anything in [brackets] is a number you need to confirm before sending.</div></div>}
      <button className="btn bp" style={{ alignSelf: "flex-start" }} onClick={onDownload}><IDownload size={18} />Download tailored .docx</button>
    </section>);
}
