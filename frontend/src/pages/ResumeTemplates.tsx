import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EMPTY, Editor, F, LAYOUTS, Preview, PromptSteps, RLANG_LABEL, ResumeLang, TemplatePicker, type RData, type RLang, type ResumeTemplate } from "../components/ResumeWorkspace";
import { IBack, ISpark } from "../components/Icons";
import { ErrorBox, Modal, Spinner, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { relTime } from "../lib/format";
import { useApi } from "../lib/useApi";
import { t } from "../lib/i18n";

export function StudioTabs({ on }: { on: "students" | "templates" }) {
  return <div className="tabs" role="tablist" style={{ marginBottom: 4 }}>
    <Link role="tab" aria-selected={on === "students"} className={`tab ${on === "students" ? "on" : ""}`} to="/staff/resumes">{t("Students")}</Link>
    <Link role="tab" aria-selected={on === "templates"} className={`tab ${on === "templates" ? "on" : ""}`} to="/staff/resumes/templates">{t("Template library")}</Link>
  </div>;
}

/** Thumbnail: the real preview, scaled down. */
function Mini({ t }: { t: ResumeTemplate }) {
  return <div aria-hidden style={{ height: 220, overflow: "hidden", borderRadius: 12, border: "1px solid var(--line)", background: "#fff", position: "relative" }}>
    <div style={{ transform: "scale(.42)", transformOrigin: "top left", width: "238%", padding: "28px 32px", pointerEvents: "none" }}>
      <Preview data={t.data} template={t.layout} lang={t.lang} bare />
    </div>
    <div style={{ position: "absolute", inset: "auto 0 0 0", height: 50, background: "linear-gradient(transparent,#fff)" }} />
  </div>;
}

export function TemplateLibrary() {
  const r = useApi<ResumeTemplate[]>("/resume/templates?all=true");
  const toast = useToast();
  const nav = useNavigate();
  const toggle = async (it: ResumeTemplate) => {
    await api.put(`/advisor/resume-templates/${it.id}`, { ...it, active: !it.active });
    toast(it.active ? t("\"{name}\" hidden from students", { name: it.name }) : t("\"{name}\" is now visible to students", { name: it.name })); r.reload();
  };
  const move = async (i: number, d: number) => {
    const ids = r.data!.map((x) => x.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    await api.post("/advisor/resume-templates/order", { ids }); r.reload();
  };
  const items = r.data || [];
  return (
    <>
      <header className="top"><div><div className="kick">{t("Resume Studio")}</div><h1>{t("Template")} <em>{t("library")}</em></h1>
        <div className="sub">{t("Example resumes students can start from. Upload a strong CV, build one, or save a student's resume as an example.")}</div></div>
        <button className="btn by" onClick={() => nav("/staff/resumes/templates/new")}>{t("+ New template")}</button></header>
      <div className="content">
        <StudioTabs on="templates" />
        {r.loading ? <Spinner /> : <ErrorBox error={r.error} />}
        {!r.loading && items.length === 0 && <div className="card cap">{t("No templates yet. Create the first one.")}</div>}
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,280px),1fr))", gap: 18 }}>
          {items.map((it, i) => <section key={it.id} className="card stack" style={{ gap: 10, padding: 16, opacity: it.active ? 1 : 0.75 }}>
            <Link to={`/staff/resumes/templates/${it.id}`} aria-label={t("Edit {name}", { name: it.name })}><Mini t={it} /></Link>
            <div className="between" style={{ alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 800 }}>{it.name}</div>
                <div className="cap" style={{ fontSize: 12 }}>{[it.program, LAYOUTS[it.layout]?.split(" (")[0], RLANG_LABEL[it.lang || "en"]].filter(Boolean).join(" · ")}</div></div>
              <span className={`pill ${it.active ? "pb" : "pg"}`}>{it.active ? t("Visible") : t("Hidden")}</span></div>
            {it.description && <div className="cap" style={{ fontSize: 13 }}>{it.description}</div>}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto" }}>
              <Link className="btn bp sm" to={`/staff/resumes/templates/${it.id}`}>{t("Edit")}</Link>
              <button className="btn bg sm" onClick={() => toggle(it)}>{it.active ? t("Hide") : t("Show to students")}</button>
              <button className="icon-btn" aria-label={t("Move earlier")} disabled={i === 0} onClick={() => move(i, -1)}>←</button>
              <button className="icon-btn" aria-label={t("Move later")} disabled={i === items.length - 1} onClick={() => move(i, 1)}>→</button>
            </div>
          </section>)}
        </div>
        <div className="cap">{t("Students see visible templates in this order under \"Start from a template\". Using one fills in their own name and contact details.")}</div>
      </div>
    </>);
}

type Draft = { name: string; program: string; description: string; layout: string; active: boolean; data: RData; lang: RLang };

