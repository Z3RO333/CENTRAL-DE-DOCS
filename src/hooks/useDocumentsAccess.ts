"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useSimulacao } from "@/components/SimulacaoProvider";

type ModuleKey = "documentos" | "dashboards" | "perfil";

type ModulesAccess = Record<ModuleKey, boolean>;

type AccessRole = "admin" | "colaborador" | "gerente_loja" | "fornecedor";

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
  const { simulacao } = useSimulacao();
  const isMountedRef = useRef(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Em simulação, calcula o acesso pela identidade simulada (só por email).
  const realUserId = user?.id ?? null;
  const userId = simulacao ? null : realUserId;
  const normalizedEmail = simulacao
    ? simulacao.email.toLowerCase().trim()
    : user?.email?.toLowerCase().trim() ?? null;
  const sessionActive = Boolean(realUserId);
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
    if (!sessionActive) {
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

      const selectScopedAccess = async (
        scope: "gerente" | "fornecedor",
        column: "user_id" | "email",
        value: string,
      ) => {
        return supabase
          .from("documentos_acesso")
          .select("id")
          .eq("scope", scope)
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

      // Em simulação, userId é null → pula as queries por user_id e usa só email.
      if (userId) {
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
      }

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

      const checkScopedAccess = async (scope: "gerente" | "fornecedor") => {
        const byId = userId
          ? await selectScopedAccess(scope, "user_id", userId)
          : { data: [] as { id: string }[], error: null };
        if (byId.error?.message?.toLowerCase().includes("scope")) {
          return false;
        }
        if (byId.error) {
          console.error(`Erro ao verificar ${scope} por ID:`, byId.error);
          return false;
        }
        if ((byId.data ?? []).length > 0) {
          return true;
        }
        if (!normalizedEmail) {
          return false;
        }
        const byEmail = await selectScopedAccess(scope, "email", normalizedEmail);
        if (byEmail.error?.message?.toLowerCase().includes("scope")) {
          return false;
        }
        if (byEmail.error) {
          console.error(`Erro ao verificar ${scope} por e-mail:`, byEmail.error);
          return false;
        }
        return (byEmail.data ?? []).length > 0;
      };

      let isGerenteLoja = false;
      let isFornecedor = false;
      if (!resolvedIsAdmin) {
        isGerenteLoja = await checkScopedAccess("gerente");
        if (!isGerenteLoja) {
          isFornecedor = await checkScopedAccess("fornecedor");
        }
      }

      if (resolvedIsAdmin) {
        baseModules.documentos = true;
        baseModules.dashboards = true;
        baseModules.perfil = true;
      } else if (isGerenteLoja || isFornecedor || hasAnyModulePermission || sessionActive) {
        // Colaborador autenticado deve manter acesso ao fluxo de formularios/documentos.
        baseModules.documentos = true;
      }

      const resolvedHasAccess =
        resolvedIsAdmin ||
        isGerenteLoja ||
        isFornecedor ||
        Object.values(baseModules).some(Boolean);

      if (isMountedRef.current) {
        setModules(baseModules);
        setIsAdmin(resolvedIsAdmin);
        if (resolvedIsAdmin) {
          setRole("admin");
        } else if (isGerenteLoja) {
          setRole("gerente_loja");
        } else if (isFornecedor) {
          setRole("fornecedor");
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
  }, [userId, normalizedEmail, sessionActive]);

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


