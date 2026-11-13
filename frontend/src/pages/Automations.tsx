import { useMemo, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { relTime } from "../lib/format";
import { ErrorBox, Modal, Spinner, useToast } from "../components/ui";
import { IPlug, IPlus } from "../components/Icons";
import { t } from "../lib/i18n";

type Auto = {
  id: string; name: string; description: string | null; category: string | null; connection_id: string | null;
  n8n_workflow_id: string | null; link: string | null; webhook_url: string | boolean | null; runnable: boolean;
  secret: string | null; events: string[]; scope: string; allow_advisors: boolean; active: boolean;
  schedule_note: string | null; last_run_at: string | null; last_status: string | null; callback_url: string; runs_24h: number | null;
};
type Run = { id: string; automation_id: string; source: string; status: string; event: string | null; context: Record<string, unknown> | null;
  http_status: number | null; response: string | null; duration_ms: number | null; triggered_by: string | null; created_at: string };
type Conn = { id: string; name: string; base_url: string; has_api_key: boolean; api_key_hint: string | null };
type Meta = { events: Record<string, string>; scopes: Record<string, string>; ingest_url: string; ingest_ready: boolean };
type Wf = { id: string; name: string; active: boolean; triggers: string[]; webhook_url: string | null; link: string; automation_id: string | null };
type Opt = { id: string; name: string };

const SOURCE: Record<string, string> = { manual: "Run by hand", event: "Hub event", callback: "Workflow reported", test: "Test" };

function StatusDot({ s }: { s: string | null }) {
  if (!s) return <span className="pill" style={{ background: "var(--bg)", color: "var(--muted)" }}>{t("Never run")}</span>;
  return s === "ok" ? <span className="pill" style={{ background: "#E7F6EC", color: "#1B6B3A" }}>{t("OK")}</span>
    : <span className="pill" style={{ background: "var(--red-soft)", color: "var(--red-ink)" }}>{t("Error")}</span>;
}

export default function Automations() {
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const autos = useApi<Auto[]>("/automations");
  const meta = useApi<Meta>("/automations/meta");
  const runs = useApi<Run[]>("/automations/runs?limit=60");
  const conns = useApi<Conn[]>(admin ? "/automations/connections" : null);
  const [tab, setTab] = useState<"workflows" | "history" | "connections">("workflows");
  const [running, setRunning] = useState<Auto | null>(null);
  const [editing, setEditing] = useState<Auto | "new" | null>(null);
  const [q, setQ] = useState("");
  const names = useMemo(() => Object.fromEntries((autos.data || []).map((a) => [a.id, a.name])), [autos.data]);
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const m = new Map<string, Auto[]>();
    for (const a of autos.data || []) {
      if (ql && !`${a.name} ${a.description || ""} ${a.category || ""}`.toLowerCase().includes(ql)) continue;
      const k = a.category || t("Other");
      m.set(k, [...(m.get(k) || []), a]);
    }
    return [...m.entries()];
  }, [autos.data, q]);
  const reload = () => { autos.reload(); runs.reload(); };

  return (
    <>
      <header className="top"><div><div className="kick">{t("Manage")}</div><h1>{t("Automations")}</h1>
        <div className="sub">{t("n8n workflows connected to the hub: run them by hand, fire them on hub events, and see what they reported back.")}</div></div>
        {admin && <button className="btn bp" onClick={() => setEditing("new")}><IPlus size={18} />{t("Add workflow")}</button>}</header>
      <div className="content">
        <div className="tabs" role="tablist">
          {(["workflows", "history", ...(admin ? ["connections"] as const : [])] as const).map((k) =>
            <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>
              {k === "workflows" ? t("Workflows") : k === "history" ? t("Run history") : t("n8n connection")}</button>)}
        </div>

        {tab === "workflows" && <>
          <input className="in" style={{ maxWidth: 320 }} placeholder={t("Search workflows")} aria-label={t("Search workflows")} value={q} onChange={(e) => setQ(e.target.value)} />
          {autos.loading ? <Spinner /> : <ErrorBox error={autos.error} />}
          {groups.map(([cat, list]) => <section key={cat} className="card stack">
            <h2 className="h2">{cat} <span className="cap">· {list.length}</span></h2>
            <div className="tw"><table>
              <thead><tr><th>{t("Workflow")}</th><th>{t("How it starts")}</th><th>{t("Last run")}</th><th></th></tr></thead>
              <tbody>{list.map((a) => <tr key={a.id} style={a.active ? undefined : { opacity: .55 }}>
                <td><strong>{a.name}</strong>{!a.active && <span className="cap"> · {t("paused")}</span>}
                  {a.description && <div className="cap">{a.description}</div>}
                  {a.link && <div className="cap"><a href={a.link} target="_blank" rel="noreferrer">{t("Open in n8n")} ↗</a></div>}</td>
                <td className="cap">
                  {a.runnable ? <div>▶ {t("Run button")}{a.scope !== "none" ? ` · ${t("needs a {scope}", { scope: t(meta.data?.scopes[a.scope] || a.scope).toLowerCase() })}` : ""}</div>
                    : <div style={{ color: "var(--amber-ink)" }}>{t("No Webhook trigger yet")}</div>}
                  {a.events.length > 0 && <div>⚡ {a.events.map((e) => t(meta.data?.events[e] || e)).join(", ")}</div>}
                  {a.schedule_note && <div>🕒 {t(a.schedule_note)}</div>}</td>
                <td><StatusDot s={a.last_status} />{a.last_run_at && <div className="cap">{relTime(a.last_run_at)}</div>}</td>
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  <button className="btn bp sm" disabled={!a.runnable || !a.active} title={a.runnable ? "" : t("Add a Webhook trigger in n8n first")} onClick={() => setRunning(a)}>{t("Run")}</button>{" "}
                  {admin && <button className="btn bg sm" onClick={() => setEditing(a)}>{t("Set up")}</button>}</td>
              </tr>)}</tbody></table></div>
          </section>)}
          {!autos.loading && groups.length === 0 && <div className="card cap">{t("No workflows yet.")}</div>}
          <HowTo meta={meta.data} />
        </>}

        {tab === "history" && <section className="card stack">
          <div style={{ display: "flex", justifyContent: "space-between" }}><h2 className="h2">{t("Run history")}</h2><button className="btn bg sm" onClick={runs.reload}>{t("Refresh")}</button></div>
          {runs.loading ? <Spinner /> : !runs.data?.length ? <div className="cap">{t("Nothing has run yet.")}</div> : <div className="tw"><table>
            <thead><tr><th>{t("When")}</th><th>{t("Workflow")}</th><th>{t("Started by")}</th><th>{t("For")}</th><th>{t("Result")}</th></tr></thead>
            <tbody>{runs.data.map((r) => <tr key={r.id}>
              <td className="cap">{relTime(r.created_at)}</td><td><strong>{names[r.automation_id] || "—"}</strong></td>
              <td className="cap">{t(SOURCE[r.source] || r.source)}{r.triggered_by ? ` · ${r.triggered_by}` : ""}{r.event ? ` · ${t(meta.data?.events[r.event] || r.event)}` : ""}</td>
              <td className="cap">{contextText(r.context)}</td>
              <td><StatusDot s={r.status} />{r.http_status ? <span className="cap"> {r.http_status}</span> : null}{r.duration_ms != null && <span className="cap"> · {r.duration_ms} ms</span>}
                {r.response && <div className="cap" style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.response}>{r.response}</div>}</td>
            </tr>)}</tbody></table></div>}
        </section>}

        {tab === "connections" && admin && <Connections conns={conns.data || []} loading={conns.loading} reload={() => { conns.reload(); autos.reload(); }} />}
      </div>
      {running && <RunModal a={running} meta={meta.data} onClose={() => setRunning(null)} onDone={() => { reload(); }} />}
      {editing && <EditAuto a={editing === "new" ? null : editing} meta={meta.data} conns={conns.data || []} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
    </>);
}

