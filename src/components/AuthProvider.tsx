"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const userIdentityRef = useRef<string | null>(null);

  const setStableUser = useCallback((nextUser: User | null) => {
    const nextIdentity = nextUser
      ? `${nextUser.id}:${nextUser.email?.toLowerCase().trim() ?? ""}`
      : null;

    if (userIdentityRef.current === nextIdentity) {
      return;
    }

    userIdentityRef.current = nextIdentity;
    setUser(nextUser);
  }, []);

  const loadUser = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error: getUserError } = await supabase.auth.getUser();

      if (getUserError) {
        throw getUserError;
      }

      setStableUser(data.user ?? null);
      setError(null);
    } catch (err) {
      console.error("Falha ao recuperar sessão:", err);
      setStableUser(null);
      setError("Não conseguimos confirmar sua sessão. Tente novamente.");
    } finally {
      setIsLoading(false);
    }
  }, [setStableUser]);

  useEffect(() => {
    void loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setStableUser(session?.user ?? null);
      setError(null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [loadUser, setStableUser]);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      error,
      refresh: loadUser,
    }),
    [user, isLoading, error, loadUser],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth precisa estar dentro de um AuthProvider");
  }

  return context;
}


