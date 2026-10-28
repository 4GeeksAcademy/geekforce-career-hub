import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { relTime } from "../lib/format";
import { t } from "../lib/i18n";
import { useApi } from "../lib/useApi";
import { ErrorBox, Modal, Spinner, useToast } from "../components/ui";
import { IBriefcase, ICheck } from "../components/Icons";

type Job = { id: string; title: string; company: string | null; location: string | null; work_mode: string | null; url: string | null;
  posted_at: string | null; salary_min: number | null; salary_max: number | null; description: string | null; is_partner: boolean };
type Share = { id: string; status: "new" | "interested" | "applied" | "not_a_fit"; note: string | null; response_note: string | null;
  shared_at: string; new: boolean; shared_by: string | null; application_id: string | null; job: Job };

const STATUS: Record<Share["status"], [string, string]> = {
  new: [t("New"), "pa"], interested: [t("Interested"), "pb"], applied: [t("Applied"), "pn"], not_a_fit: [t("Not a fit"), "pg"],
};

export default function JobsForYou() {
  const r = useApi<Share[]>("/students/me/jobs");
  const { refresh } = useAuth();
  const toast = useToast();
  const [f, setF] = useState<"open" | "applied" | "not_a_fit" | "all">("open");
  const [passing, setPassing] = useState<Share | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (r.data) window.dispatchEvent(new Event("gf-jobs-seen")); }, [r.data]);

  const respond = async (s: Share, status: Share["status"], note?: string) => {
    setErr(null);
    try {
      const res = await api.patch<Share & { logged_application: boolean }>(`/students/me/jobs/${s.id}`, { status, note: note || null });
      toast(status === "applied" ? (res.logged_application ? t("Logged in your Job Tracker (+3)") : t("Marked as applied"))
        : status === "interested" ? t("Saved as interested") : status === "not_a_fit" ? t("Thanks, your advisor will see why") : t("Updated"));
      r.reload(); refresh();
    } catch (e) { setErr(e); }
  };

  const all = r.data || [];
  const shown = all.filter((s) => f === "all" || (f === "open" ? ["new", "interested"].includes(s.status) : s.status === f));
  const count = (k: typeof f) => all.filter((s) => k === "all" || (k === "open" ? ["new", "interested"].includes(s.status) : s.status === k)).length;

  return (
    <>
      <header className="top"><div><h1>{t("Jobs for you")}</h1>
        <div className="sub">{t("Openings your career advisor picked for you. Apply, then mark them here.")}</div></div></header>
      <div className="content">
        <div className="tabs" role="tablist">
          {([["open", t("To review")], ["applied", t("Applied")], ["not_a_fit", t("Not a fit")], ["all", t("All")]] as const).map(([k, l]) =>
            <button key={k} role="tab" aria-selected={f === k} className={`tab ${f === k ? "on" : ""}`} onClick={() => setF(k)}>{l} ({count(k)})</button>)}
        </div>
        <ErrorBox error={err || r.error} />
        {r.loading && <Spinner />}
        {!r.loading && shown.length === 0 && <div className="card stack" style={{ alignItems: "center", textAlign: "center", padding: 40 }}>
          <IBriefcase size={28} />
          <h2 className="h2">{f === "open" ? t("Nothing new right now") : t("Nothing here yet")}</h2>
          <p className="cap" style={{ maxWidth: 440 }}>{t("When your advisor finds a job that fits you, it shows up here and you get a notification. Keep applying on your own too and log it in the")} <Link to="/tracker">{t("Job Tracker")}</Link>.</p>
        </div>}
        <div className="stack" style={{ gap: 14 }}>
          {shown.map((s) => { const j = s.job; return (
            <article key={s.id} className="card stack" style={{ gap: 12, padding: 20, borderColor: s.new ? "var(--amber)" : undefined }}>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div className="av soft" style={{ width: 44, height: 44, borderRadius: 12 }}>{(j.company || j.title).slice(0, 2).toUpperCase()}</div>
                <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 17 }}>{j.title}</strong>
                    <span className={`pill ${STATUS[s.status][1]}`}>{t(STATUS[s.status][0])}</span>
                    {j.is_partner && <span className="pill pn">{t("Hiring partner")}</span>}
                  </div>
                  <div className="cap">{[j.company, j.location, j.work_mode].filter(Boolean).join(" · ")}</div>
                  <div className="cap" style={{ fontSize: 12, marginTop: 2 }}>
                    {[s.shared_by && t("Shared by {name}", { name: s.shared_by }), relTime(s.shared_at),
                      j.salary_min ? `$${Math.round(j.salary_min / 1000)}k${j.salary_max && j.salary_max !== j.salary_min ? `–${Math.round(j.salary_max / 1000)}k` : ""}` : null].filter(Boolean).join(" · ")}</div>
                </div>
                {j.url && <a className="btn bp sm" href={j.url} target="_blank" rel="noreferrer">{t("Open the job post")}</a>}
              </div>
              {s.note && <div className="strip" style={{ background: "var(--blue-tint)" }}><b>{s.shared_by?.split(" ")[0] || t("Your advisor")}:</b><span>{s.note}</span></div>}
              {j.description && <details><summary className="cap" style={{ cursor: "pointer" }}>{t("Job description")}</summary>
                <p style={{ fontSize: 14, whiteSpace: "pre-wrap", marginTop: 8 }}>{j.description}</p></details>}
              {s.response_note && <div className="cap" style={{ fontStyle: "italic" }}>{t("Your note")}: “{s.response_note}”</div>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {s.status !== "applied" && <button className="btn by sm" onClick={() => respond(s, "applied")}><ICheck size={15} />{t("I applied")}</button>}
                {s.status === "applied" && <Link className="btn bg sm" to="/tracker">{t("See it in your tracker")}</Link>}
                {s.status === "new" && <button className="btn bg sm" onClick={() => respond(s, "interested")}>{t("Interested, applying soon")}</button>}
                {s.status !== "not_a_fit" && s.status !== "applied" && <button className="btn bg sm" onClick={() => setPassing(s)}>{t("Not a fit")}</button>}
                {s.status === "not_a_fit" && <button className="btn bg sm" onClick={() => respond(s, "interested")}>{t("Changed my mind")}</button>}
                <Link className="btn bg sm" to="/resume">{t("Tailor my resume for it")}</Link>
              </div>
            </article>); })}
        </div>
      </div>
      {passing && <NotAFit share={passing} onClose={() => setPassing(null)} onSave={(n) => { respond(passing, "not_a_fit", n); setPassing(null); }} />}
    </>);
}

function NotAFit({ share, onClose, onSave }: { share: Share; onClose: () => void; onSave: (note: string) => void }) {
  const [note, setNote] = useState("");
  const reasons = [t("Needs more experience"), t("Location or remote"), t("Salary"), t("Not my field"), t("Already applied before")];
  return <Modal title={t("Why isn't it a fit?")} onClose={onClose}>
    <p className="cap" style={{ fontSize: 14 }}>{t("Your advisor uses this to send you better matches.")} <strong>{share.job.title}</strong></p>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{reasons.map((x) => <button key={x} className={`chip ${note === x ? "on" : ""}`} onClick={() => setNote(x)}>{x}</button>)}</div>
    <textarea className="in" aria-label={t("Reason")} style={{ minHeight: 70 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Optional: tell your advisor more")} />
    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
      <button className="btn bg" onClick={onClose}>{t("Cancel")}</button>
      <button className="btn bp" onClick={() => onSave(note)}>{t("Save")}</button></div>
  </Modal>;
}
