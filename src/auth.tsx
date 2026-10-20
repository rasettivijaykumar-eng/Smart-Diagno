import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { get, post } from "./api";

export type User = { id: string; name: string; email: string; role: "patient" | "doctor" | "pharmacy" | "admin"; status: string; authMethod: string; preferences: { browserNotifications?: boolean } };
type Config = { googleClientId: string | null; aiConfigured: boolean; demoAccounts: { password: string; emails: Record<string, string> } | null; integrations: Record<string, boolean> };

type AuthState = {
  user: User | null; profile: any; loading: boolean; config: Config | null;
  refresh: () => Promise<void>; logout: () => Promise<void>; setUser: (user: User) => void;
};

const AuthContext = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await get<{ user: User | null; profile: any }>("/me");
      setUserState(data.user);
      setProfile(data.profile ?? null);
    } catch {
      setUserState(null);
    }
  }, []);

  useEffect(() => {
    Promise.all([refresh(), get<Config>("/config").then(setConfig).catch(() => setConfig(null))]).finally(() => setLoading(false));
  }, [refresh]);

  const value = useMemo<AuthState>(() => ({
    user, profile, loading, config, refresh,
    setUser: (next) => setUserState(next),
    logout: async () => { await post("/auth/logout").catch(() => undefined); setUserState(null); setProfile(null); },
  }), [user, profile, loading, config, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
