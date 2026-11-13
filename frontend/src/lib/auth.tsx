import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";
import type { Me } from "./types";

/** Sign-in goes through 4Geeks: the browser visits the 4Geeks hosted login (or GitHub), comes back to
 *  /auth/callback?token=…, and `exchange` trades that 4Geeks token for a Career Hub session. */
export type AuthConfig = { breathcode_url: string; dev_password_login: boolean };

export const callbackUrl = () => `${window.location.origin}/auth/callback`;
export const fourGeeksLoginUrl = (bc: string) => `${bc}/v1/auth/view/login?url=${encodeURIComponent(callbackUrl())}`;
export const githubLoginUrl = (bc: string) => `${bc}/v1/auth/github/?url=${encodeURIComponent(callbackUrl())}`;
export const forgotPasswordUrl = (bc: string) => `${bc}/v1/auth/password/reset?url=${encodeURIComponent(`${window.location.origin}/login`)}`;

type AuthCtx = {
  user: Me | null;
  loading: boolean;
  exchange: (fourGeeksToken: string) => Promise<Me>;
  devLogin: (email: string, password: string) => Promise<Me>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) { setUser(null); setLoading(false); return; }
    try { setUser(await api.get<Me>("/auth/me")); } catch { setUser(null); } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const start = (r: { token: string; user: Me }) => { setToken(r.token); setUser(r.user); return r.user; };
  const exchange = async (token: string) => start(await api.post<{ token: string; user: Me }>("/auth/breathcode", { token }));
  const devLogin = async (email: string, password: string) => start(await api.post<{ token: string; user: Me }>("/auth/login", { email, password }));
  const logout = () => { setToken(null); setUser(null); window.location.href = "/login"; };

  return <Ctx.Provider value={{ user, loading, exchange, devLogin, logout, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
export const homeFor = (u: Me) => (u.role === "student" ? "/" : "/staff");
