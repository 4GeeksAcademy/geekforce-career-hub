import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import type { Notif } from "../lib/types";
import { relTime } from "../lib/format";
import { ErrorBox, Spinner } from "../components/ui";
import { ILock } from "../components/Icons";
import { t } from "../lib/i18n";

type Prefs = { locked: { key: string; label: string }[]; optional: { key: string; label: string; enabled: boolean }[] };
const FILTERS: [string, string][] = [["", t("All")], ["unread", t("Unread")], ["guarantee,deduction,inactivity", t("Guarantee")], ["advisor,session,reminder,pause", t("Advisor")]];
const KIND: Record<string, [string, string]> = {
  warning: [t("Guarantee"), "pa"], critical: [t("Critical"), "pr"], success: [t("Good news"), "pb"], deduction: [t("Deduction"), "pr"],
  info: [t("Update"), "pb"], reminder: [t("Reminder"), "pg"],
};

export default function Notifications({ staff }: { staff?: boolean }) {
  const [filter, setFilter] = useState("");
  const path = filter === "unread" ? "/notifications?unread=true" : filter ? `/notifications?category=${filter}` : "/notifications";
  const list = useApi<{ items: Notif[]; unread: number }>(path);
  const prefs = useApi<Prefs>(staff ? null : "/notifications/preferences");
  const nav = useNavigate();

  const open = async (n: Notif) => {
    if (!n.read) await api.patch(`/notifications/${n.id}/read`);
    if (n.link?.startsWith("http")) { window.open(n.link, "_blank", "noopener"); list.reload(); }
    else if (n.link) nav(n.link); else list.reload();
  };
  const readAll = async () => { await api.post("/notifications/read-all"); list.reload(); };
  const toggle = async (key: string, enabled: boolean) => { await api.put("/notifications/preferences", { key, enabled }); prefs.reload(); };

  return (
    <>
      <header className="top"><div>{staff && <div className="kick">{t("Students")}</div>}<h1>{staff ? <>{t("Alerts.")} <em>{t("What needs you.")}</em></> : t("Notifications")}</h1><div className="sub">{staff ? t("Breaches, inactivity and pause requests from your students.") : t("Important ones are also sent to your email.")}</div></div>
        <button className="btn bg" onClick={readAll}>{t("Mark all as read")}</button></header>
      <div className="content">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <section className="card stack" style={{ flex: "3 1 480px", minWidth: 0, gap: 10 }}>
            {!staff && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              {FILTERS.map(([v, l]) => <button key={l} className={`chip ${filter === v ? "on" : ""}`} onClick={() => setFilter(v)}>{l}{v === "unread" && list.data ? ` (${list.data.unread})` : ""}</button>)}</div>}
            {list.loading ? <Spinner /> : <ErrorBox error={list.error} />}
            {list.data?.items.length === 0 && <div className="empty">{t("Nothing here yet.")}</div>}
            <div>{list.data?.items.map((n) => {
              const [k, pc] = KIND[n.type] || [t("Update"), "pg"];
              return <button key={n.id} onClick={() => open(n)} style={{ all: "unset", cursor: "pointer", display: "flex", gap: 14, alignItems: "flex-start", padding: "16px 0", borderBottom: "1px solid var(--line-soft)", width: "100%" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", marginTop: 7, flex: "none", background: n.read ? "#C3CAD5" : n.type === "critical" || n.type === "deduction" ? "var(--red)" : n.type === "warning" ? "var(--amber)" : "var(--blue)" }} />
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span style={{ fontWeight: n.read ? 600 : 800 }}>{n.title}</span><span className={`pill ${pc}`}>{k}</span></div>
                  <div className="cap" style={{ fontSize: 14, marginTop: 2, whiteSpace: "pre-line" }}>{n.body}</div></div>
                <span className="cap" style={{ flex: "none", whiteSpace: "nowrap" }}>{relTime(n.created_at)}</span>
              </button>;
            })}</div>
          </section>
          {!staff && prefs.data && (
            <section className="card stack" style={{ flex: "2 1 320px", gap: 6 }}>
              <h2 className="h2">{t("Email preferences")}</h2>
              <p className="cap" style={{ marginBottom: 8 }}>{t("Guarantee alerts always reach you, by email and here.")}</p>
              <div className="eyebrow">{t("Always on")}</div>
              {prefs.data.locked.map((p) => <div key={p.key} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--line-soft)" }}><span style={{ color: "var(--muted)" }}><ILock size={18} /></span>{p.label}</div>)}
              <div className="eyebrow" style={{ marginTop: 14 }}>{t("Your choice")}</div>
              {prefs.data.optional.map((p) => <label key={p.key} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--line-soft)", cursor: "pointer" }}>
                <input type="checkbox" style={{ width: 20, height: 20, accentColor: "var(--blue-deep)" }} checked={p.enabled} onChange={(e) => toggle(p.key, e.target.checked)} />{p.label}</label>)}
            </section>)}
        </div>
      </div>
    </>);
}
