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
  const normalizedEmail = user?.email?.toLowerCase().trim() ?? null;

  const fetchAccess = useCallback(async () => {
    if (!user) {
      setHasAccess(false);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const baseQuery = supabase
        .from("documentos_acesso")
        .select("id")
        .limit(1);

      let dataResult = null;
      let queryError = null;

      const { data, error } = await baseQuery.eq("user_id", user.id).maybeSingle();
      dataResult = data;
      queryError = error;

      if (!dataResult && !queryError && normalizedEmail) {
        const { data: emailData, error: emailError } = await baseQuery
          .eq("email", normalizedEmail)
          .maybeSingle();
        dataResult = emailData;
        queryError = emailError;
      }

      if (queryError) {
        throw queryError;
      }

      setHasAccess(Boolean(dataResult));
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
  }, [user, normalizedEmail]);

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
