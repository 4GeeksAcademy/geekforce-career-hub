import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { AUTOMATIONS, EDGES, type Automation, type Channel, type DNode, type Edge, type Risk, type Schedule, type Tx } from "../data/automations";
import { Modal } from "../components/ui";
import { IAlert, IArrow, ICal, ICheck, IPlug } from "../components/Icons";
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

// ── tooltips: where each automation runs, what each channel means, what each risk level means ──

/** Hover (or keyboard focus, when `focus`) shows `tip` under the element. */
function Tip({ tip, children, className = "", end, focus }: { tip: string; children: ReactNode; className?: string; end?: boolean; focus?: boolean }) {
  return <span className={`tip ${end ? "tip-end" : ""} ${className}`} data-tip={tip} tabIndex={focus ? 0 : undefined}>{children}</span>;
}

const PLATFORM: Record<Automation["platform"], { name: string; tip: string }> = {
  github: { name: "GitHub Actions", tip: "Runs on GitHub's servers, from the GF_Automations repository. It doesn't depend on Career Hub. Its schedule is set in UTC." },
  hub: { name: "Career Hub", tip: "Runs inside this app (Career Hub, on Railway). Its schedule follows Miami time. If the app is down, it doesn't run." },
};
const CH: Record<Channel, { name: string; tip: string }> = {
  slack: { name: "Slack", tip: "Posts a message in Slack." },
  email: { name: "Email", tip: "Sends an email." },
  inapp: { name: "In-app", tip: "Shows a notification inside Career Hub." },
  none: { name: "No messages", tip: "Doesn't message anyone: it only updates data." },
  activecampaign: { name: "ActiveCampaign", tip: "Updates the contact in ActiveCampaign, the email marketing tool." },
  webhook: { name: "n8n webhook", tip: "Hands the data to n8n, which sends the messages." },
};
const platformPill = (a: Automation, focus?: boolean) =>
  <Tip tip={t(PLATFORM[a.platform].tip)} focus={focus}><span className={`pill ${a.platform === "github" ? "pn" : "pb"}`}>{PLATFORM[a.platform].name}</span></Tip>;
const channelPill = (c: Channel, focus?: boolean) =>
  <Tip key={c} tip={t(CH[c].tip)} focus={focus}><span className="pill pg">{t(CH[c].name)}</span></Tip>;

function TriggerLine({ a }: { a: Automation }) {
  if (a.trigger.kind === "event") return <span><b>{t("When it happens:")}</b> {L(a.trigger.label)}</span>;
  const w = whenText(a.trigger.schedule);
  const after = a.trigger.after && BY_ID[a.trigger.after];
  return <span><b>{w.days}</b> · {after ? t("right after {name}", { name: L(after.name) }) : <>{w.spain} {t("Spain")} · {w.miami} {t("Miami")}</>}</span>;
}

function edgesOf(id: string) {
  return { out: EDGES.filter((e) => e.from === id), inc: EDGES.filter((e) => e.to === id) };
}

