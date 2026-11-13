import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { fourGeeksLoginUrl, forgotPasswordUrl, githubLoginUrl, homeFor, useAuth, type AuthConfig } from "../lib/auth";
import { ErrorBox, Spinner } from "../components/ui";
import { t, LangSwitch } from "../lib/i18n";

const GitHubMark = () => <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.61.07-.61 1 .07 1.53 1.04 1.53 1.04.89 1.53 2.34 1.09 2.91.84.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.9-1.29 2.74-1.02 2.74-1.02.56 1.38.21 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" /></svg>;

export default function Login() {
  const { user } = useAuth();
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [going, setGoing] = useState(false);
  useEffect(() => { api.get<AuthConfig>("/auth/config").then(setCfg).catch(setErr); }, []);
  if (user) return <Navigate to={homeFor(user)} replace />;

  const go = (url: string) => { setGoing(true); window.location.href = url; };

  return (
    <div className="login">
      <div className="card">
        <div className="between"><img src="/4geeks-logo-dark.svg" alt="4Geeks" style={{ width: 160 }} /><LangSwitch /></div>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800 }}>{t("Your next job.")} <em style={{ color: "var(--blue-deep)" }}>{t("Tracked.")}</em></h1>
          <p className="sub" style={{ marginTop: 6 }}>{t("Sign in to GeekForce Career Hub with your 4Geeks account.")}</p>
        </div>
        {!cfg && !err && <Spinner />}
        {cfg && <>
          <button className="btn bp" disabled={going} onClick={() => go(fourGeeksLoginUrl(cfg.breathcode_url))}>
            {going ? t("Taking you to 4Geeks…") : t("Sign in with 4Geeks")}</button>
          <button className="btn bg" disabled={going} onClick={() => go(githubLoginUrl(cfg.breathcode_url))}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <GitHubMark />{t("Sign in with GitHub")}</button>
          <p className="cap">{t("Use the same email your advisor has on file. It's the email you use on 4geeks.com.")}{" "}
            <a href={forgotPasswordUrl(cfg.breathcode_url)}>{t("Forgot your 4Geeks password?")}</a></p>
        </>}
        <ErrorBox error={err} />
        {cfg?.dev_password_login && <DevLogin />}
      </div>
    </div>);
}

/** Local development only (DEV_PASSWORD_LOGIN=true on the API): sign in as a demo account. */
function DevLogin() {
  const { devLogin } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { nav(homeFor(await devLogin(email, password)), { replace: true }); } catch (e) { setErr(e); }
  };
  return <details style={{ borderTop: "1px dashed var(--line)", paddingTop: 12 }}>
    <summary className="cap">{t("Developer sign-in (local only)")}</summary>
    <form className="stack" onSubmit={submit} style={{ marginTop: 10 }}>
      <input className="in" type="email" placeholder={t("Email")} aria-label={t("Email")} required value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="in" type="password" placeholder={t("Password")} aria-label={t("Password")} required value={password} onChange={(e) => setPassword(e.target.value)} />
      <ErrorBox error={err} />
      <button className="btn bg">{t("Sign in")}</button>
    </form>
  </details>;
}
