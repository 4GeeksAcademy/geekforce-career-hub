import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { stageLabel } from "../lib/format";
import { ErrorBox, Modal, Spinner, useToast } from "../components/ui";
import { IPlus } from "../components/Icons";
import { t } from "../lib/i18n";

// ── types ──
type DS = { label: string; time_label: string; student_scoped: boolean; dimensions: Record<string, string>; metrics: Record<string, string> };
type Schema = { datasets: Record<string, DS>; buckets: string[] };
type Cfg = { dataset: string; metric: string; group_by?: string | null; split_by?: string | null; chart: Chart;
  filters?: Record<string, string[]>; range_days?: number | null; limit?: number | null };
type Chart = "number" | "bar" | "stacked" | "line" | "table";
type Widget = { id: string; title: string; config: Cfg; position: number; width: number };
type Dash = { id: string; name: string; description: string | null; shared: boolean; filters: Record<string, string | string[]>;
  mine: boolean; can_edit: boolean; widgets?: Widget[] };
type Row = { x?: string; series?: string; value: number };
type Result = { metric_label: string; rows: Row[]; total: number | null; group_by: string | null; split_by: string | null };

// Categorical slots, fixed order (validated palette, light surface). Color follows the entity, not the rank.
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const OTHER = "#9AA3AF";
// Known values get fixed slots so "Secured" is the same color on every widget.
const FIXED: Record<string, number> = { secured: 2, at_risk: 3, suspended: 7, not_eligible: 0, applied: 0, interested: 2,
  not_a_fit: 7, new: 0, Gained: 2, Lost: 7, attended: 2, absent: 7, rescheduled: 3 };

const VALUE_LABEL: Record<string, string> = {
  secured: "Secured", at_risk: "At risk", suspended: "Suspended", not_eligible: "Not eligible", active: "Active", hired: "Hired",
  withdrawn: "Withdrawn", onboarding: "Onboarding", not_to_be_placed: "Not to be placed", job_guarantee: "Job Guarantee",
  professional_support: "Professional Support", one_on_one: "1:1", group_workshop: "Group workshop", mock_interview: "Mock interview",
  not_a_fit: "Not a fit", full_stack: "Full Stack", ai_engineering: "AI Engineering", data_science: "Data Science",
  cybersecurity: "Cybersecurity", phone_screen: "Phone screen", usa: "USA", latam: "LATAM", spain: "Spain",
};
function valueLabel(dim: string | null | undefined, v: string | undefined): string {
  if (v == null) return "—";
  if (dim === "stage" && stageLabel[v]) return stageLabel[v];
  if (dim?.startsWith("time:")) return fmtBucket(v, dim.split(":")[1]);
  if (VALUE_LABEL[v]) return t(VALUE_LABEL[v]);
  if (/^[a-z_]+$/.test(v)) return t(v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " "));
  return v;
}
function fmtBucket(v: string, b: string) {
  const d = new Date(`${v}T12:00:00`);
  if (b === "month") return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const fmtNum = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString() : String(Math.round(n * 10) / 10));

function colorMap(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<number>();
  for (const k of keys) if (FIXED[k] != null) { out[k] = SERIES[FIXED[k]]; used.add(FIXED[k]); }
  const free = SERIES.map((_, i) => i).filter((i) => !used.has(i));
  [...keys].filter((k) => !out[k]).sort().forEach((k, i) => { out[k] = i < free.length ? SERIES[free[i]] : OTHER; });
  return out;
}

// ── page ──
const FILTER_DIMS = ["advisor", "cohort", "program", "stage", "plan", "guarantee"];

