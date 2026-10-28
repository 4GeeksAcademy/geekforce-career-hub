import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { statusNum } from "../lib/format";
import { Bar } from "./ui";
import { AccountButton } from "./Account";
import { LangSwitch, t } from "../lib/i18n";
import { IBell, IBriefcase, IChat, IFile, IGrid, IList, IPause, IPlus, IShield, ISliders, IStar, IUsers } from "./Icons";

const nl = ({ isActive }: { isActive: boolean }) => "nl" + (isActive ? " active" : "");

export function StudentLayout() {
  const { user, logout } = useAuth();
  const st = user?.student;
  const gap = st ? Math.max(0, 80 - st.points) : 0;
  const loc = useLocation();
  const [unseen, setUnseen] = useState(0);
  useEffect(() => { api.get<{ count: number }>("/students/me/jobs/unseen").then((r) => setUnseen(r.count)).catch(() => {}); }, [loc.pathname]);
  useEffect(() => { const h = () => setUnseen(0); window.addEventListener("gf-jobs-seen", h); return () => window.removeEventListener("gf-jobs-seen", h); }, []);
  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><img src="/4geeks-logo-dark.svg" alt="4Geeks" /><div className="product">{t("GEEKFORCE CAREER HUB")}</div></div>
        <div className="me"><div className="av">{user?.initials}</div>
          <div><div style={{ fontWeight: 700 }}>{user?.name}</div>
            <div className="cap">{[st?.program, st?.location].filter(Boolean).join(" · ")}</div></div></div>
        <nav className="nav" aria-label={t("Main")}>
          <NavLink className={nl} to="/" end><IGrid />{t("Dashboard")}</NavLink>
          <NavLink className={nl} to="/jobs"><IStar />{t("Jobs for you")}{unseen > 0 && <span className="nbadge">{unseen}</span>}</NavLink>
          <NavLink className={nl} to="/tracker"><IBriefcase />{t("Job Tracker")}</NavLink>
          <NavLink className={nl} to="/resume"><IFile />{t("Resume Builder")}</NavLink>
          <NavLink className={nl} to="/points"><IShield />{t("Points & Guarantee")}</NavLink>
          <NavLink className={nl} to="/advisor"><IChat />{t("Advisor Hub")}</NavLink>
          <NavLink className={nl} to="/notifications"><IBell />{t("Notifications")}</NavLink>
        </nav>
        <div className="side-foot">
          {st && (
            <div className="card mini" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="eyebrow">{t("Career points")}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span className="num" style={{ fontSize: 32, color: statusNum(st.guarantee_status) }}>{st.points}</span>
                <span className="cap">/ 100</span></div>
              <Bar value={st.points} max={100} color={st.guarantee_status === "secured" ? "var(--blue)" : st.guarantee_status === "at_risk" ? "var(--amber)" : "var(--red)"} />
              <div style={{ fontSize: 13, fontWeight: 600, color: statusNum(st.guarantee_status) }}>
                {st.on_hold ? t("On hold · book your first 1:1") : st.paused ? t("On pause · checks frozen")
                  : st.guarantee_status === "suspended" ? t("Guarantee suspended") : st.guarantee_status === "not_eligible" ? t("Professional Support")
                  : gap ? t("At risk · {gap} pts to secure", { gap: gap }) : t("Guarantee secured")}
              </div>
            </div>)}
          <LangSwitch /><AccountButton /><button className="signout" onClick={logout}>{t("Sign out")}</button>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>);
}

export function StaffLayout() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  return (
    <div className="app staff">
      <aside className="side">
        <div className="brand"><img src="/4geeks-logo-dark.svg" alt="4Geeks" />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="product">{t("GEEKFORCE")}</span><span className="role-pill">{isAdmin ? t("ADMIN") : t("ADVISOR")}</span></div></div>
        <div className="me"><div className="av">{user?.initials}</div>
          <div><div style={{ fontWeight: 700 }}>{user?.name}</div>
            <div className="cap">{isAdmin ? t("Admin · all students") : t("Advisor")}</div></div></div>
        <nav className="nav" aria-label={t("Advisor")}>
          <div className="ng">{t("STUDENTS")}</div>
          <NavLink className={nl} to="/staff" end><IUsers />{t("My students")}</NavLink>
          <NavLink className={nl} to="/staff/onboarding"><IPlus />{t("Onboarding")}</NavLink>
          <NavLink className={nl} to="/staff/notifications"><IBell />{t("Alerts")}</NavLink>
          <NavLink className={nl} to="/staff/resumes"><IFile />{t("Resume Studio")}</NavLink>
          <div className="ng">{t("OPPORTUNITIES")}</div>
          <NavLink className={nl} to="/staff/jobs"><IBriefcase />{t("Job Radar")}</NavLink>
          <div className="ng">{t("MANAGE")}</div>
          <NavLink className={nl} to="/admin" end><IPause />{t("Pause requests")}</NavLink>
          {isAdmin && <NavLink className={nl} to="/admin/rules"><ISliders />{t("Rules & points")}</NavLink>}
          {isAdmin && <NavLink className={nl} to="/admin/people"><IUsers />{t("People & cohorts")}</NavLink>}
          {isAdmin && <NavLink className={nl} to="/admin/audit"><IList />{t("Audit log")}</NavLink>}
        </nav>
        <div className="side-foot"><LangSwitch /><AccountButton /><button className="signout" onClick={logout}>{t("Sign out")}</button></div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>);
}
