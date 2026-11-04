import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { appStatus, fmtDate, relTime } from "../lib/format";
import { t } from "../lib/i18n";
import { useApi } from "../lib/useApi";
import { ErrorBox, Modal, Spinner, useToast } from "./ui";

export type ShareEvent = { id: string; kind: string; at: string; by: string | null; detail: string | null; data: Record<string, unknown> };
export type ShareJob = { id: string; title: string; company: string | null; location: string | null; work_mode: string | null; url: string | null;
  posted_at: string | null; salary_min: number | null; salary_max: number | null; description: string | null; is_partner: boolean; program: string | null };
export type ShareRec = { id: string; status: "new" | "interested" | "applied" | "not_a_fit"; note: string | null; response_note: string | null;
  shared_at: string; new: boolean; seen_at: string | null; responded_at: string | null; shared_by: string | null; application_id: string | null;
  application: { id: string; status: string; applied_at: string; notes: string | null; followup_date: string | null } | null;
  student: { id: string; name: string; cohort: string | null }; last_activity: string; job: ShareJob; timeline: ShareEvent[] };

export const SHARE_STATUS: Record<string, [string, string]> = {
  new: ["Not answered", "pg"], interested: ["Interested", "pb"], applied: ["Applied", "pn"], not_a_fit: ["Not a fit", "pr"],
};
const STAGES = ["applied", "phone_screen", "technical", "final", "offer", "rejected", "withdrawn"];
const DOT: Record<string, string> = {
  shared: "var(--blue)", seen: "#9AA3AF", interested: "var(--blue)", applied: "var(--navy)", logged: "var(--navy)",
  not_a_fit: "var(--red)", reopened: "var(--amber)", stage: "var(--amber)", note: "var(--blue-deep)",
};

const money = (j: ShareJob) => j.salary_min ? `$${Math.round(j.salary_min / 1000)}k${j.salary_max && j.salary_max !== j.salary_min ? `–${Math.round(j.salary_max / 1000)}k` : ""}` : null;
const stageName = (s: unknown) => (appStatus[String(s)]?.[0] ? t(appStatus[String(s)][0]) : String(s));