export default function Dashboards() {
  const schema = useApi<Schema>("/reports/schema");
  const list = useApi<Dash[]>("/dashboards");
  const [sel, setSel] = useState<string | null>(null);
  const id = sel || list.data?.[0]?.id || null;
  const dash = useApi<Dash>(id ? `/dashboards/${id}` : null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Widget | "new" | null>(null);
  const [newDash, setNewDash] = useState(false);
  const toast = useToast();
  const { user } = useAuth();

  useEffect(() => {
    const f = dash.data?.filters || {};
    setFilters(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  }, [dash.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dashFilters = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, v]) => v).map(([k, v]) =>
    [k, k.startsWith("date_") ? v : [v]])), [filters]);
  const saveFilters = async () => {
    if (!dash.data?.can_edit) return;
    await api.patch(`/dashboards/${dash.data.id}`, { filters: dashFilters }); toast(t("Filters saved as this dashboard's default"));
  };
  const d = dash.data;
  const widgets = [...(d?.widgets || [])].sort((a, b) => a.position - b.position);
  const move = async (w: Widget, dir: -1 | 1) => {
    const ids = widgets.map((x) => x.id); const i = ids.indexOf(w.id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api.patch(`/dashboards/${d!.id}`, { order: ids }); dash.reload();
  };
  const removeWidget = async (w: Widget) => {
    if (!window.confirm(t("Remove “{title}” from this dashboard?", { title: w.title }))) return;
    await api.del(`/dashboards/${d!.id}/widgets/${w.id}`); dash.reload();
  };
  const removeDash = async () => {
    if (!d || !window.confirm(t("Delete the dashboard “{name}”?", { name: d.name }))) return;
    await api.del(`/dashboards/${d.id}`); setSel(null); list.reload();
  };
  const toggleShare = async () => { await api.patch(`/dashboards/${d!.id}`, { shared: !d!.shared }); dash.reload(); list.reload(); };

  return (
    <>
      <header className="top"><div><div className="kick">{t("Manage")}</div><h1>{t("Dashboards")}</h1>
        <div className="sub">{t("Build charts from students, applications, points, sessions and jobs, and combine filters across all of them.")}</div></div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn bg" onClick={() => setNewDash(true)}>{t("New dashboard")}</button>
          {d?.can_edit && <button className="btn bp" onClick={() => setEditing("new")}><IPlus size={18} />{t("Add chart")}</button>}</div></header>
      <div className="content">
        {list.loading ? <Spinner /> : <div className="tabs" role="tablist">
          {list.data?.map((x) => <button key={x.id} role="tab" aria-selected={x.id === id} className={`tab${x.id === id ? " on" : ""}`} onClick={() => setSel(x.id)}>
            {x.name}{!x.mine && <span className="cap"> · {t("shared")}</span>}</button>)}</div>}
        {d && <>
          <div className="card" style={{ padding: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
            <div><label className="lb" htmlFor="df">{t("From")}</label><input className="in" id="df" type="date" value={filters.date_from || ""} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} /></div>
            <div><label className="lb" htmlFor="dt">{t("To")}</label><input className="in" id="dt" type="date" value={filters.date_to || ""} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} /></div>
            {FILTER_DIMS.filter((k) => user?.role === "admin" || k !== "advisor").map((k) =>
              <ValueSelect key={k} dim={k} label={schema.data?.datasets.students.dimensions[k] || k} value={filters[k] || ""} onChange={(v) => setFilters({ ...filters, [k]: v })} />)}
            <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
              {Object.values(filters).some(Boolean) && <button className="btn bg sm" onClick={() => setFilters({})}>{t("Clear")}</button>}
              {d.can_edit && <button className="btn bg sm" onClick={saveFilters}>{t("Save as default")}</button>}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {d.description && <div className="cap" style={{ marginRight: "auto" }}>{d.description}</div>}
            {d.can_edit && <><button className="btn bg sm" onClick={toggleShare}>{d.shared ? t("Shared with staff · stop sharing") : t("Share with all staff")}</button>
              <button className="btn bd sm" onClick={removeDash}>{t("Delete dashboard")}</button></>}
            {!d.can_edit && <span className="cap">{t("Shared by a colleague. Make a copy to change it.")}</span>}
          </div>
          {dash.loading ? <Spinner /> : <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16 }} className="dash-grid">
            {widgets.map((w, i) => <WidgetCard key={w.id} w={w} schema={schema.data} dashFilters={dashFilters}
              actions={d.can_edit ? <>
                <button className="btn bg sm" aria-label={t("Move earlier")} disabled={i === 0} onClick={() => move(w, -1)}>←</button>
                <button className="btn bg sm" aria-label={t("Move later")} disabled={i === widgets.length - 1} onClick={() => move(w, 1)}>→</button>
                <button className="btn bg sm" onClick={() => setEditing(w)}>{t("Edit")}</button>
                <button className="btn bg sm" aria-label={t("Remove")} onClick={() => removeWidget(w)}>×</button></> : null} />)}
            {widgets.length === 0 && <div className="card empty" style={{ gridColumn: "1 / -1" }}>{t("No charts yet. Use “Add chart”.")}</div>}
          </div>}
        </>}
        <ErrorBox error={list.error || dash.error} />
      </div>
      {editing && schema.data && d && <WidgetEditor schema={schema.data} w={editing === "new" ? null : editing} dashId={d.id} dashFilters={dashFilters}
        onClose={() => setEditing(null)} onDone={() => { setEditing(null); dash.reload(); }} />}
      {newDash && <NewDash current={d} onClose={() => setNewDash(false)} onDone={(nid) => { setNewDash(false); list.reload(); setSel(nid); }} />}
    </>);
}

