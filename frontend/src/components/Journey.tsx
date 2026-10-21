import { useState } from "react";
import { api } from "../lib/api";
import { relTime } from "../lib/format";
import { ErrorBox, Modal } from "./ui";

export type JourneyItem = { label: string; done: boolean; how: string };
export type JourneyStage = { key: string; label: string; state: "done" | "current" | "next"; items: JourneyItem[]; done_count: number; total: number };
export type Journey = { current: string; label: string; next: string | null; next_label: string | null; ready_for_next: boolean;
  changed_at: string | null; next_steps: string | null; stages: JourneyStage[] };

const NUM: Record<string, string> = { not_started: "0", profile: "1", interview_prep: "2", job_hunting: "3", placed: "★" };
const SHORT: Record<string, [string, string]> = {
  not_started: ["Start", "First 1:1"], profile: ["Stage 1", "Profile"], interview_prep: ["Stage 2", "Interview prep"],
  job_hunting: ["Stage 3", "Job hunting"], placed: ["Placed", "Hired"],
};

/** The GeekForce journey: three stages between "not started" and "placed", each with its checklist. */
export function JourneyTracker({ j, studentId, editable, first, onChanged }: {
  j: Journey; studentId?: string; editable?: boolean; first?: string; onChanged?: (m: string) => void }) {
  const [moving, setMoving] = useState<string | null>(null);
  const cur = j.stages.find((s) => s.state === "current");
  return (
    <section className="card stack" style={{ gap: 18 }} aria-label="Stages">
      <div className="between">
        <div><div className="eyebrow">GeekForce journey</div>
          <h2 className="h2" style={{ marginTop: 2 }}>{j.current === "placed" ? <>Placed. <em>Congratulations.</em></> : <>Now in <em>{j.label}</em></>}</h2>
          {j.changed_at && <div className="cap">Since {relTime(j.changed_at)}</div>}</div>
        {editable && j.next && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className={`btn ${j.ready_for_next ? "by" : "bg"} sm`} onClick={() => setMoving(j.next!)}>Move to {j.next_label}</button>
          <label><span className="sr">Change stage</span><select className="in" style={{ minHeight: 38 }} value="" onChange={(e) => e.target.value && setMoving(e.target.value)}>
            <option value="">Change stage…</option>{j.stages.filter((s) => s.key !== j.current).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
        </div>}
      </div>

      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: `repeat(${j.stages.length}, minmax(0,1fr))`, gap: 8 }}>
        {j.stages.map((s, i) => {
          const done = s.state === "done", now = s.state === "current";
          return <li key={s.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, position: "relative", textAlign: "center" }}>
            {i > 0 && <span aria-hidden style={{ position: "absolute", top: 17, right: "50%", width: "100%", height: 3, borderRadius: 2,
              background: done || now ? "var(--blue-deep)" : "var(--line)", zIndex: 0 }} />}
            <span style={{ position: "relative", zIndex: 1, width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, fontSize: 14, background: now ? "var(--amber)" : done ? "var(--blue-deep)" : "#fff", color: done ? "#fff" : "var(--ink)",
              border: now || done ? "none" : "2px solid var(--line)", boxShadow: now ? "0 0 0 5px var(--amber-soft)" : undefined }}>{done ? "✓" : NUM[s.key]}</span>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: now ? "var(--blue-deep)" : "var(--muted)" }}>{SHORT[s.key][0]}</span>
            <span style={{ fontSize: 13, fontWeight: now ? 800 : 600 }}>{SHORT[s.key][1]}</span>
            {now && s.total > 0 && <span className="cap" style={{ fontSize: 12 }}>{s.done_count} of {s.total} done</span>}
          </li>;
        })}
      </ol>

      {cur && cur.items.length > 0 && <div className="stack" style={{ gap: 8 }}>
        <div className="lb" style={{ margin: 0 }}>{cur.label} checklist</div>
        <div className="grid" style={{ gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          {cur.items.map((it) => <div key={it.label} className="hw" style={{ minHeight: 52, background: it.done ? "#F7FAFF" : undefined }}>
            <span className="ynum" style={it.done ? { background: "var(--blue-deep)", color: "#fff" } : { background: "#fff", border: "2px solid var(--line)" }}>{it.done ? "✓" : ""}</span>
            <span style={{ flex: 1, fontSize: 14 }}><strong>{it.label}</strong><span className="cap" style={{ display: "block" }}>{it.how}</span></span>
          </div>)}
        </div>
      </div>}
      {j.next_steps && <div className="strip"><b>{editable ? `What ${first || "they"} should do now:` : "Your next step:"}</b><span>{j.next_steps}</span></div>}
      {editable && j.ready_for_next && <div className="cap">Checklist complete. Move {first} to {j.next_label} when you've reviewed it.</div>}

      {moving && studentId && <MoveStage studentId={studentId} to={moving} label={j.stages.find((s) => s.key === moving)?.label || moving} first={first || ""}
        onClose={() => setMoving(null)} onDone={(m) => { setMoving(null); onChanged?.(m); }} />}
    </section>);
}

function MoveStage({ studentId, to, label, first, onClose, onDone }: { studentId: string; to: string; label: string; first: string; onClose: () => void; onDone: (m: string) => void }) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api.patch(`/advisor/students/${studentId}/stage`, { stage: to, note: note || null }); onDone(`${first} moved to ${label}`); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return <Modal title={`Move ${first} to ${label}?`} onClose={onClose}>
    <p className="cap" style={{ fontSize: 14 }}>{first} gets an email with what to do next. ActiveCampaign gets the new stage tag, so its automations can start the next steps. The change is logged.</p>
    {to === "job_hunting" && <div className="strip"><b>Heads up:</b><span>From Stage 3 the weekly application target and the Job Guarantee checks apply.</span></div>}
    <div><label className="lb" htmlFor="mn">Note for {first} (optional)</label>
      <textarea className="in" id="mn" style={{ minHeight: 80 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Your resume and LinkedIn are approved. Next: two mock interviews." /></div>
    <ErrorBox error={err} />
    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
      <button className="btn bg" onClick={onClose}>Cancel</button>
      <button className="btn bp" disabled={busy} onClick={save}>{busy ? "Saving…" : `Move to ${label}`}</button></div>
  </Modal>;
}