function contextText(c: Record<string, unknown> | null): string {
  if (!c) return "—";
  const parts: string[] = [];
  for (const k of ["student", "cohort", "job"]) {
    const v = c[k] as { name?: string } | undefined;
    if (v?.name) parts.push(v.name);
  }
  for (const k of ["items", "jobs", "count"]) if (c[k] != null) parts.push(`${c[k]} ${t(k)}`);
  if (c.country) parts.push(String(c.country));
  return parts.join(" · ") || "—";
}

function HowTo({ meta }: { meta: Meta | null }) {
  return <section className="card stack" style={{ background: "var(--bg2)" }}>
    <h2 className="h2">{t("Connecting an n8n workflow")}</h2>
    <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 8 }}>
      <li><strong>{t("To run it from here:")}</strong> {t("in n8n, add a Webhook trigger (POST) to the workflow, activate it, and paste its Production URL in “Set up”. The hub sends the student, cohort or job you pick, plus the header X-GeekForce-Secret.")}</li>
      <li><strong>{t("To fire it on hub events:")}</strong> {t("in “Set up”, tick the events (stage changed, job shared, student applied…). Same Webhook, sent automatically.")}</li>
      <li><strong>{t("To report back:")}</strong> {t("at the end of the workflow add an HTTP Request node: POST to the workflow's callback URL (shown in “Set up”) with the header X-GeekForce-Secret and a JSON body like {example}. Scheduled runs then show in Run history.", { example: '{"status": "ok", "message": "Found 12 jobs", "items": 12}' })}</li>
      <li><strong>{t("Job workflows:")}</strong> {t("send the jobs they find to the Job Radar: POST {url} with header X-Jobs-Secret and a body like {example}. Country lets advisors filter Spain, Mexico, Colombia, Venezuela or Argentina jobs.", { url: meta?.ingest_url || "/api/v1/integrations/jobs", example: '{"source": "n8n", "jobs": [{"title": "…", "company": "…", "country": "ES", "url": "…"}]}' })}
        {meta && !meta.ingest_ready && <span style={{ color: "var(--amber-ink)" }}> {t("(JOBS_INGEST_SECRET isn't set in Railway yet.)")}</span>}</li>
    </ol>
  </section>;
}