function ValueSelect({ dim, label, value, onChange, dataset = "students" }: { dim: string; label: string; value: string; onChange: (v: string) => void; dataset?: string }) {
  const vals = useApi<string[]>(`/reports/values?dataset=${dataset}&dim=${dim}`);
  return <div><label className="lb" htmlFor={`f-${dim}`}>{t(label)}</label>
    <select className="in" id={`f-${dim}`} value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 130 }}>
      <option value="">{t("All")}</option>{vals.data?.map((v) => <option key={v} value={v}>{valueLabel(dim, v)}</option>)}</select></div>;
}

function useQuery(cfg: Cfg | null, dashFilters: Record<string, unknown>) {
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify([cfg, dashFilters]);
  useEffect(() => {
    if (!cfg?.dataset) return;
    let live = true; setLoading(true); setErr(null);
    api.post<Result>("/reports/query", { config: cfg, dashboard_filters: dashFilters })
      .then((r) => { if (live) setRes(r); }).catch((e) => { if (live) setErr(e); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { res, err, loading };
}

function WidgetCard({ w, schema, dashFilters, actions }: { w: Widget; schema: Schema | null; dashFilters: Record<string, unknown>; actions: ReactNode }) {
  const { res, err, loading } = useQuery(w.config, dashFilters);
  const [table, setTable] = useState(false);
  const [menu, setMenu] = useState(false);
  const ds = schema?.datasets[w.config.dataset];
  const span = Math.max(1, Math.min(4, w.width || 2));
  const sub = [ds && t(ds.label), w.config.range_days && !dashFilters.date_from ? t("last {n} days", { n: w.config.range_days }) : null].filter(Boolean).join(" · ");
  return <section className="card stack" style={{ gridColumn: `span ${span}`, padding: 18, gap: 10, minWidth: 0 }}>
    <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
      <div style={{ marginRight: "auto", minWidth: 0 }}><h3 style={{ margin: 0, fontSize: 15 }}>{w.title}</h3><div className="cap">{sub}</div></div>
      {actions && <div style={{ position: "relative", flex: "none" }}>
        <button className="btn bg sm" style={{ minHeight: 32, padding: "0 10px" }} aria-label={t("Chart options")} aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
        {menu && <div role="menu" onClick={() => setMenu(false)} style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 10, background: "#fff", border: "1px solid var(--line)",
          borderRadius: 12, boxShadow: "0 8px 24px rgba(14,27,44,.12)", padding: 8, display: "flex", gap: 6 }}>{actions}</div>}</div>}
    </div>
    {loading && !res ? <Spinner /> : err ? <ErrorBox error={err} /> : res ? <ChartView cfg={w.config} res={res} forceTable={table} /> : null}
    {w.config.chart !== "number" && w.config.chart !== "table" && res && res.rows.length > 0 &&
      <button className="cap" style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--blue-deep)", fontWeight: 600 }}
        onClick={() => setTable(!table)}>{table ? t("Show chart") : t("Show as table")}</button>}
  </section>;
}

// ── charts ──
function ChartView({ cfg, res, forceTable }: { cfg: Cfg; res: Result; forceTable?: boolean }) {
  const chart = forceTable ? "table" : cfg.chart;
  if (chart === "number" || (!res.group_by && !res.split_by)) {
    const v = res.total ?? res.rows.reduce((s, r) => s + (r.value || 0), 0);
    return <div><div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1, color: "var(--ink)" }}>{fmtNum(v)}</div><div className="cap">{res.metric_label && t(res.metric_label)}</div></div>;
  }
  if (!res.rows.length) return <div className="empty">{t("No data for these filters.")}</div>;
  if (chart === "table") return <DataTable res={res} />;
  if (chart === "line") return <LineChart res={res} />;
  return <BarChart res={res} stacked={chart === "stacked" || !!res.split_by} />;
}

