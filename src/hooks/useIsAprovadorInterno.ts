"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";

export function useIsAprovadorInterno() {
  const { user, isLoading: authLoading } = useAuth();
  const [isAprovador, setIsAprovador] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchIsAprovador = useCallback(async () => {
    if (!user) {
      setIsAprovador(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      const token = data.session?.access_token;
      if (!token) {
        setIsAprovador(false);
        return;
      }

      const response = await fetch("/api/orcamentos-internos/aprovador", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json()) as {
        isAprovador?: boolean;
        error?: string;
      };
      setIsAprovador(response.ok ? Boolean(payload.isAprovador) : false);
    } catch (err) {
      console.error("Erro ao verificar aprovador de orcamentos internos:", err);
      setIsAprovador(false);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) {
      void fetchIsAprovador();
    }
  }, [authLoading, fetchIsAprovador]);

  return { isAprovadorInterno: isAprovador, loading: authLoading || loading };
}
