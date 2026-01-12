"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";

type ModuleKey = "documentos" | "dashboards" | "perfil";

type ModulesAccess = Record<ModuleKey, boolean>;

type AccessRole = "admin" | "colaborador";

type UseDocumentsAccessResult = {
  hasAccess: boolean;
  isAdmin: boolean;
  role: AccessRole;
  modules: ModulesAccess;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const ADMIN_MODULES = ["admin", "documentos", "dashboards", "perfil"] as const;
const ADMIN_MODULE_SET = new Set<string>(ADMIN_MODULES);

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
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState<AccessRole>("colaborador");

  const fetchAccess = useCallback(async () => {
    if (!user) {
      setHasAccess(false);
      setIsAdmin(false);
      setRole("colaborador");
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
        documentos: true,
        dashboards: false,
        perfil: false,
      };
      let resolvedIsAdmin = false;

      const applyRecords = (records: { modulo?: string | null }[] | null) => {
        records?.forEach((item) => {
          const modulo = item.modulo ?? "documentos";
          if (ADMIN_MODULE_SET.has(modulo)) {
            resolvedIsAdmin = true;
          }
          const typed = modulo as ModuleKey;
          if (typed in baseModules) {
            baseModules[typed] = true;
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

      if (resolvedIsAdmin) {
        baseModules.documentos = true;
        baseModules.dashboards = true;
        baseModules.perfil = true;
      }
      setModules(baseModules);
      setIsAdmin(resolvedIsAdmin);
      setRole(resolvedIsAdmin ? "admin" : "colaborador");
      setHasAccess(Boolean(user));
      setError(null);
    } catch (err) {
      console.error("Erro ao verificar permissões de documentos:", err);
      setHasAccess(false);
      setIsAdmin(false);
      setRole("colaborador");
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
    isAdmin,
    role,
    modules,
    loading: authLoading || loading,
    error,
    refresh: fetchAccess,
  };
}