function SectionHead({ title, help, children }: { title: string; help: string; children?: ReactNode }) {
  return <div className="between"><div><h2 className="h2">{title}</h2><div className="cap sec-help">{help}</div></div>{children}</div>;
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
          <div className="stat s-blue"><div className="v">{AUTOMATIONS.length}</div><div className="l">{t("Automations")}</div><div className="c">{t("Everything that runs without anyone pressing a button")}</div></div>
          <Tip tip={t(PLATFORM.github.tip)} className="stat"><div className="v">{count("github")}</div><div className="l">GitHub Actions</div><div className="c">{t("Spain · repo GF_Automations")}</div></Tip>
          <Tip tip={t(PLATFORM.hub.tip)} className="stat" end><div className="v">{count("hub")}</div><div className="l">Career Hub</div><div className="c">{t("Miami · this app")}</div></Tip>
          <div className="stat s-cream"><div className="v">{EDGES.length}</div><div className="l">{t("Connections")}</div><div className="c">{t("Open a card to see them")}</div></div>
        </div>

        <Week onOpen={show} />

        <section className="stack">
          <SectionHead title={t("All automations")} help={t("Click one to open its card and its diagram. Hover the labels to see where it runs and how it sends messages.")}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label={t("Filter")}>
              {([["all", t("All")], ["github", "GitHub Actions"], ["hub", "Career Hub"]] as const).map(([k, l]) =>
                <button key={k} className={`chip ${filter === k ? "on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
            </div>
          </SectionHead>
          <div className="auto-grid">{list.map((a) => {
            const e = edgesOf(a.id);
            const risks = a.errors.filter((r) => r.level === "risk").length;
            const n = e.out.length + e.inc.length;
            return <div key={a.id} className="auto-card" role="button" tabIndex={0} onClick={() => show(a.id)}
              onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), show(a.id))}>
              <div className="between">{platformPill(a)}{risks > 0 &&
                <Tip end tip={t("Risks found when reading the code. Details in «If something fails».")}><span className="pill pa"><IAlert size={14} />{risks}</span></Tip>}</div>
              <div className="auto-name">{L(a.name)}</div>
              <div className="cap auto-short">{L(a.short)}</div>
              <div className="auto-meta"><ICal size={16} /><TriggerLine a={a} /></div>
              <div className="auto-foot">
                {a.channels.map((c) => channelPill(c))}
                {n > 0 && <Tip tip={t("Other automations it sends students to, runs with, or shares data with.")}>
                  <span className="pill pb"><IPlug size={12} />{n === 1 ? t("1 connection") : t("{n} connections", { n })}</span></Tip>}
              </div>
            </div>;
          })}</div>
        </section>
      </div>
      {open && BY_ID[open] && <Card key={open} a={BY_ID[open]} onClose={() => show(null)} onOpen={show} />}
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
    <SectionHead title={t("Weekly calendar")} help={t("When each scheduled automation runs during the week. Click one to open its card.")}>
      <div style={{ display: "flex", gap: 8 }} role="group" aria-label={t("Time zone")}>
        <button className={`chip ${tz === SPAIN ? "on" : ""}`} aria-pressed={tz === SPAIN} onClick={() => setTz(SPAIN)}>{t("Spain time")}</button>
        <button className={`chip ${tz === MIAMI ? "on" : ""}`} aria-pressed={tz === MIAMI} onClick={() => setTz(MIAMI)}>{t("Miami time")}</button>
      </div>
    </SectionHead>
    <div className="week-legend cap">
      <Tip tip={t(PLATFORM.github.tip)} focus><i className="wl github" />GitHub Actions</Tip>
      <Tip tip={t(PLATFORM.hub.tip)} focus><i className="wl hub" />Career Hub</Tip>
    </div>
    <div className="week">{[1, 2, 3, 4, 5, 6, 7].map((d) => (
      <div key={d} className="week-day">
        <div className="eyebrow">{dayName(d)}</div>
        {cells[d].map(({ a, time }) => <button key={a.id} className={`week-item ${a.platform}`} onClick={() => onOpen(a.id)}
          title={`${PLATFORM[a.platform].name} · ${L(a.short)}`}>
          <span className="num">{time}</span> {L(a.name)}</button>)}
      </div>))}</div>
    <div className="cap">{t("«+» runs right after the previous one. Times follow daylight saving for the current week.")}</div>
    {events.length > 0 && <div className="stack" style={{ gap: 8 }}>
      <div className="eyebrow">{t("Not on a schedule: they start when something happens")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{events.map((a) =>
        <button key={a.id} className="chip" onClick={() => onOpen(a.id)} title={`${PLATFORM[a.platform].name} · ${L(a.short)}`}>⚡ {L(a.name)}</button>)}</div>
    </div>}
  </section>;
}

// ── the card ("ficha") ──

const RISK: Record<Risk["level"], { cls: string; label: string; tip: string }> = {
  ok: { cls: "r-ok", label: "Handled", tip: "The automation already handles this case." },
  warn: { cls: "r-warn", label: "Watch", tip: "Not broken, but worth keeping an eye on." },
  risk: { cls: "r-risk", label: "Risk", tip: "It can fail or do the wrong thing today. Found when reading the code." },
};
const EDGE_OUT: Record<Edge["kind"], string> = { feeds: "Sends students to", runs_before: "Runs before", data: "Affects data of", similar: "Similar to" };
const EDGE_IN: Record<Edge["kind"], string> = { feeds: "Receives students from", runs_before: "Runs after", data: "Its data is affected by", similar: "Similar to" };

type SecDef = { id: string; title: string; help: string; body: ReactNode };

function Card({ a, onClose, onOpen }: { a: Automation; onClose: () => void; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<"card" | "diagram">("card");
  const scroller = useRef<HTMLDivElement>(null);
  const jumping = useRef<number | null>(null);
  const e = edgesOf(a.id);

  const secs: SecDef[] = [
    { id: "what", title: t("What it does"), help: t("The job it does, in plain words."), body: <p>{L(a.what)}</p> },
    { id: "start", title: t("What starts it"), help: t("The schedule or the event that makes it run, and how to run it by hand."), body: <>
      <div className="auto-meta"><ICal size={16} /><TriggerLine a={a} /></div>
      {a.trigger.kind === "schedule" && a.trigger.schedule.tz === "UTC" && <div className="cap">{t("GitHub schedule: {time} UTC.", { time: a.trigger.schedule.time })}</div>}
      {a.manual && <div className="cap"><b>{t("By hand:")}</b> {L(a.manual)}</div>}</> },
    { id: "who", title: t("Who it affects"), help: t("The people it looks at each time it runs."), body: <ul className="ticks">{a.audience.map((x, i) => <li key={i}>{L(x)}</li>)}</ul> },
    ...(a.rules ? [{ id: "rules", title: t("Rules"), help: t("How it decides what to do with each person. Read each row as «if this, then that». The tag is the label it leaves in Notion."), body:
      <div className="tw"><table className="rules"><thead><tr><th>{t("If…")}</th><th>{t("Then…")}</th><th>{t("Tag")}</th></tr></thead>
        <tbody>{a.rules.map((r, i) => <tr key={i}><td>{L(r.when)}</td><td>{L(r.then)}</td><td>{r.tag ? <code>{r.tag}</code> : "—"}</td></tr>)}</tbody></table></div> }] : []),
    { id: "changes", title: t("What it changes"), help: t("The data it writes and the messages it sends."), body: <ul className="ticks">{a.writes.map((x, i) => <li key={i}>{L(x)}</li>)}</ul> },
    { id: "fails", title: t("If something fails"), help: t("What happens when a step goes wrong. Hover each label to see what it means."), body:
      <div className="stack" style={{ gap: 8 }}>{a.errors.map((r, i) => <div key={i} className={`risk ${RISK[r.level].cls}`}>
        <Tip tip={t(RISK[r.level].tip)} focus><span className="risk-tag">{r.level === "ok" ? <ICheck size={14} /> : <IAlert size={14} />}{t(RISK[r.level].label)}</span></Tip>
        <span>{L(r.text)}</span></div>)}</div> },
    { id: "links", title: t("Connections"), help: t("Other automations that send it students, run before or after it, or touch the same data. Click one to open its card."), body:
      e.out.length + e.inc.length === 0 ? <div className="cap">{t("It doesn't connect to other automations.")}</div> :
        <div className="edges">
          {e.out.map((x, i) => <EdgeRow key={`o${i}`} verb={t(EDGE_OUT[x.kind])} other={x.to} label={x.label} onOpen={onOpen} />)}
          {e.inc.map((x, i) => <EdgeRow key={`i${i}`} verb={t(EDGE_IN[x.kind])} other={x.from} label={x.label} onOpen={onOpen} />)}
        </div> },
    ...(a.notes ? [{ id: "notes", title: t("Good to know"), help: t("Details and quirks found when reading the code."), body: <ul className="ticks">{a.notes.map((x, i) => <li key={i}>{L(x)}</li>)}</ul> }] : []),
    { id: "where", title: t("Where it lives"), help: t("Where the code is, for whoever needs to change it."), body: <>
      <div className="cap">{a.source.url ? <a href={a.source.url} target="_blank" rel="noopener noreferrer">{a.source.repo}</a> : a.source.repo}
        {" · "}{a.source.files.map((f, i) => <span key={f}>{i > 0 && ", "}<code>{f}</code></span>)}</div>
      <div className="cap">{t("Last run and live status: coming in phase 3.")}</div></> },
  ];
  const [active, setActive] = useState(secs[0].id);
  const index = useRef<HTMLElement>(null);
  // on narrow screens the index scrolls sideways: keep the current section's chip in view
  useEffect(() => {
    const nav = index.current, chip = nav?.querySelector<HTMLElement>("[aria-current]");
    if (nav && chip) nav.scrollTo({ left: chip.offsetLeft - nav.clientWidth / 2 + chip.clientWidth / 2, behavior: "smooth" });
  }, [active]);

  // highlight the section being read; at the bottom, the last one
  const onScroll = () => {
    const el = scroller.current;
    if (!el || tab !== "card" || jumping.current !== null) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-sec]"));
    let cur = items[0]?.dataset.sec;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) cur = items[items.length - 1]?.dataset.sec;
    else for (const it of items) if (it.offsetTop <= el.scrollTop + 40) cur = it.dataset.sec;
    if (cur) setActive(cur);
  };
  const jump = (id: string) => {
    const el = scroller.current;
    const target = el?.querySelector<HTMLElement>(`[data-sec="${id}"]`);
    if (!el || !target) return;
    setActive(id);
    if (jumping.current !== null) window.clearTimeout(jumping.current);
    jumping.current = window.setTimeout(() => { jumping.current = null; }, 700);
    el.scrollTo({ top: target.offsetTop - 4, behavior: "smooth" });
  };
  const switchTab = (k: "card" | "diagram") => { setTab(k); scroller.current?.scrollTo({ top: 0 }); };

  return <Modal title={L(a.name)} onClose={onClose} wide>
    <div className="ficha-top">
      <div className="ficha-where">
        <span className="cap"><b>{t("Where it runs:")}</b></span>{platformPill(a, true)}
        <span className="cap">{t("Sends:")}</span>{a.channels.map((c) => channelPill(c, true))}
      </div>
      <p className="ficha-short">{L(a.short)}</p>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "card"} className={`tab ${tab === "card" ? "on" : ""}`} onClick={() => switchTab("card")}>{t("Card")}</button>
        <button role="tab" aria-selected={tab === "diagram"} className={`tab ${tab === "diagram" ? "on" : ""}`} onClick={() => switchTab("diagram")}>{t("Diagram")}</button>
      </div>
      {tab === "card" ? <nav className="ficha-index" ref={index} aria-label={t("Sections")}>
        {secs.map((s) => <button key={s.id} className={`chip ${active === s.id ? "on" : ""}`} aria-current={active === s.id ? "true" : undefined} onClick={() => jump(s.id)}>{s.title}</button>)}
      </nav> : <div className="cap ficha-help">{t("Read it from top to bottom. Amber boxes are decisions: each branch shows what happens in that case. Blue boxes open another automation.")}</div>}
    </div>
    <div className="ficha-scroll" ref={scroller} onScroll={onScroll}>
      {tab === "diagram" ? <Diagram nodes={a.diagram} onOpen={onOpen} /> : <div className="ficha">
        {secs.map((s) => <section key={s.id} className="ficha-sec" data-sec={s.id}>
          <div><h3 className="eyebrow">{s.title}</h3><div className="cap sec-help">{s.help}</div></div>
          {s.body}
        </section>)}
      </div>}
    </div>
  </Modal>;
}

function EdgeRow({ verb, other, label, onOpen }: { verb: string; other: string; label: Tx; onOpen: (id: string) => void }) {
  const o = BY_ID[other];
  return <div className="edge"><div><span className="cap">{verb}</span> <button className="linkbtn" onClick={() => onOpen(other)}>{L(o.name)}</button>
    {" "}<span className={`pill ${o.platform === "github" ? "pn" : "pb"} pill-sm`}>{PLATFORM[o.platform].name}</span></div>
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
  if (n.t === "link") return <button className="fnode link" onClick={() => onOpen(n.to)} title={t("Open its card")}>
    <span>{L(n.label)}</span><span className="fsub"><IArrow size={14} /> {L(BY_ID[n.to].name)}</span></button>;
  if (n.t === "step") return <div className="fnode step">{n.kind && <span className="fsub">{t(KIND_LABEL[n.kind])}</span>}{L(n.label)}</div>;
  return <div className={`fnode ${n.t}`}>{L(n.label)}</div>;
}
