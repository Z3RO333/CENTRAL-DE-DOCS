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
      const selectWithModule = async (
        column: "user_id" | "email",
        value: string,
      ) => {
        return supabase
          .from("documentos_acesso")
          .select("id,modulo")
          .eq(column, value);
      };

      const selectWithoutModule = async (
        column: "user_id" | "email",
        value: string,
      ) => {
        return supabase
          .from("documentos_acesso")
          .select("id")
          .eq(column, value);
      };

      const baseModules: ModulesAccess = {
        documentos: false,
        dashboards: false,
        perfil: false,
      };

      const applyRecords = (records: { modulo?: string | null }[] | null) => {
        records?.forEach((item) => {
          const modulo = (item.modulo ?? "documentos") as ModuleKey;
          if (modulo in baseModules) {
            baseModules[modulo] = true;
          }
        });
      };

      let dataResult: { modulo?: string | null }[] | null = null;

      let { data, error } = await selectWithModule("user_id", user.id);
      if (error && error.message?.toLowerCase().includes("modulo")) {
        const fallback = await selectWithoutModule("user_id", user.id);
        data =
          fallback.data?.map((item) => ({
            ...item,
            modulo: null,
          })) ?? null;
        error = fallback.error;
      }
      if (error) {
        throw error;
      }

      dataResult = data;
      applyRecords(dataResult);

      if ((!dataResult || dataResult.length === 0) && normalizedEmail) {
        let {
          data: emailData,
          error: emailError,
        } = await selectWithModule("email", normalizedEmail);
        if (
          emailError &&
          emailError.message?.toLowerCase().includes("modulo")
        ) {
          const fallback = await selectWithoutModule("email", normalizedEmail);
          emailData =
            fallback.data?.map((item) => ({
              ...item,
              modulo: null,
            })) ?? null;
          emailError = fallback.error;
        }
        if (emailError) {
          throw emailError;
        }
        applyRecords(emailData ?? null);
      }

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
