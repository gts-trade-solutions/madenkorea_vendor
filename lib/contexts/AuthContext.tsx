// /lib/contexts/AuthContext.tsx
"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type UserRole = "customer" | "admin";

type SessionUser = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  role?: UserRole; // NEW
};

type AuthContextType = {
  user: SessionUser | null;
  isAuthenticated: boolean;
  ready: boolean;
  isAdmin: boolean; // NEW
  hasRole: (role: UserRole) => boolean; // NEW
  login: (c: { email: string; password: string }) => Promise<void>;
  register: (r: {
    full_name: string;
    email: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({} as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  async function loadFromSession() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const authed = session?.user ?? null;
    if (!authed) {
      setUser(null);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, avatar_url, role")
      .eq("id", authed.id)
      .maybeSingle();

    setUser({
      id: authed.id,
      email: authed.email,
      full_name: profile?.full_name ?? authed.user_metadata?.full_name ?? null,
      avatar_url:
        profile?.avatar_url ?? authed.user_metadata?.avatar_url ?? null,
      role: (profile?.role as UserRole) ?? "customer",
    });
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      await loadFromSession();
      if (mounted) setReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, _session) => {
      loadFromSession().finally(() => setReady(true));
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const login = async (c: { email: string; password: string }) => {
    const { error } = await supabase.auth.signInWithPassword(c);
    if (error) throw error;
    await loadFromSession();
    setReady(true);
  };

  const register = async (r: {
    full_name: string;
    email: string;
    password: string;
  }) => {
    const { error } = await supabase.auth.signUp({
      email: r.email,
      password: r.password,
      options: { data: { full_name: r.full_name } },
    });
    if (error) throw error;
    await loadFromSession();
    setReady(true);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setReady(true);
  };

  const refreshProfile = async () => {
    await loadFromSession();
  };

  const hasRole = (role: UserRole) => user?.role === role;
  const isAdmin = hasRole("admin");

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      ready,
      isAdmin,
      hasRole,
      login,
      register,
      logout,
      refreshProfile,
    }),
    [user, ready]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