/** One line per thing that happened to this job, oldest first. */
export function ShareTimeline({ share, studentView }: { share: ShareRec; studentView?: boolean }) {
  const label = (e: ShareEvent): string => {
    const who = e.by || "";
    switch (e.kind) {
      case "shared": return t("Shared by {name}", { name: who || t("the career team") });
      case "seen": return studentView ? t("You opened it") : t("{name} opened it", { name: share.student.name.split(" ")[0] });
      case "interested": return studentView ? t("You marked it Interested") : t("Marked Interested");
      case "applied": return studentView ? t("You marked it Applied") : t("Marked Applied");
      case "logged": return t("Logged in the Job Tracker (+3 points)");
      case "not_a_fit": return studentView ? t("You marked it Not a fit") : t("Marked Not a fit");
      case "reopened": return t("Reconsidered after Not a fit");
      case "stage": return t("Application moved: {from} → {to}", { from: stageName(e.data.from), to: stageName(e.data.to) });
      case "note": return t("Note from {name}", { name: who }) + (e.data.shared_with_student ? "" : ` · ${t("private")}`);
      default: return e.kind;
    }
  };
  return <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 0 }}>
    {share.timeline.map((e, i) => <li key={e.id} style={{ display: "flex", gap: 12, position: "relative", paddingBottom: i === share.timeline.length - 1 ? 0 : 14 }}>
      {i < share.timeline.length - 1 && <span aria-hidden style={{ position: "absolute", left: 5, top: 14, bottom: 0, width: 2, background: "var(--line)" }} />}
      <span aria-hidden style={{ width: 12, height: 12, borderRadius: "50%", background: DOT[e.kind] || "var(--line)", marginTop: 4, flex: "none", position: "relative" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{label(e)}</div>
        <div className="cap" style={{ fontSize: 12 }}>{fmtDate(e.at, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{e.by && e.kind !== "shared" && e.kind !== "note" ? ` · ${e.by}` : ""}</div>
        {e.detail && <div style={{ fontSize: 13, marginTop: 4, padding: "6px 10px", background: "var(--bg2)", borderRadius: 8, whiteSpace: "pre-wrap" }}>{e.detail}</div>}
      </div>
    </li>)}
    {share.timeline.length === 0 && <li className="cap">{t("No activity yet.")}</li>}
  </ol>;
}

/** The full record of one shared job: the job, who shared it, the student's answer, the application stage and the history. */
export function ShareDetail({ shareId, staff, onClose, onChanged }: { shareId: string; staff?: boolean; onClose: () => void; onChanged?: () => void }) {
  const r = useApi<ShareRec>(`/job-shares/${shareId}`);
  const toast = useToast();
  const [note, setNote] = useState("");
  const [shareNote, setShareNote] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const s = r.data;

  const addNote = async () => {
    setErr(null);
    try { await api.post(`/advisor/job-shares/${shareId}/notes`, { body: note, shared_with_student: shareNote }); setNote(""); toast(t("Note added")); r.reload(); onChanged?.(); }
    catch (e) { setErr(e); }
  };
  const setStage = async (status: string) => {
    if (!s?.application) return;
    setErr(null);
    try { await api.patch(`/applications/${s.application.id}`, { status }); toast(t("Application updated")); r.reload(); onChanged?.(); }
    catch (e) { setErr(e); }
  };

  return <Modal title={s ? s.job.title : t("Loading")} onClose={onClose}>
    {!s ? <Spinner /> : <div className="stack" style={{ gap: 14, maxHeight: "70vh", overflow: "auto", paddingRight: 4 }}>
      <div className="stack" style={{ gap: 4 }}>
        <div className="cap">{[s.job.company, s.job.location, s.job.work_mode && !(s.job.location || "").toLowerCase().includes(s.job.work_mode.toLowerCase()) ? s.job.work_mode : null, money(s.job)].filter(Boolean).join(" · ")}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {staff && <Link className="pill pg" to={`/staff/students/${s.student.id}`} onClick={onClose}>{s.student.name}{s.student.cohort ? ` · ${s.student.cohort}` : ""}</Link>}
          <span className={`pill ${SHARE_STATUS[s.status][1]}`}>{t(SHARE_STATUS[s.status][0])}</span>
          {s.application && <span className={`pill ${appStatus[s.application.status]?.[1] || "pg"}`}>{t("Application")}: {stageName(s.application.status)}</span>}
          {s.job.is_partner && <span className="pill pn">{t("Hiring partner")}</span>}
          {s.job.url && <a className="btn bg sm" href={s.job.url} target="_blank" rel="noreferrer">{t("Open the job post")}</a>}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
        <Fact l={t("Shared")} v={`${fmtDate(s.shared_at)}${s.shared_by ? ` · ${s.shared_by}` : ""}`} />
        <Fact l={t("Opened")} v={s.seen_at ? relTime(s.seen_at) : t("Not yet")} />
        <Fact l={t("Answered")} v={s.responded_at ? relTime(s.responded_at) : t("Not yet")} />
        <Fact l={t("Applied on")} v={s.application ? fmtDate(s.application.applied_at) : "—"} />
      </div>

      {s.application && (staff || s.status === "applied") && <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label className="lb" htmlFor="stg" style={{ margin: 0 }}>{t("Where is this application now?")}</label>
        <select id="stg" className="in" style={{ maxWidth: 220 }} value={s.application.status} onChange={(e) => setStage(e.target.value)}>
          {STAGES.map((k) => <option key={k} value={k}>{stageName(k)}</option>)}</select>
      </div>}

      {s.job.description && <details><summary className="cap" style={{ cursor: "pointer" }}>{t("Job description")}</summary>
        <p style={{ fontSize: 14, whiteSpace: "pre-wrap", marginTop: 8 }}>{s.job.description}</p></details>}

      <div className="stack" style={{ gap: 10 }}>
        <div className="lb" style={{ margin: 0 }}>{t("History")}</div>
        <ShareTimeline share={s} studentView={!staff} />
      </div>

      {staff && <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <label className="lb" htmlFor="sn2" style={{ margin: 0 }}>{t("Add to the log")}</label>
        <textarea id="sn2" className="in" rows={2} style={{ minHeight: 0 }} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={t("e.g. Called the recruiter; interview booked for Tuesday.")} />
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={shareNote} onChange={(e) => setShareNote(e.target.checked)} />{t("Show this note to the student")}</label>
        <button className="btn bp sm" style={{ alignSelf: "flex-start" }} disabled={note.trim().length < 2} onClick={addNote}>{t("Add note")}</button>
      </div>}
      <ErrorBox error={err} />
    </div>}
  </Modal>;
}

function Fact({ l, v }: { l: string; v: string }) {
  return <div style={{ background: "var(--bg2)", borderRadius: 10, padding: "8px 12px" }}>
    <div className="cap" style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase" }}>{l}</div>
    <div style={{ fontSize: 14, fontWeight: 600 }}>{v}</div></div>;
}

/** Table of shared jobs (tracking page and student profile). */
export function SharesTable({ items, showStudent, onOpen }: { items: ShareRec[]; showStudent?: boolean; onOpen: (id: string) => void }) {
  if (!items.length) return <div className="empty">{t("No shared jobs here.")}</div>;
  return <div className="tw"><table>
    <thead><tr>{showStudent && <th>{t("Student")}</th>}<th>{t("Job")}</th><th>{t("Shared")}</th><th>{t("Answer")}</th><th>{t("Application")}</th><th>{t("Last activity")}</th></tr></thead>
    <tbody>{items.map((s) => <tr key={s.id} className="click" onClick={() => onOpen(s.id)} style={{ cursor: "pointer" }}>
      {showStudent && <td><strong>{s.student.name}</strong><div className="cap">{s.student.cohort}</div></td>}
      <td><button className="linkbtn" style={{ textDecoration: "none", color: "var(--ink)", textAlign: "left" }} onClick={(e) => { e.stopPropagation(); onOpen(s.id); }}>
        <strong>{s.job.title}</strong></button><div className="cap">{[s.job.company, s.job.location].filter(Boolean).join(" · ")}</div></td>
      <td className="cap">{fmtDate(s.shared_at)}{s.shared_by ? <div>{s.shared_by}</div> : null}</td>
      <td><span className={`pill ${SHARE_STATUS[s.status][1]}`}>{t(SHARE_STATUS[s.status][0])}</span>
        {s.new && <div className="cap" style={{ fontSize: 12 }}>{t("not opened yet")}</div>}
        {s.response_note && <div className="cap" style={{ fontSize: 12, fontStyle: "italic" }}>“{s.response_note}”</div>}</td>
      <td>{s.application ? <span className={`pill ${appStatus[s.application.status]?.[1] || "pg"}`}>{stageName(s.application.status)}</span> : <span className="cap">—</span>}</td>
      <td className="cap">{relTime(s.last_activity)}<div style={{ fontSize: 12 }}>{t("{n} events", { n: s.timeline.length })}</div></td>
    </tr>)}</tbody></table></div>;
}
