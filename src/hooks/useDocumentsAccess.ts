"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";

type ModuleKey = "documentos" | "dashboards" | "perfil";

type ModulesAccess = Record<ModuleKey, boolean>;

type UseDocumentsAccessResult = {
  hasAccess: boolean;
  modules: ModulesAccess;
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
  const [modules, setModules] = useState<ModulesAccess>({
    documentos: false,
    dashboards: false,
    perfil: false,
  });

  const fetchAccess = useCallback(async () => {
    if (!user) {
      setHasAccess(false);
      setLoading(false);
      setError(null);
      setModules({
        documentos: false,
        dashboards: false,
        perfil: false,
      });
      return;
    }

    setLoading(true);
    try {
      const filters: string[] = [`user_id.eq.${user.id}`];
      if (normalizedEmail) {
        filters.push(`email.eq.${normalizedEmail}`);
      }

      const { data, error: queryError } = await supabase
        .from("documentos_acesso")
        .select("id,modulo")
        .or(filters.join(","));

      if (queryError) {
        if (queryError.message?.toLowerCase().includes("modulo")) {
          const {
            data: fallbackData,
            error: fallbackError,
          } = await supabase
            .from("documentos_acesso")
            .select("id")
            .or(filters.join(","));

          if (fallbackError) {
            throw fallbackError;
          }

          const hasAny = Boolean(fallbackData && fallbackData.length > 0);
          setModules({
            documentos: hasAny,
            dashboards: false,
            perfil: false,
          });
          setHasAccess(hasAny);
          setError(null);
          return;
        }
        throw queryError;
      }

      const baseModules: ModulesAccess = {
        documentos: false,
        dashboards: false,
        perfil: false,
      };

      data?.forEach((item) => {
        const modulo = (item.modulo ?? "documentos") as ModuleKey;
        if (modulo in baseModules) {
          baseModules[modulo] = true;
        }
      });

      setModules(baseModules);
      setHasAccess(
        baseModules.documentos ||
          baseModules.dashboards ||
          baseModules.perfil,
      );
      setError(null);
    } catch (err) {
      console.error("Erro ao verificar permissões de documentos:", err);
      setHasAccess(false);
      setModules({
        documentos: false,
        dashboards: false,
        perfil: false,
      });
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
    modules,
    loading: authLoading || loading,
    error,
    refresh: fetchAccess,
  };
}
