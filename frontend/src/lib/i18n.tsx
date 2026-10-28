/**
 * English / Spanish for the whole app.
 *
 *   t("Save")                                  → "Guardar"
 *   t("{n} of {total} done", { n: 2, total: 4 }) → "2 de 4 listas"
 *
 * Keys are the English text, so untranslated strings simply show in English.
 * The language comes from the signed-in user (saved on the server), else the last choice on this device,
 * else the browser. Changing it saves the choice and reloads the page.
 */
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { ES } from "./es";

export type Lang = "en" | "es";
const KEY = "gf_lang";

function stored(): Lang | null {
  try { const v = localStorage.getItem(KEY); if (v === "en" || v === "es") return v; } catch { /* storage blocked */ }
  return null;
}
function initial(): Lang {
  const v = stored(); if (v) return v;
  return (navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en";
}

let LANG: Lang = initial();
export const lang = () => LANG;
export const locale = (): string => (LANG === "es" ? "es-ES" : "en-US");

export function t(text: string, vars?: Record<string, string | number | null | undefined>): string {
  let s = (LANG === "es" && ES[text]) || text;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
  return s;
}

/** Wrap a { key: "English label" } map so every lookup comes back translated. */
export function tmap<T extends Record<string, string>>(m: T): T {
  return new Proxy(m, { get: (o, k) => (typeof k === "string" && k in o ? t(o[k as keyof T] as string) : (o as never)[k]) });
}

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: LANG, setLang: () => {} });

function remember(l: Lang) { try { localStorage.setItem(KEY, l); } catch { /* storage blocked */ } }

/** Label tables are built when the app loads, so a language change reloads the page once. */
export function LangProvider({ userLang, userChose, onSave, children }: { userLang?: Lang | null; userChose?: boolean;
  onSave?: (l: Lang) => Promise<unknown> | void; children: ReactNode }) {
  useEffect(() => { document.documentElement.lang = LANG; }, []);
  useEffect(() => {
    if (!userLang) return;
    const local = stored();
    if (!userChose && local) { if (local !== userLang) onSave?.(local); return; }  // picked on this device before signing in
    if (userLang !== LANG) { remember(userLang); window.location.reload(); }
  }, [userLang, userChose]); // eslint-disable-line
  const setLang = async (l: Lang) => {
    if (l === LANG) return;
    remember(l);
    try { await onSave?.(l); } catch { /* still switch on this device */ }
    window.location.reload();
  };
  return <Ctx.Provider value={{ lang: LANG, setLang }}>{children}</Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);

/** English | Español switch. */
export function LangSwitch({ dark }: { dark?: boolean }) {
  const { lang: cur, setLang } = useLang();
  return <div role="group" aria-label={t("Language")} style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 999, padding: 2, gap: 2, background: dark ? "transparent" : "#fff" }}>
    {(["en", "es"] as const).map((l) => <button key={l} type="button" aria-pressed={cur === l} onClick={() => setLang(l)}
      style={{ border: "none", borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer",
        background: cur === l ? "var(--blue-deep)" : "transparent", color: cur === l ? "#fff" : "var(--body)" }}>{l === "en" ? "English" : "Español"}</button>)}
  </div>;
}
