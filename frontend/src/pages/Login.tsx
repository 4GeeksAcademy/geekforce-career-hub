import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ErrorBox } from "../components/ui";

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={user.role === "student" ? "/" : "/staff"} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const u = await login(email, password);
      nav(u.role === "student" ? "/" : "/staff", { replace: true });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <img src="/4geeks-logo-dark.svg" alt="4Geeks" style={{ width: 160 }} />
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800 }}>Your next job. <em style={{ color: "var(--blue-deep)" }}>Tracked.</em></h1>
          <p className="sub" style={{ marginTop: 6 }}>Sign in to GeekForce Career Hub.</p>
        </div>
        <div><label className="lb" htmlFor="em">Email</label>
          <input className="in" id="em" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label className="lb" htmlFor="pw">Password</label>
          <input className="in" id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <ErrorBox error={err} />
        <button className="btn bp" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="cap">Don't have an account? Your GeekForce advisor creates it for you.</p>
      </form>
    </div>);
}
