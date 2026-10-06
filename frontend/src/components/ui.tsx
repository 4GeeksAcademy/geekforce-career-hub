import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { statusColor, statusLabel, statusNum, statusPill } from "../lib/format";
import type { GStatus } from "../lib/types";

export function Spinner() { return <div className="spinner" role="status" aria-label="Loading" />; }

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="err" role="alert">{error instanceof Error ? error.message : String(error)}</div>;
}

export function StatusPill({ status, paused }: { status: GStatus | string; paused?: boolean }) {
  if (paused) return <span className="pill pg">On pause</span>;
  return <span className={`pill ${statusPill[status] || "pg"}`}>{statusLabel[status] || status}</span>;
}

export function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return <div className="bar"><span style={{ width: `${pct}%`, background: color || "var(--blue)" }} /></div>;
}

export function Gauge({ points, status, secured = 80, suspended = 60, size = 200 }:
  { points: number; status: GStatus; secured?: number; suspended?: number; size?: number }) {
  const r = 84, c = 2 * Math.PI * r;
  const tick = (p: number) => {
    const a = (-90 + 360 * (p / 100)) * Math.PI / 180;
    return { x1: 100 + 72 * Math.cos(a), y1: 100 + 72 * Math.sin(a), x2: 100 + 96 * Math.cos(a), y2: 100 + 96 * Math.sin(a) };
  };
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r={r} fill="none" stroke="#EEF1F5" strokeWidth="16" />
        <circle cx="100" cy="100" r={r} fill="none" stroke={statusColor(status)} strokeWidth="16" strokeLinecap="round"
          strokeDasharray={`${(points / 100) * c} ${c}`} transform="rotate(-90 100 100)" />
        {[suspended, secured].map((p) => <line key={p} {...tick(p)} stroke="#0B0B0F" strokeWidth="2" />)}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div className="num" style={{ fontSize: 54, lineHeight: 1, color: statusNum(status) }}>{points}</div>
        <div className="cap">of 100</div>
      </div>
    </div>
  );
}

export function Legend() {
  const item = (c: string, t: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />{t}
    </span>);
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", fontSize: 12, color: "var(--body)" }}>
      {item("var(--blue)", "Secured 80+")}{item("var(--amber)", "At risk 60–79")}{item("var(--red)", "Suspended <60")}
    </div>);
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="between"><h2 className="h2">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>);
}

const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3500); }, []);
  return <ToastCtx.Provider value={show}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);