function RunModal({ a, meta, onClose, onDone }: { a: Auto; meta: Meta | null; onClose: () => void; onDone: () => void }) {
  const students = useApi<{ items: Opt[] }>(a.scope === "student" ? "/advisor/students" : null);
  const cohorts = useApi<Opt[]>(a.scope === "cohort" ? "/admin/cohorts" : null);
  const jobs = useApi<{ items: { id: string; title: string; company: string | null }[] }>(a.scope === "job" ? "/advisor/jobs?days=60" : null);
  const [target, setTarget] = useState("");
  const [params, setParams] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Run | null>(null);
  const opts: Opt[] = a.scope === "student" ? (students.data?.items || []) : a.scope === "cohort" ? (cohorts.data || [])
    : (jobs.data?.items || []).map((j) => ({ id: j.id, name: `${j.title}${j.company ? ` · ${j.company}` : ""}` }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      let p: Record<string, unknown> = {};
      if (params.trim()) {
        try { p = JSON.parse(params); } catch { p = { note: params.trim() }; }
      }
      const body: Record<string, unknown> = { params: p };
      if (a.scope !== "none") body[`${a.scope}_id`] = target;
      const r = await api.post<Run>(`/automations/${a.id}/run`, body);
      setResult(r); onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  if (result) return <Modal title={a.name} onClose={onClose}>
    {result.status === "ok" ? <div className="ok">{t("Sent to n8n. The workflow is running.")}</div>
      : <div className="err">{t("n8n didn't accept it ({code}). Check that the workflow is active and the Webhook URL is the Production one.", { code: result.http_status ?? t("no answer") })}</div>}
    {result.response && <pre className="cap" style={{ whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto", background: "var(--bg)", padding: 10, borderRadius: 8 }}>{result.response}</pre>}
    <button className="btn bp" onClick={onClose}>{t("Done")}</button></Modal>;
  return <Modal title={t("Run {name}", { name: a.name })} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      {a.description && <div className="cap">{a.description}</div>}
      {a.scope !== "none" && <div><label className="lb" htmlFor="rt">{t(meta?.scopes[a.scope] || a.scope)}</label>
        <select className="in" id="rt" required value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{t("Choose…")}</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>}
      <div><label className="lb" htmlFor="rp">{t("Extra details for the workflow (optional)")}</label>
        <textarea className="in" id="rp" rows={3} placeholder={t("A note, or JSON like {example}", { example: '{"country": "ES", "keywords": "AI engineer"}' })} value={params} onChange={(e) => setParams(e.target.value)} /></div>
      <ErrorBox error={err} />
      <button className="btn bp" disabled={busy}>{busy ? t("Sending…") : t("Run now")}</button>
    </form></Modal>;
}

function EditAuto({ a, meta, conns, onClose, onDone }: { a: Auto | null; meta: Meta | null; conns: Conn[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    name: a?.name || "", description: a?.description || "", category: a?.category || "", n8n_workflow_id: a?.n8n_workflow_id || "",
    link: a?.link || "", webhook_url: typeof a?.webhook_url === "string" ? a.webhook_url : "", events: a?.events || [] as string[],
    scope: a?.scope || "none", allow_advisors: a?.allow_advisors ?? true, active: a?.active ?? true, schedule_note: a?.schedule_note || "",
    connection_id: a?.connection_id || "",
  });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<Run | null>(null);
  const toast = useToast();
  const save = async (e?: FormEvent) => {
    e?.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = { ...f, connection_id: f.connection_id || null };
      if (a) await api.patch(`/automations/${a.id}`, body); else await api.post("/automations", body);
      toast(t("Saved")); onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const test = async () => {
    if (!a) return;
    setErr(null);
    try {
      await api.patch(`/automations/${a.id}`, { webhook_url: f.webhook_url });
      setTesting(await api.post<Run>(`/automations/${a.id}/run`, { test: true, params: { test: true } }));
    } catch (e) { setErr(e); }
  };
  const remove = async () => {
    if (!a || !window.confirm(t("Remove {name} from the hub? The workflow in n8n is not touched.", { name: a.name }))) return;
    await api.del(`/automations/${a.id}`); toast(t("Removed")); onDone();
  };
  const rotate = async () => {
    if (!a || !window.confirm(t("Make a new secret? Update it in the n8n workflow afterwards, or its callbacks will be rejected."))) return;
    await api.patch(`/automations/${a.id}`, { rotate_secret: true }); toast(t("New secret created")); onDone();
  };
  const copy = (v: string) => { navigator.clipboard?.writeText(v); toast(t("Copied")); };
  const toggle = (ev: string) => setF({ ...f, events: f.events.includes(ev) ? f.events.filter((x) => x !== ev) : [...f.events, ev] });
  return <Modal title={a ? t("Set up {name}", { name: a.name }) : t("Add workflow")} onClose={onClose}>
    <form className="stack" onSubmit={save}>
      <div><label className="lb" htmlFor="xn">{t("Name")}</label><input className="in" id="xn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><label className="lb" htmlFor="xd">{t("What it does")}</label><input className="in" id="xd" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label className="lb" htmlFor="xc">{t("Group")}</label><input className="in" id="xc" list="cats" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
          <datalist id="cats"><option value="Job market" /><option value="Outreach" /><option value="Students" /><option value="Reports" /></datalist></div>
        <div><label className="lb" htmlFor="xw">{t("n8n workflow ID")}</label><input className="in" id="xw" value={f.n8n_workflow_id} onChange={(e) => setF({ ...f, n8n_workflow_id: e.target.value, link: "" })} /></div>
      </div>
      <div><label className="lb" htmlFor="xu">{t("Webhook production URL (for Run and events)")}</label>
        <div style={{ display: "flex", gap: 8 }}><input className="in" id="xu" placeholder="https://n8n.4geeks.com/webhook/…" value={f.webhook_url} onChange={(e) => setF({ ...f, webhook_url: e.target.value })} />
          {a && f.webhook_url && <button type="button" className="btn bg sm" onClick={test}>{t("Test")}</button>}</div>
        {testing && <div className={testing.status === "ok" ? "ok" : "err"} style={{ marginTop: 6 }}>{testing.status === "ok" ? t("n8n answered {code}. It works.", { code: testing.http_status ?? "" }) : `${t("Failed")}: ${testing.response || testing.http_status}`}</div>}</div>
      <div><label className="lb" htmlFor="xs">{t("Run it with")}</label><select className="in" id="xs" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
        {Object.entries(meta?.scopes || { none: "Nothing (just start it)" }).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></div>
      <fieldset className="stack" style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, gap: 6 }}>
        <legend className="lb">{t("Also start it automatically when…")}</legend>
        {Object.entries(meta?.events || {}).map(([k, v]) => <label key={k} style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={f.events.includes(k)} onChange={() => toggle(k)} />{t(v)}</label>)}
      </fieldset>
      <div><label className="lb" htmlFor="xsn">{t("Schedule note")}</label><input className="in" id="xsn" placeholder={t("e.g. Every weekday 8:00 in n8n")} value={f.schedule_note} onChange={(e) => setF({ ...f, schedule_note: e.target.value })} /></div>
      {conns.length > 0 && <div><label className="lb" htmlFor="xcn">{t("n8n connection")}</label><select className="in" id="xcn" value={f.connection_id} onChange={(e) => setF({ ...f, connection_id: e.target.value })}>
        <option value="">{t("None")}</option>{conns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
      <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={f.allow_advisors} onChange={(e) => setF({ ...f, allow_advisors: e.target.checked })} />{t("Advisors can see and run it")}</label>
      <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />{t("Active")}</label>
      {a && <div className="stack" style={{ background: "var(--bg)", borderRadius: 12, padding: 12, gap: 6 }}>
        <div className="lb">{t("For the workflow's report back")}</div>
        <div className="cap">{t("Callback URL")}: <code style={{ wordBreak: "break-all" }}>{a.callback_url}</code> <button type="button" className="btn bg sm" onClick={() => copy(a.callback_url)}>{t("Copy")}</button></div>
        {a.secret && <div className="cap">X-GeekForce-Secret: <code>{a.secret.slice(0, 6)}…</code> <button type="button" className="btn bg sm" onClick={() => copy(a.secret!)}>{t("Copy")}</button> <button type="button" className="btn bg sm" onClick={rotate}>{t("New secret")}</button></div>}
      </div>}
      <ErrorBox error={err} />
      <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
        {a ? <button type="button" className="btn bd" onClick={remove}>{t("Remove")}</button> : <span />}
        <button className="btn bp" disabled={busy}>{t("Save")}</button></div>
    </form></Modal>;
}

function Connections({ conns, loading, reload }: { conns: Conn[]; loading: boolean; reload: () => void }) {
  const [f, setF] = useState({ name: "4Geeks n8n", base_url: "https://n8n.4geeks.com", api_key: "" });
  const [err, setErr] = useState<unknown>(null);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [wf, setWf] = useState<{ conn: string; items: Wf[] } | null>(null);
  const toast = useToast();
  const add = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await api.post("/automations/connections", f); setF({ ...f, api_key: "" }); reload(); toast(t("Connection saved")); } catch (e) { setErr(e); }
  };
  const test = async (c: Conn) => {
    const r = await api.post<{ ok: boolean; error?: string }>(`/automations/connections/${c.id}/test`);
    setStatus({ ...status, [c.id]: r.ok ? t("Connected") : r.error || t("Failed") });
  };
  const list = async (c: Conn) => {
    setErr(null);
    try { setWf({ conn: c.id, items: await api.get<Wf[]>(`/automations/connections/${c.id}/workflows`) }); } catch (e) { setErr(e); }
  };
  const sync = async (c: Conn) => {
    const r = await api.post<{ updated: number }>(`/automations/connections/${c.id}/sync`);
    toast(t("{n} workflows updated from n8n", { n: r.updated })); reload();
  };
  const register = async (w: Wf, c: string) => {
    await api.post("/automations", { name: w.name, n8n_workflow_id: w.id, link: w.link, webhook_url: w.webhook_url, connection_id: c, category: "n8n" });
    toast(t("{name} added", { name: w.name })); reload(); setWf(null);
  };
  const remove = async (c: Conn) => {
    if (!window.confirm(t("Remove this connection? The API key is deleted from the hub."))) return;
    await api.del(`/automations/connections/${c.id}`); reload();
  };
  return <>
    <section className="card stack">
      <h2 className="h2"><IPlug /> {t("n8n connection")}</h2>
      <div className="cap">{t("Optional. With an n8n API key the hub can list your workflows, find their Webhook URLs and show n8n executions. Create the key in n8n → Settings → n8n API. It's stored on the server and never shown again.")}</div>
      {loading ? <Spinner /> : conns.map((c) => <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        <div style={{ marginRight: "auto" }}><strong>{c.name}</strong><div className="cap">{c.base_url} · {c.has_api_key ? `${t("API key")} ${c.api_key_hint || ""}` : t("No API key")}{status[c.id] ? ` · ${status[c.id]}` : ""}</div></div>
        <button className="btn bg sm" onClick={() => test(c)}>{t("Test")}</button>
        <button className="btn bg sm" onClick={() => list(c)}>{t("Browse workflows")}</button>
        <button className="btn bg sm" onClick={() => sync(c)}>{t("Sync webhooks")}</button>
        <button className="btn bd sm" onClick={() => remove(c)}>{t("Remove")}</button></div>)}
      <form onSubmit={add} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1.4fr auto", gap: 8, alignItems: "end" }}>
        <div><label className="lb" htmlFor="cn">{t("Name")}</label><input className="in" id="cn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="lb" htmlFor="cu">{t("n8n URL")}</label><input className="in" id="cu" required value={f.base_url} onChange={(e) => setF({ ...f, base_url: e.target.value })} /></div>
        <div><label className="lb" htmlFor="ck">{t("API key")}</label><input className="in" id="ck" type="password" autoComplete="off" value={f.api_key} onChange={(e) => setF({ ...f, api_key: e.target.value })} /></div>
        <button className="btn bp">{t("Add")}</button>
      </form>
      <ErrorBox error={err} />
    </section>
    {wf && <section className="card stack">
      <h2 className="h2">{t("Workflows in n8n")} <span className="cap">· {wf.items.length}</span></h2>
      <div className="tw"><table><thead><tr><th>{t("Workflow")}</th><th>{t("Triggers")}</th><th></th></tr></thead>
        <tbody>{wf.items.map((w) => <tr key={w.id}><td><strong>{w.name}</strong> {w.active ? "" : <span className="cap">· {t("inactive")}</span>}<div className="cap"><a href={w.link} target="_blank" rel="noreferrer">{w.id} ↗</a></div></td>
          <td className="cap">{w.triggers.join(", ") || "—"}{w.webhook_url && <div>{t("Webhook ready")}</div>}</td>
          <td>{w.automation_id ? <span className="cap">{t("In the hub")}</span> : <button className="btn bg sm" onClick={() => register(w, wf.conn)}>{t("Add to hub")}</button>}</td></tr>)}</tbody></table></div>
    </section>}
  </>;
}