function pivot(res: Result) {
  const xs: string[] = []; const ss: string[] = []; const m = new Map<string, Map<string, number>>();
  for (const r of res.rows) {
    const x = r.x ?? r.series ?? ""; const s = res.group_by ? (r.series ?? "") : "";
    if (!xs.includes(x)) xs.push(x);
    if (!ss.includes(s)) ss.push(s);
    if (!m.has(x)) m.set(x, new Map());
    m.get(x)!.set(s, (m.get(x)!.get(s) || 0) + (r.value || 0));
  }
  return { xs, ss, get: (x: string, s: string) => m.get(x)?.get(s) || 0 };
}

function Legend({ keys, colors, dim }: { keys: string[]; colors: Record<string, string>; dim: string | null }) {
  if (keys.length < 2) return null;
  return <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }} className="cap">
    {keys.map((k) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: colors[k] }} />{valueLabel(dim, k)}</span>)}</div>;
}

function Tip({ tip }: { tip: { x: number | string; y: number; html: ReactNode } | null }) {
  if (!tip) return null;
  return <div role="tooltip" style={{ position: "absolute", left: tip.x, top: tip.y, transform: "translate(-50%, calc(-100% - 10px))", background: "#fff",
    border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px", fontSize: 12, boxShadow: "0 6px 20px rgba(14,27,44,.12)",
    pointerEvents: "none", whiteSpace: "nowrap", zIndex: 5, color: "var(--ink)" }}>{tip.html}</div>;
}

function BarChart({ res }: { res: Result; stacked?: boolean }) {
  const { xs, ss, get } = pivot(res);
  const colors = colorMap(ss);
  const totals = xs.map((x) => ss.reduce((s, k) => s + Math.max(0, get(x, k)), 0));
  const negatives = xs.some((x) => ss.some((k) => get(x, k) < 0));
  const max = Math.max(1, ...totals, ...xs.map((x) => Math.max(...ss.map((k) => Math.abs(get(x, k))))));
  const [tip, setTip] = useState<{ x: number; y: number; html: ReactNode } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const show = (e: React.MouseEvent, html: ReactNode) => {
    const r = box.current!.getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: e.clientY - r.top, html });
  };
  const single = ss.length === 1 && !res.split_by;
  return <div ref={box} style={{ position: "relative" }} onMouseLeave={() => setTip(null)}>
    <div className="stack" style={{ gap: 6 }}>
      {xs.map((x, i) => {
        const label = valueLabel(res.group_by, x);
        const tipHtml = <><strong>{label}</strong>{ss.map((k) => <div key={k} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!single && <span style={{ width: 8, height: 8, borderRadius: 2, background: colors[k] }} />}
          {!single && <span>{valueLabel(res.split_by, k)}</span>}<span style={{ marginLeft: "auto", fontWeight: 700 }}>{fmtNum(get(x, k))}</span></div>)}</>;
        if (negatives && single) {
          const v = get(x, ss[0]); const pct = Math.abs(v) / max * 50;
          return <div key={x} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 32%) 1fr 48px", gap: 8, alignItems: "center", fontSize: 13 }}
            onMouseMove={(e) => show(e, tipHtml)}>
            <span title={label} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--body)" }}>{label}</span>
            <div style={{ position: "relative", height: 16 }}><div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "var(--line)" }} />
              <div style={{ position: "absolute", top: 2, height: 12, [v >= 0 ? "left" : "right"]: "50%", width: `${pct}%`, background: v >= 0 ? SERIES[2] : SERIES[7],
                borderRadius: v >= 0 ? "0 4px 4px 0" : "4px 0 0 4px" }} /></div>
            <span className="num" style={{ textAlign: "right", fontWeight: 700 }}>{fmtNum(v)}</span></div>;
        }
        return <div key={x} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 32%) 1fr 48px", gap: 8, alignItems: "center", fontSize: 13 }}
          onMouseMove={(e) => show(e, tipHtml)}>
          <span title={label} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--body)" }}>{label}</span>
          <div style={{ display: "flex", height: 14, gap: 2 }}>
            {ss.map((k, si) => {
              const v = Math.max(0, get(x, k)); if (!v) return null;
              const last = ss.slice(si + 1).every((kk) => !get(x, kk));
              return <div key={k} style={{ width: `${v / max * 100}%`, minWidth: 2, background: colors[k], borderRadius: last ? "0 4px 4px 0" : 0 }} />;
            })}</div>
          <span className="num" style={{ textAlign: "right", fontWeight: 700 }}>{fmtNum(totals[i])}</span></div>;
      })}
    </div>
    {!single && <div style={{ marginTop: 10 }}><Legend keys={ss} colors={colors} dim={res.split_by} /></div>}
    <Tip tip={tip} />
  </div>;
}

