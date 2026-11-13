import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { AUTOMATIONS, CHAINS, EDGES, type Automation, type Channel, type DNode, type Edge, type Risk, type Schedule, type Tx } from "../data/automations";
import { Modal } from "../components/ui";
import { IAlert, IArrow, ICal, ICheck } from "../components/Icons";
import { lang, locale, t } from "../lib/i18n";

/** Read-only catalog of every automation in the area (admins and advisors). Content: src/data/automations.ts */

const L = (x: Tx) => x[lang()];
const BY_ID = Object.fromEntries(AUTOMATIONS.map((a) => [a.id, a]));
const SPAIN = "Europe/Madrid";
const MIAMI = "America/New_York";

// ── time zones: show every schedule in Spain and Miami time, correct for daylight saving on the current week ──

function offsetMin(at: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - at.getTime()) / 60000;
}
/** The instant when it's `hh:mm` on ISO weekday `day` (1 = Mon) of the current week, in `tz`. */
function instant(day: number, hhmm: string, tz: string) {
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  const [h, m] = hhmm.split(":").map(Number);
  const guess = Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + day - 1, h, m);
  return new Date(guess - (tz === "UTC" ? 0 : offsetMin(new Date(guess), tz)) * 60000);
}
const hm = (d: Date, tz: string) => new Intl.DateTimeFormat(locale(), { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const isoDay = (d: Date, tz: string) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d)) + 1;
const dayName = (n: number) => {
  const s = new Intl.DateTimeFormat(locale(), { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, n)));  // Jan 1 2024 is a Monday
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function whenText(s: Schedule) {
  const days = s.days.length === 7 ? t("Every day") : s.days.map((d) => dayName(d)).join(", ");
  const at = instant(s.days[0], s.time, s.tz);
  return { days, spain: hm(at, SPAIN), miami: hm(at, MIAMI) };
}

const CH: Record<Channel, string> = { slack: "Slack", email: "Email", inapp: "In-app", none: "No messages", activecampaign: "ActiveCampaign", webhook: "n8n webhook" };
const platformPill = (a: Automation) => <span className={`pill ${a.platform === "github" ? "pn" : "pb"}`}>{a.platform === "github" ? "GitHub Actions" : "Career Hub"}</span>;

function TriggerLine({ a }: { a: Automation }) {
  if (a.trigger.kind === "event") return <span><b>{t("When it happens:")}</b> {L(a.trigger.label)}</span>;
  const w = whenText(a.trigger.schedule);
  const after = a.trigger.after && BY_ID[a.trigger.after];
  return <span><b>{w.days}</b> · {after ? t("right after {name}", { name: L(after.name) }) : <>{w.spain} {t("Spain")} · {w.miami} {t("Miami")}</>}</span>;
}

function edgesOf(id: string) {
  return { out: EDGES.filter((e) => e.from === id), inc: EDGES.filter((e) => e.to === id) };
}

