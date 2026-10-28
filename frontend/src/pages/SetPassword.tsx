import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api, setToken } from "../lib/api";
import { ErrorBox } from "../components/ui";
import { t, LangSwitch } from "../lib/i18n";

export default function SetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [info, setInfo] = useState<{ email: string; name: string } | null>(null);
  const [checkErr, setCheckErr] = useState<unknown>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ email: string; name: string }>(`/auth/set-password/check?token=${encodeURIComponent(token)}`)
      .then(setInfo).catch(setCheckErr);
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (pw !== pw2) { setErr(new Error(t("The two passwords don't match"))); return; }
    setBusy(true);
    try {
      const r = await api.post<{ token: string; user: { role: string } }>("/auth/set-password", { token, password: pw });
      setToken(r.token);
      window.location.href = r.user.role === "student" ? "/" : "/staff";
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="between"><img src="/4geeks-logo-dark.svg" alt="4Geeks" style={{ width: 160 }} /><LangSwitch /></div>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800 }}>{t("Welcome to GeekForce.")} <em style={{ color: "var(--blue-deep)" }}>{t("Let's go.")}</em></h1>
          <p className="sub" style={{ marginTop: 6 }}>{info ? t("Choose a password for {email}.", { email: info.email }) : t("Checking your link…")}</p>
        </div>
        {checkErr ? <ErrorBox error={checkErr} /> : <>
          <div><label className="lb" htmlFor="p1">{t("New password (8+ characters)")}</label>
            <input className="in" id="p1" type="password" autoComplete="new-password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <div><label className="lb" htmlFor="p2">{t("Repeat it")}</label>
            <input className="in" id="p2" type="password" autoComplete="new-password" required minLength={8} value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
          <ErrorBox error={err} />
          <button className="btn bp" disabled={busy || !info}>{busy ? t("Saving…") : t("Save and sign in")}</button>
        </>}
        <p className="cap">{t("Link not working? Ask your GeekForce advisor to send a new one.")}</p>
      </form>
    </div>);
}