function LineChart({ res }: { res: Result }) {
  const { xs: raw, ss, get } = pivot(res);
  const xs = [...raw].sort();
  const colors = colorMap(ss);
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const H = 220, L = 40, R = 14, T = 10, B = 28;
  const max = Math.max(1, ...xs.flatMap((x) => ss.map((s) => get(x, s))));
  const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / p) * p; })();
  const X = (i: number) => L + (xs.length <= 1 ? (W - L - R) / 2 : i * (W - L - R) / (xs.length - 1));
  const Y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const onMove = (e: React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W;
    let best = 0; xs.forEach((_, i) => { if (Math.abs(X(i) - px) < Math.abs(X(best) - px)) best = i; }); setHover(best);
  };
  const ticks = [0, nice / 2, nice];
  const every = Math.max(1, Math.ceil(xs.length / Math.max(2, Math.floor(W / 90))));
  const single = ss.length === 1 && !res.split_by;
  return <div ref={wrap} style={{ position: "relative" }}>
    <svg ref={svg} width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", maxWidth: "100%" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img"
      aria-label={t("Line chart")}>
      {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#EEF1F5" />
        <text x={L - 6} y={Y(v) + 4} textAnchor="end" fontSize="11" fill="#5C6470">{fmtNum(v)}</text></g>)}
      {xs.map((x, i) => i % every === 0 && <text key={x} x={X(i)} y={H - 8} textAnchor={xs.length > 1 && i === xs.length - 1 ? "end" : i === 0 && xs.length > 1 ? "start" : "middle"} fontSize="11" fill="#5C6470">{valueLabel(res.group_by, x)}</text>)}
      {hover != null && <line x1={X(hover)} x2={X(hover)} y1={T} y2={H - B} stroke="#C9CFD8" strokeDasharray="3 3" />}
      {ss.map((s) => <g key={s}>
        <path d={xs.map((x, i) => `${i ? "L" : "M"}${X(i)},${Y(get(x, s))}`).join("")} fill="none" stroke={colors[s]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && <circle cx={X(hover)} cy={Y(get(xs[hover], s))} r="4.5" fill={colors[s]} stroke="#fff" strokeWidth="2" />}
        {xs.length === 1 && <circle cx={X(0)} cy={Y(get(xs[0], s))} r="4" fill={colors[s]} />}
      </g>)}
    </svg>
    {hover != null && <Tip tip={{ x: `${X(hover) / W * 100}%`, y: 10, html: <><strong>{valueLabel(res.group_by, xs[hover])}</strong>
      {ss.map((s) => <div key={s} style={{ display: "flex", gap: 8, alignItems: "center" }}>{!single && <span style={{ width: 8, height: 8, borderRadius: 2, background: colors[s] }} />}
        {!single && <span>{valueLabel(res.split_by, s)}</span>}<span style={{ marginLeft: "auto", fontWeight: 700 }}>{fmtNum(get(xs[hover], s))}</span></div>)}</> }} />}
    {!single && <div style={{ marginTop: 8 }}><Legend keys={ss} colors={colors} dim={res.split_by} /></div>}
  </div>;
}