export default function Automations() {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<"all" | "github" | "hub">("all");
  const open = params.get("a");
  const show = (id: string | null) => setParams(id ? { a: id } : {}, { replace: !!open && !!id });
  const list = AUTOMATIONS.filter((a) => filter === "all" || a.platform === filter);
  const count = (p: "github" | "hub") => AUTOMATIONS.filter((a) => a.platform === p).length;

  return (
    <>
      <header className="top"><div><div className="kick">{t("Manage")}</div>
        <h1>{t("Automations")} <em>{t("explained.")}</em></h1>
        <div className="sub">{t("What runs on its own in GeekForce: when it starts, what it does, how it handles errors and what it connects to.")}</div></div></header>
      <div className="content">
        <div className="stats">
          <div className="stat s-blue"><div className="v">{AUTOMATIONS.length}</div><div className="l">{t("Automations")}</div></div>
          <div className="stat"><div className="v">{count("github")}</div><div className="l">GitHub Actions</div><div className="c">{t("Spain · repo GF_Automations")}</div></div>
          <div className="stat"><div className="v">{count("hub")}</div><div className="l">Career Hub</div><div className="c">{t("Miami · this app")}</div></div>
          <div className="stat s-cream"><div className="v">{EDGES.length}</div><div className="l">{t("Connections")}</div></div>
        </div>

        <Week onOpen={show} />

        <section className="card stack">
          <h2 className="h2">{t("How they connect")}</h2>
          <div className="chains">{CHAINS.map((c) => (
            <div key={c.ids.join()} className="chain">
              <div className="eyebrow">{L(c.title)}</div>
              <div className="chain-row">{c.ids.map((id, i) => <span key={id} className="chain-step">
                {i > 0 && <IArrow size={16} />}<button className="chip" onClick={() => show(id)}>{L(BY_ID[id].name)}</button></span>)}</div>
            </div>))}</div>
        </section>

        <section className="stack">
          <div className="between">
            <h2 className="h2">{t("All automations")}</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label={t("Filter")}>
              {([["all", t("All")], ["github", "GitHub Actions"], ["hub", "Career Hub"]] as const).map(([k, l]) =>
                <button key={k} className={`chip ${filter === k ? "on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
            </div>
          </div>
          <div className="auto-grid">{list.map((a) => {
            const e = edgesOf(a.id);
            const risks = a.errors.filter((r) => r.level === "risk").length;
            return <button key={a.id} className="auto-card" onClick={() => show(a.id)}>
              <div className="between">{platformPill(a)}{risks > 0 && <span className="pill pa"><IAlert size={14} />{risks}</span>}</div>
              <div className="auto-name">{L(a.name)}</div>
              <div className="cap auto-short">{L(a.short)}</div>
              <div className="auto-meta"><ICal size={16} /><TriggerLine a={a} /></div>
              <div className="auto-foot">
                {a.channels.map((c) => <span key={c} className="pill pg">{t(CH[c])}</span>)}
                {e.out.length + e.inc.length > 0 && <span className="pill pb">{e.out.length + e.inc.length === 1 ? t("1 connection") : t("{n} connections", { n: e.out.length + e.inc.length })}</span>}
              </div>
            </button>;
          })}</div>
        </section>
      </div>
      {open && BY_ID[open] && <Card a={BY_ID[open]} onClose={() => show(null)} onOpen={show} />}
    </>);
}

/** Weekly calendar of scheduled automations, in Spain or Miami time. */
function Week({ onOpen }: { onOpen: (id: string) => void }) {
  const [tz, setTz] = useState<typeof SPAIN | typeof MIAMI>(SPAIN);
  const cells = useMemo(() => {
    const out: Record<number, { a: Automation; time: string; sort: number }[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
    for (const a of AUTOMATIONS) {
      if (a.trigger.kind !== "schedule") continue;
      const s = a.trigger.schedule;
      for (const d of s.days) {
        const at = instant(d, s.time, s.tz);
        const local = hm(at, tz);
        out[isoDay(at, tz)].push({ a, time: a.trigger.after ? `${local}+` : local, sort: Number(local.replace(":", "")) + (a.trigger.after ? 0.5 : 0) });
      }
    }
    Object.values(out).forEach((v) => v.sort((p, q) => p.sort - q.sort));
    return out;
  }, [tz]);
  const events = AUTOMATIONS.filter((a) => a.trigger.kind === "event");
  return <section className="card stack">
    <div className="between">
      <h2 className="h2">{t("Weekly calendar")}</h2>
      <div style={{ display: "flex", gap: 8 }} role="group" aria-label={t("Time zone")}>
        <button className={`chip ${tz === SPAIN ? "on" : ""}`} aria-pressed={tz === SPAIN} onClick={() => setTz(SPAIN)}>{t("Spain time")}</button>
        <button className={`chip ${tz === MIAMI ? "on" : ""}`} aria-pressed={tz === MIAMI} onClick={() => setTz(MIAMI)}>{t("Miami time")}</button>
      </div>
    </div>
    <div className="week">{[1, 2, 3, 4, 5, 6, 7].map((d) => (
      <div key={d} className="week-day">
        <div className="eyebrow">{dayName(d)}</div>
        {cells[d].map(({ a, time }) => <button key={a.id} className={`week-item ${a.platform}`} onClick={() => onOpen(a.id)}>
          <span className="num">{time}</span> {L(a.name)}</button>)}
      </div>))}</div>
    <div className="cap">{t("«+» runs right after the previous one. Times follow daylight saving for the current week.")}</div>
    {events.length > 0 && <div className="stack" style={{ gap: 8 }}>
      <div className="eyebrow">{t("Not on a schedule: they start when something happens")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{events.map((a) =>
        <button key={a.id} className="chip" onClick={() => onOpen(a.id)}>⚡ {L(a.name)}</button>)}</div>
    </div>}
  </section>;
}

// ── the card ("ficha") ──

function Sec({ title, children }: { title: string; children: ReactNode }) {
  return <section className="ficha-sec"><h3 className="eyebrow">{title}</h3>{children}</section>;
}

const RISK: Record<Risk["level"], { cls: string; label: string }> = {
  ok: { cls: "r-ok", label: "Handled" },
  warn: { cls: "r-warn", label: "Watch" },
  risk: { cls: "r-risk", label: "Risk" },
};
const EDGE_OUT: Record<Edge["kind"], string> = { feeds: "Sends students to", runs_before: "Runs before", data: "Affects data of", similar: "Similar to" };
const EDGE_IN: Record<Edge["kind"], string> = { feeds: "Receives students from", runs_before: "Runs after", data: "Its data is affected by", similar: "Similar to" };

function Card({ a, onClose, onOpen }: { a: Automation; onClose: () => void; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<"card" | "diagram">("card");
  const e = edgesOf(a.id);
  return <Modal title={L(a.name)} onClose={onClose} wide>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{platformPill(a)}{a.channels.map((c) => <span key={c} className="pill pg">{t(CH[c])}</span>)}</div>
    <p style={{ fontSize: 15 }}>{L(a.short)}</p>
    <div className="tabs" role="tablist">
      <button role="tab" aria-selected={tab === "card"} className={`tab ${tab === "card" ? "on" : ""}`} onClick={() => setTab("card")}>{t("Card")}</button>
      <button role="tab" aria-selected={tab === "diagram"} className={`tab ${tab === "diagram" ? "on" : ""}`} onClick={() => setTab("diagram")}>{t("Diagram")}</button>
    </div>
    {tab === "diagram" ? <Diagram nodes={a.diagram} onOpen={onOpen} /> : <div className="ficha">
      <Sec title={t("What it does")}><p>{L(a.what)}</p></Sec>
      <Sec title={t("What starts it")}>
        <div className="auto-meta"><ICal size={16} /><TriggerLine a={a} /></div>
        {a.trigger.kind === "schedule" && a.trigger.schedule.tz === "UTC" && <div className="cap">{t("GitHub schedule: {time} UTC.", { time: a.trigger.schedule.time })}</div>}
        {a.manual && <div className="cap"><b>{t("By hand:")}</b> {L(a.manual)}</div>}
      </Sec>
      <Sec title={t("Who it affects")}><ul className="ticks">{a.audience.map((x, i) => <li key={i}>{L(x)}</li>)}</ul></Sec>
      {a.rules && <Sec title={t("Rules")}>
        <div className="tw"><table className="rules"><thead><tr><th>{t("If…")}</th><th>{t("Then…")}</th><th>{t("Tag")}</th></tr></thead>
          <tbody>{a.rules.map((r, i) => <tr key={i}><td>{L(r.when)}</td><td>{L(r.then)}</td><td>{r.tag ? <code>{r.tag}</code> : "—"}</td></tr>)}</tbody></table></div>
      </Sec>}
      <Sec title={t("What it changes")}><ul className="ticks">{a.writes.map((x, i) => <li key={i}>{L(x)}</li>)}</ul></Sec>
      <Sec title={t("If something fails")}>
        <div className="stack" style={{ gap: 8 }}>{a.errors.map((r, i) => <div key={i} className={`risk ${RISK[r.level].cls}`}>
          <span className="risk-tag">{r.level === "ok" ? <ICheck size={14} /> : <IAlert size={14} />}{t(RISK[r.level].label)}</span><span>{L(r.text)}</span></div>)}</div>
      </Sec>
      <Sec title={t("Connections")}>
        {e.out.length + e.inc.length === 0 ? <div className="cap">{t("It doesn't connect to other automations.")}</div> :
          <div className="stack" style={{ gap: 8 }}>
            {e.out.map((x, i) => <EdgeRow key={`o${i}`} verb={t(EDGE_OUT[x.kind])} other={x.to} label={x.label} onOpen={onOpen} />)}
            {e.inc.map((x, i) => <EdgeRow key={`i${i}`} verb={t(EDGE_IN[x.kind])} other={x.from} label={x.label} onOpen={onOpen} />)}
          </div>}
      </Sec>
      {a.notes && <Sec title={t("Good to know")}><ul className="ticks">{a.notes.map((x, i) => <li key={i}>{L(x)}</li>)}</ul></Sec>}
      <Sec title={t("Where it lives")}>
        <div className="cap">{a.source.url ? <a href={a.source.url} target="_blank" rel="noopener noreferrer">{a.source.repo}</a> : a.source.repo}
          {" · "}{a.source.files.map((f, i) => <span key={f}>{i > 0 && ", "}<code>{f}</code></span>)}</div>
        <div className="cap">{t("Last run and live status: coming in phase 3.")}</div>
      </Sec>
    </div>}
  </Modal>;
}

function EdgeRow({ verb, other, label, onOpen }: { verb: string; other: string; label: Tx; onOpen: (id: string) => void }) {
  const o = BY_ID[other];
  return <div className="edge"><div><span className="cap">{verb}</span> <button className="linkbtn" onClick={() => onOpen(other)}>{L(o.name)}</button></div>
    <div className="cap">{L(label)}</div></div>;
}

// ── the diagram ──

const KIND_LABEL: Record<string, string> = { read: "Reads", write: "Writes", send: "Sends", calc: "Calculates" };

function Diagram({ nodes, onOpen }: { nodes: DNode[]; onOpen: (id: string) => void }) {
  return <div className="stack">
    <div className="flow-legend cap">
      <span><i className="lg start" />{t("Start")}</span><span><i className="lg step" />{t("Step")}</span><span><i className="lg decision" />{t("Decision")}</span>
      <span><i className="lg link" />{t("Another automation")}</span><span><i className="lg error" />{t("If it fails")}</span><span><i className="lg end" />{t("End")}</span>
    </div>
    <div className="flow-wrap"><Flow nodes={nodes} onOpen={onOpen} /></div>
  </div>;
}

function Flow({ nodes, onOpen }: { nodes: DNode[]; onOpen: (id: string) => void }) {
  return <div className="flow">{nodes.map((n, i) => <div key={i} className="flow-item">
    {i > 0 && <div className="farrow" aria-hidden="true" />}
    <FNode n={n} onOpen={onOpen} />
  </div>)}</div>;
}

function FNode({ n, onOpen }: { n: DNode; onOpen: (id: string) => void }) {
  if (n.t === "decision") return <div className="fdecision">
    <div className="fnode decision">{L(n.label)}</div>
    <div className="fbranches">{n.branches.map((b, i) => <div key={i} className="fbranch">
      <div className="farrow" aria-hidden="true" />
      <span className="fblabel">{L(b.label)}</span>
      <Flow nodes={b.nodes} onOpen={onOpen} />
    </div>)}</div>
  </div>;
  if (n.t === "link") return <button className="fnode link" onClick={() => onOpen(n.to)}>
    <span>{L(n.label)}</span><span className="fsub"><IArrow size={14} /> {L(BY_ID[n.to].name)}</span></button>;
  if (n.t === "step") return <div className="fnode step">{n.kind && <span className="fsub">{t(KIND_LABEL[n.kind])}</span>}{L(n.label)}</div>;
  return <div className={`fnode ${n.t}`}>{L(n.label)}</div>;
}
