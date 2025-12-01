"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";

type UseDocumentsAccessResult = {
  hasAccess: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useDocumentsAccess(): UseDocumentsAccessResult {
  const { user, isLoading: authLoading } = useAuth();
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccess = useCallback(async () => {
    if (!user) {
      setHasAccess(false);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const { data, error: queryError } = await supabase
        .from("documentos_acesso")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (queryError) {
        throw queryError;
      }

      setHasAccess(Boolean(data));
      setError(null);
    } catch (err) {
      console.error("Erro ao verificar permissões de documentos:", err);
      setHasAccess(false);
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível confirmar seu acesso.",
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) {
      void fetchAccess();
    }
  }, [authLoading, fetchAccess]);

  return {
    hasAccess,
    loading: authLoading || loading,
    error,
    refresh: fetchAccess,
  };
}
