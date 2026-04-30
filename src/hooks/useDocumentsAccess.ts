"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";

type ModuleKey = "documentos" | "dashboards" | "perfil";

type ModulesAccess = Record<ModuleKey, boolean>;

type AccessRole = "admin" | "colaborador" | "gerente_loja";

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
  const isMountedRef = useRef(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const userId = user?.id ?? null;
  const normalizedEmail = user?.email?.toLowerCase().trim() ?? null;
  const [modules, setModules] = useState<ModulesAccess>({
    documentos: false,
    dashboards: false,
    perfil: false,
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState<AccessRole>("colaborador");

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchAccess = useCallback(async () => {
    if (!userId) {
      if (isMountedRef.current) {
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
      }
      return;
    }

    if (isMountedRef.current) {
      setLoading(true);
    }
    try {
      const selectWithModule = async (
        column: "user_id" | "email",
        value: string,
      ) => {
        return supabase
          .from("documentos_acesso")
          .select("id,modulo")
          .eq("scope", "admin")
          .eq(column, value);
      };

      const selectWithoutModule = async (
        column: "user_id" | "email",
        value: string,
      ) => {
        return supabase
          .from("documentos_acesso")
          .select("id")
          .eq("scope", "admin")
          .eq(column, value);
      };

      const selectGerenteAccess = async (
        column: "user_id" | "email",
        value: string,
      ) => {
        return supabase
          .from("documentos_acesso")
          .select("id")
          .eq("scope", "gerente")
          .eq(column, value);
      };

      const baseModules: ModulesAccess = {
        documentos: false,
        dashboards: false,
        perfil: false,
      };
      let resolvedIsAdmin = false;
      let hasAnyModulePermission = false;

      const applyRecords = (records: { modulo?: string | null }[] | null) => {
        records?.forEach((item) => {
          hasAnyModulePermission = true;
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

      let { data, error } = await selectWithModule("user_id", userId);
      if (error && error.message?.toLowerCase().includes("modulo")) {
        const fallback = await selectWithoutModule("user_id", userId);
        data =
          fallback.data?.map((item) => ({
            ...item,
            modulo: null,
          })) ?? null;
        error = fallback.error;
      }
      if (error && error.message?.toLowerCase().includes("scope")) {
        const fallback = await supabase
          .from("documentos_acesso")
          .select("id,modulo")
          .eq("user_id", userId);
        data = fallback.data ?? null;
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
        if (emailError && emailError.message?.toLowerCase().includes("scope")) {
          const fallback = await supabase
            .from("documentos_acesso")
            .select("id,modulo")
            .eq("email", normalizedEmail);
          emailData = fallback.data ?? null;
          emailError = fallback.error;
        }
        if (emailError) {
          throw emailError;
        }
        applyRecords(emailData ?? null);
      }

      let isGerenteLoja = false;
      if (!resolvedIsAdmin) {
        const gerenteById = await selectGerenteAccess("user_id", userId);
        if (gerenteById.error?.message?.toLowerCase().includes("scope")) {
          isGerenteLoja = false;
        } else if (gerenteById.error) {
          console.error("Erro ao verificar gerente por ID:", gerenteById.error);
        } else if ((gerenteById.data ?? []).length > 0) {
          isGerenteLoja = true;
        } else if (normalizedEmail) {
          const gerenteByEmail = await selectGerenteAccess("email", normalizedEmail);
          if (gerenteByEmail.error?.message?.toLowerCase().includes("scope")) {
            isGerenteLoja = false;
          } else if (gerenteByEmail.error) {
            console.error("Erro ao verificar gerente por e-mail:", gerenteByEmail.error);
          } else if ((gerenteByEmail.data ?? []).length > 0) {
            isGerenteLoja = true;
          }
        }
      }

      if (resolvedIsAdmin) {
        baseModules.documentos = true;
        baseModules.dashboards = true;
        baseModules.perfil = true;
      } else if (isGerenteLoja || hasAnyModulePermission || Boolean(userId)) {
        // Colaborador autenticado deve manter acesso ao fluxo de formularios/documentos.
        baseModules.documentos = true;
      }

      const resolvedHasAccess =
        resolvedIsAdmin ||
        isGerenteLoja ||
        Object.values(baseModules).some(Boolean);

      if (isMountedRef.current) {
        setModules(baseModules);
        setIsAdmin(resolvedIsAdmin);
        if (resolvedIsAdmin) {
          setRole("admin");
        } else if (isGerenteLoja) {
          setRole("gerente_loja");
        } else {
          setRole("colaborador");
        }
        setHasAccess(resolvedHasAccess);
        setError(null);
      }
    } catch (err) {
      console.error("Erro ao verificar permissoes de documentos:", err);
      if (isMountedRef.current) {
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
            : "Nao foi possivel confirmar seu acesso.",
        );
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [userId, normalizedEmail]);

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


