import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { statusNum } from "../lib/format";
import { Bar } from "./ui";
import { AccountButton } from "./Account";
import { IBell, IBriefcase, IChat, IFile, IGrid, IList, IPause, IPlus, IShield, ISliders, IUsers } from "./Icons";

const nl = ({ isActive }: { isActive: boolean }) => "nl" + (isActive ? " active" : "");

export function StudentLayout() {
  const { user, logout } = useAuth();
  const st = user?.student;
  const gap = st ? Math.max(0, 80 - st.points) : 0;
  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><img src="/4geeks-logo-dark.svg" alt="4Geeks" /><div className="product">GEEKFORCE CAREER HUB</div></div>
        <div className="me"><div className="av">{user?.initials}</div>
          <div><div style={{ fontWeight: 700 }}>{user?.name}</div>
            <div className="cap">{[st?.program, st?.location].filter(Boolean).join(" · ")}</div></div></div>
        <nav className="nav" aria-label="Main">
          <NavLink className={nl} to="/" end><IGrid />Dashboard</NavLink>
          <NavLink className={nl} to="/tracker"><IBriefcase />Job Tracker</NavLink>
          <NavLink className={nl} to="/resume"><IFile />Resume Builder</NavLink>
          <NavLink className={nl} to="/points"><IShield />Points &amp; Guarantee</NavLink>
          <NavLink className={nl} to="/advisor"><IChat />Advisor Hub</NavLink>
          <NavLink className={nl} to="/notifications"><IBell />Notifications</NavLink>
        </nav>
        <div className="side-foot">
          {st && (
            <div className="card mini" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="eyebrow">Career points</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span className="num" style={{ fontSize: 32, color: statusNum(st.guarantee_status) }}>{st.points}</span>
                <span className="cap">/ 100</span></div>
              <Bar value={st.points} max={100} color={st.guarantee_status === "secured" ? "var(--blue)" : st.guarantee_status === "at_risk" ? "var(--amber)" : "var(--red)"} />
              <div style={{ fontSize: 13, fontWeight: 600, color: statusNum(st.guarantee_status) }}>
                {st.on_hold ? "On hold · book your first 1:1" : st.paused ? "On pause · checks frozen"
                  : st.guarantee_status === "suspended" ? "Guarantee suspended" : st.guarantee_status === "not_eligible" ? "Professional Support"
                  : gap ? `At risk · ${gap} pts to secure` : "Guarantee secured"}
              </div>
            </div>)}
          <AccountButton /><button className="signout" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>);
}

export function StaffLayout() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  return (
    <div className="app">
      <aside className="side dark">
        <div className="brand"><img src="/4geeks-logo-white.svg" alt="4Geeks" /><div className="product">GEEKFORCE · {isAdmin ? "ADMIN" : "ADVISOR"}</div></div>
        <div className="me"><div className="av">{user?.initials}</div>
          <div><div style={{ fontWeight: 700 }}>{user?.name}</div>
            <div style={{ fontSize: 13, color: "#A9B6CA" }}>{isAdmin ? "Admin" : "Advisor"}</div></div></div>
        <nav className="nav" aria-label="Advisor">
          <NavLink className={nl} to="/staff" end><IUsers />My students</NavLink>
          <NavLink className={nl} to="/staff/onboarding"><IPlus />Onboarding</NavLink>
          <NavLink className={nl} to="/staff/notifications"><IBell />Alerts</NavLink>
          <div className="ng">MANAGE</div>
          <NavLink className={nl} to="/admin" end><IPause />Pause requests</NavLink>
          {isAdmin && <NavLink className={nl} to="/admin/rules"><ISliders />Rules &amp; points</NavLink>}
          {isAdmin && <NavLink className={nl} to="/admin/people"><IUsers />People &amp; cohorts</NavLink>}
          {isAdmin && <NavLink className={nl} to="/admin/audit"><IList />Audit log</NavLink>}
        </nav>
        <div className="side-foot"><AccountButton /><button className="signout" onClick={logout}>Sign out</button></div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>);
}
