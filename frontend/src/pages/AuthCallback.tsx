import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { homeFor, useAuth } from "../lib/auth";
import { ErrorBox, Spinner } from "../components/ui";
import { t } from "../lib/i18n";

/** 4Geeks sends the browser back here with ?token=<4Geeks login token>&attempt=1 (hosted login or GitHub). */
export default function AuthCallback() {
  const { exchange } = useAuth();
  const nav = useNavigate();
  const [err, setErr] = useState<unknown>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;  // React StrictMode runs effects twice in development
    once.current = true;
    const token = new URLSearchParams(window.location.search).get("token");
    // Never leave the token in the address bar, history, bookmarks or Referer headers.
    window.history.replaceState(null, "", "/auth/callback");
    if (!token) { setErr(new Error("4Geeks didn't send a session back. Try signing in again.")); return; }
    exchange(token).then((u) => nav(homeFor(u), { replace: true })).catch(setErr);
  }, [exchange, nav]);

  return (
    <div className="login">
      <div className="card">
        <img src="/4geeks-logo-dark.svg" alt="4Geeks" style={{ width: 160 }} />
        {err ? <>
          <ErrorBox error={err} />
          <Link className="btn bp" to="/login" replace>{t("Back to sign in")}</Link>
        </> : <>
          <p className="sub">{t("Signing you in with 4Geeks…")}</p>
          <Spinner />
        </>}
      </div>
    </div>);
}