export function TemplateEditor() {
  const { tid } = useParams();
  const isNew = tid === "new";
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const all = useApi<ResumeTemplate[]>("/resume/templates?all=true");
  const studio = useApi<{ ai: { available: boolean; spent_usd: number; budget_usd: number } }>("/advisor/resumes");
  const [d, setD] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const orig = all.data?.find((it) => it.id === tid);

  useEffect(() => {
    if (!isNew && orig && !d) setD({ name: orig.name, program: orig.program || "", description: orig.description || "", layout: orig.layout, active: orig.active, data: orig.data, lang: orig.lang || "en" });
  }, [orig, isNew, d]);

  const set = (patch: Partial<Draft>) => { setD((x) => ({ ...(x as Draft), ...patch })); setDirty(true); };
  const save = async () => {
    if (!d) return;
    setBusy(true); setErr(null);
    try {
      const body = { ...d, program: d.program || null, description: d.description || null };
      if (isNew) { const it = await api.post<ResumeTemplate>("/advisor/resume-templates", body); toast(t("Template saved")); nav(`/staff/resumes/templates/${it.id}`, { replace: true }); }
      else { await api.put(`/advisor/resume-templates/${tid}`, body); toast(t("Template saved")); all.reload(); }
      setDirty(false);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const del = async () => {
    try { await api.del(`/advisor/resume-templates/${tid}`); toast(t("Template deleted")); nav("/staff/resumes/templates"); } catch (e) { setErr(e); setConfirmDel(false); }
  };

  if (all.loading) return <Spinner />;
  if (!isNew && !orig) return <div className="content"><ErrorBox error={new Error(t("Template not found"))} /></div>;
  return (
    <>
      <header className="top"><div>
        <Link to="/staff/resumes/templates" className="cap" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IBack size={14} />{t("Template library")}</Link>
        <h1 style={{ marginTop: 6 }}>{isNew ? <>{t("New")} <em>{t("template")}</em></> : <>{d?.name || orig?.name}</>}</h1></div>
        {d && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {dirty && <span className="cap" style={{ color: "var(--amber-num)", fontWeight: 700 }}>{t("Unsaved changes")}</span>}
          {!isNew && (user?.role === "admin") && <button className="btn bg sm" onClick={() => setConfirmDel(true)}>{t("Delete")}</button>}
          <button className="btn bp" disabled={busy || !dirty || d.name.trim().length < 2} onClick={save}>{busy ? t("Saving…") : t("Save template")}</button></div>}
      </header>
      <div className="content">
        <ErrorBox error={err} />
        {!d ? <NewStart ai={studio.data?.ai} templates={all.data || []} onReady={(data, layout, name, lang) => { setD({ name, program: "", description: "", layout, active: false, data, lang }); setDirty(true); }} />
          : <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,440px),1fr))", gap: 20, alignItems: "start" }}>
            <div className="stack" style={{ gap: 16 }}>
              <section className="card stack" style={{ gap: 10 }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <F label={t("Template name")} v={d.name} on={(v) => set({ name: v })} ph={t("AI Engineer · career changer")} />
                  <F label={t("Program")} v={d.program} on={(v) => set({ program: v })} ph={t("AI Engineering")} /></div>
                <F label={t("Short description (students see it)")} v={d.description} on={(v) => set({ description: v })} ph={t("Projects first. Good for career changers.")} />
                <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer", fontWeight: 600 }}>
                  <input type="checkbox" checked={d.active} onChange={(e) => set({ active: e.target.checked })} style={{ width: 18, height: 18 }} />
                  {t("Visible to students")}</label>
              </section>
              <ResumeLang value={d.lang} onChange={(l) => set({ lang: l })} />
              <TemplatePicker value={d.layout} templates={LAYOUTS} onChange={(l) => set({ layout: l })} />
              <div className="strip"><b>{t("Tip:")}</b><span>{t("Use [brackets] for anything the student must replace. Name, email, phone and links are always left empty; each student's own are filled in.")}</span></div>
              <Editor data={d.data} onChange={(data) => set({ data })} />
            </div>
            <div className="stack" style={{ gap: 12, position: "sticky", top: 16 }}>
              <span className="lb" style={{ margin: 0 }}>{t("Preview")} · {t(LAYOUTS[d.layout])}</span>
              <Preview data={d.data} template={d.layout} lang={d.lang} />
            </div>
          </div>}
      </div>
      {confirmDel && <Modal title={t("Delete this template?")} onClose={() => setConfirmDel(false)}>
        <p className="cap" style={{ fontSize: 14 }}>{t("Students who already used it keep their resumes. To take it away only for now, use Hide instead.")}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn bg" onClick={() => setConfirmDel(false)}>{t("Cancel")}</button>
          <button className="btn bp" style={{ background: "var(--red)", borderColor: "var(--red)" }} onClick={del}>{t("Delete")}</button></div></Modal>}
    </>);
}