function DataTable({ res }: { res: Result }) {
  const { xs, ss, get } = pivot(res);
  const single = ss.length === 1 && !res.split_by;
  return <div className="tw" style={{ maxHeight: 320, overflow: "auto" }}><table>
    <thead><tr><th></th>{single ? <th className="num">{t(res.metric_label)}</th> : ss.map((s) => <th key={s} className="num">{valueLabel(res.split_by, s)}</th>)}{!single && <th className="num">{t("Total")}</th>}</tr></thead>
    <tbody>{xs.map((x) => <tr key={x}><td>{valueLabel(res.group_by, x)}</td>{ss.map((s) => <td key={s} className="num">{fmtNum(get(x, s))}</td>)}
      {!single && <td className="num"><strong>{fmtNum(ss.reduce((a, s) => a + get(x, s), 0))}</strong></td>}</tr>)}</tbody></table></div>;
}

// ── editors ──
const CHARTS: [Chart, string][] = [["number", "Big number"], ["bar", "Bars"], ["stacked", "Stacked bars"], ["line", "Line over time"], ["table", "Table"]];

function WidgetEditor({ schema, w, dashId, dashFilters, onClose, onDone }: { schema: Schema; w: Widget | null; dashId: string; dashFilters: Record<string, unknown>;
  onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(w?.title || "");
  const [width, setWidth] = useState(w?.width || 2);
  const [cfg, setCfg] = useState<Cfg>(w?.config || { dataset: "applications", metric: "count", group_by: "app_status", chart: "bar", range_days: 90, filters: {} });
  const [err, setErr] = useState<unknown>(null);
  const ds = schema.datasets[cfg.dataset];
  const dims = Object.entries(ds.dimensions);
  const set = (p: Partial<Cfg>) => setCfg({ ...cfg, ...p });
  const timeGroup = (cfg.group_by || "").startsWith("time:");
  const autoTitle = `${t(ds.metrics[cfg.metric] || "")}${cfg.group_by ? ` ${t("by")} ${timeGroup ? t(cfg.group_by.split(":")[1]) : t(ds.dimensions[cfg.group_by] || "").toLowerCase()}` : ""}`;
  const [fdim, setFdim] = useState("");
  const filters = cfg.filters || {};
  const setChart = (c: Chart) => {
    const p: Partial<Cfg> = { chart: c };
    if (c === "number") { p.group_by = null; p.split_by = null; }
    if (c === "line" && !timeGroup) p.group_by = "time:week";
    if (c !== "line" && timeGroup) p.group_by = null;
    if ((c === "bar" || c === "stacked" || c === "table") && !cfg.group_by) p.group_by = dims[0][0];
    if (c === "bar") p.split_by = null;
    set(p);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try {
      const body = { title: title.trim() || autoTitle, width, config: cfg };
      if (w) await api.patch(`/dashboards/${dashId}/widgets/${w.id}`, body); else await api.post(`/dashboards/${dashId}/widgets`, body);
      onDone();
    } catch (e) { setErr(e); }
  };
  return <Modal title={w ? t("Edit chart") : t("Add chart")} onClose={onClose}>
    <form className="stack" onSubmit={save}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label className="lb" htmlFor="wd">{t("Data")}</label><select className="in" id="wd" value={cfg.dataset}
          onChange={(e) => { const nds = schema.datasets[e.target.value]; setCfg({ ...cfg, dataset: e.target.value, metric: Object.keys(nds.metrics)[0],
            group_by: cfg.chart === "line" ? "time:week" : cfg.chart === "number" ? null : Object.keys(nds.dimensions)[0], split_by: null, filters: {} }); }}>
          {Object.entries(schema.datasets).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}</select></div>
        <div><label className="lb" htmlFor="wm">{t("Measure")}</label><select className="in" id="wm" value={cfg.metric} onChange={(e) => set({ metric: e.target.value })}>
          {Object.entries(ds.metrics).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></div>
      </div>
      <div><div className="lb">{t("Chart")}</div><div className="seg">{CHARTS.map(([k, v]) => <button type="button" key={k} className={cfg.chart === k ? "on" : ""} onClick={() => setChart(k)}>{t(v)}</button>)}</div></div>
      {cfg.chart !== "number" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label className="lb" htmlFor="wg">{cfg.chart === "line" ? t("Over time, per") : t("Group by")}</label>
          <select className="in" id="wg" value={cfg.group_by || ""} onChange={(e) => set({ group_by: e.target.value || null })}>
            {cfg.chart === "line" ? schema.buckets.map((b) => <option key={b} value={`time:${b}`}>{t(b)} · {t(ds.time_label)}</option>)
              : dims.map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></div>
        {cfg.chart !== "bar" && <div><label className="lb" htmlFor="ws">{cfg.chart === "line" ? t("One line per") : t("Split by")}</label>
          <select className="in" id="ws" value={cfg.split_by || ""} onChange={(e) => set({ split_by: e.target.value || null })}>
            <option value="">{t("Nothing")}</option>{dims.filter(([k]) => k !== cfg.group_by).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></div>}
      </div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label className="lb" htmlFor="wr">{t("Time window")} ({t(ds.time_label).toLowerCase()})</label>
          <select className="in" id="wr" value={cfg.range_days || ""} onChange={(e) => set({ range_days: e.target.value ? Number(e.target.value) : null })}>
            <option value="">{t("All time")}</option>{[7, 30, 90, 120, 180, 365].map((n) => <option key={n} value={n}>{t("Last {n} days", { n })}</option>)}</select>
          <div className="cap" style={{ marginTop: 4 }}>{t("The dashboard's From/To dates replace this when set.")}</div></div>
        <div><label className="lb" htmlFor="ww">{t("Width")}</label><select className="in" id="ww" value={width} onChange={(e) => setWidth(Number(e.target.value))}>
          <option value={1}>{t("Quarter")}</option><option value={2}>{t("Half")}</option><option value={3}>{t("Three quarters")}</option><option value={4}>{t("Full")}</option></select></div>
      </div>
      <div className="stack" style={{ gap: 6 }}><div className="lb">{t("Only count…")}</div>
        {Object.entries(filters).map(([k, v]) => <div key={k} style={{ display: "flex", gap: 8, alignItems: "center" }} className="cap">
          <strong>{t(ds.dimensions[k] || k)}:</strong> {v.map((x) => valueLabel(k, x)).join(", ")}
          <button type="button" className="btn bg sm" onClick={() => { const f = { ...filters }; delete f[k]; set({ filters: f }); }}>×</button></div>)}
        <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <select className="in" style={{ width: 200 }} aria-label={t("Filter by")} value={fdim} onChange={(e) => setFdim(e.target.value)}>
            <option value="">{t("Add a filter…")}</option>{dims.map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select>
          {fdim && <ValueSelect key={fdim} dataset={cfg.dataset} dim={fdim} label={ds.dimensions[fdim]} value="" onChange={(val) => {
            if (!val) return; set({ filters: { ...filters, [fdim]: [...new Set([...(filters[fdim] || []), val])] } }); }} />}
        </div></div>
      <div><label className="lb" htmlFor="wt">{t("Title")}</label><input className="in" id="wt" placeholder={autoTitle} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="card" style={{ background: "var(--bg2)", padding: 14 }}>
        <div className="lb" style={{ marginBottom: 8 }}>{t("Preview")}</div><Preview cfg={cfg} dashFilters={dashFilters} /></div>
      <ErrorBox error={err} />
      <button className="btn bp">{t("Save chart")}</button>
    </form></Modal>;
}

function Preview({ cfg, dashFilters }: { cfg: Cfg; dashFilters: Record<string, unknown> }) {
  const { res, err, loading } = useQuery(cfg, dashFilters);
  if (loading && !res) return <Spinner />;
  if (err) return <ErrorBox error={err} />;
  return res ? <ChartView cfg={cfg} res={res} /> : null;
}

function NewDash({ current, onClose, onDone }: { current: Dash | null; onClose: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState("");
  const [copy, setCopy] = useState(false);
  const [shared, setShared] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { const d = await api.post<Dash>("/dashboards", { name, shared, copy_from: copy && current ? current.id : null }); onDone(d.id); } catch (e) { setErr(e); }
  };
  return <Modal title={t("New dashboard")} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div><label className="lb" htmlFor="nd">{t("Name")}</label><input className="in" id="nd" required value={name} onChange={(e) => setName(e.target.value)} /></div>
      {current && <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />{t("Start from a copy of “{name}”", { name: current.name })}</label>}
      <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />{t("Share with all staff")}</label>
      <ErrorBox error={err} />
      <button className="btn bp">{t("Create")}</button>
    </form></Modal>;
}