function NewStart({ ai, templates, onReady }: { ai?: { available: boolean; spent_usd: number; budget_usd: number }; templates: ResumeTemplate[];
  onReady: (d: RData, layout: string, name: string, lang: RLang) => void }) {
  const [lang, setLang] = useState<RLang>("en");
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [up, setUp] = useState<{ text: string; prompt: string; name: string } | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const upload = async (f: File) => {
    setBusy("upload"); setErr(null);
    try { const fd = new FormData(); fd.append("file", f); const r = await api.form<{ text: string; prompt: string }>(`/advisor/resume-templates/upload?lang=${lang}`, fd);
      setUp({ ...r, name: f.name.replace(/\.[^.]+$/, "") }); }
    catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const parse = async () => {
    setBusy("parse"); setErr(null);
    try { const r = await api.post<{ data: RData }>("/advisor/resume-templates/parse", { answer }); onReady(r.data, "classic", up!.name, lang); }
    catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const aiImport = async () => {
    setBusy("ai"); setErr(null);
    try { const r = await api.post<{ data: RData }>("/advisor/resume-templates/ai-import", { text: up!.text, lang }); onReady(r.data, "classic", up!.name, lang); }
    catch (e) { setErr(e); } finally { setBusy(null); }
  };
  if (up) return <section className="card stack" style={{ gap: 16, maxWidth: 860 }}>
    <div><div className="kick">{t("Import the example CV")}</div><h2 className="h2">{t("Turn it into an editable template")}</h2>
      <p className="cap" style={{ fontSize: 14, marginTop: 4 }}>{t("Name, email, phone and links are removed automatically. Remove anything else that identifies the person before making it visible.")}</p></div>
    {ai?.available && <div className="strip" style={{ background: "var(--blue-tint)" }}><ISpark size={18} />
      <span style={{ flex: 1 }}>{t("Use the hub's AI (about $0.02). This month: ${spent} of ${budget}.", { spent: ai.spent_usd.toFixed(2), budget: ai.budget_usd.toFixed(0) })}</span>
      <button className="btn bp sm" disabled={!!busy} onClick={aiImport}>{busy === "ai" ? t("Importing…") : t("Import with AI")}</button></div>}
    <PromptSteps prompt={up.prompt} what={t("the CV")} answer={answer} setAnswer={setAnswer} staff first="the student" onCopied={() => toast(t("Prompt copied"))} />
    <ErrorBox error={err} />
    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
      <button className="btn bg" onClick={() => { setUp(null); setAnswer(""); }}>{t("Back")}</button>
      <button className="btn bp" disabled={!!busy || answer.trim().length < 20} onClick={parse}>{busy === "parse" ? t("Importing…") : t("Import answer")}</button></div>
  </section>;
  return <div className="stack" style={{ gap: 16 }}>
    <ResumeLang value={lang} onChange={setLang} />
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))", gap: 16 }}>
      <section className="card stack" style={{ gap: 12 }}><span className="ynum">1</span><h2 className="h2" style={{ fontSize: 19 }}>{t("Upload an example CV")}</h2>
        <p className="cap" style={{ fontSize: 14 }}>{t("A strong resume you want students to model, PDF or Word.")}</p>
        <input ref={fileRef} type="file" accept=".pdf,.docx" className="sr" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <button className="btn bp" style={{ marginTop: "auto" }} disabled={!!busy} onClick={() => fileRef.current?.click()}>{busy === "upload" ? t("Reading…") : t("Choose file")}</button></section>
      <section className="card stack" style={{ gap: 12 }}><span className="ynum">2</span><h2 className="h2" style={{ fontSize: 19 }}>{t("Copy an existing template")}</h2>
        <p className="cap" style={{ fontSize: 14 }}>{t("Start from one in the library and adjust it, for example for a different role.")}</p>
        <div className="stack" style={{ gap: 8, marginTop: "auto" }}>{templates.map((it) =>
          <button key={it.id} className="btn bg" onClick={() => onReady(structuredClone(it.data), it.layout, `${it.name} (copy)`, it.lang || "en")}>{it.name} · {(it.lang || "en").toUpperCase()}</button>)}</div></section>
      <section className="card stack" style={{ gap: 12 }}><span className="ynum">3</span><h2 className="h2" style={{ fontSize: 19 }}>{t("Build from scratch")}</h2>
        <p className="cap" style={{ fontSize: 14 }}>{t("An empty resume with every section ready to fill in.")}</p>
        <button className="btn bg" style={{ marginTop: "auto" }} onClick={() => onReady(structuredClone(EMPTY), "classic", "", lang)}>{t("Open the editor")}</button></section>
    </div>
    <ErrorBox error={err} />
  </div>;
}
