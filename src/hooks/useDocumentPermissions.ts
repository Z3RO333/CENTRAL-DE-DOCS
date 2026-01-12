"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type PermissionModule = "admin" | "documentos" | "dashboards" | "perfil";

export type DocumentPermission = {
  id: string;
  user_id: string | null;
  email: string | null;
  module: PermissionModule;
  created_at: string;
};

const ADMIN_MODULES = new Set<string>([
  "admin",
  "documentos",
  "dashboards",
  "perfil",
]);

type UseDocumentPermissionsOptions = {
  enabled?: boolean;
};

type UseDocumentPermissionsResult = {
  permissions: DocumentPermission[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  grantPermission: (input: {
    email: string;
    userId?: string;
    module: PermissionModule;
  }) => Promise<void>;
  revokePermission: (permissionId: string) => Promise<void>;
};

export function useDocumentPermissions(
  options: UseDocumentPermissionsOptions = {},
): UseDocumentPermissionsResult {
  const { enabled = true } = options;
  const [permissions, setPermissions] = useState<DocumentPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const getAccessToken = useCallback(async () => {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }
    const token = sessionData.session?.access_token;
    if (!token) {
      throw new Error("Sessao expirou. Faca login novamente.");
    }
    return token;
  }, []);

  const normalizedPermissions = useMemo(
    () =>
      permissions.map((permission) => ({
        ...permission,
        email: permission.email?.toLowerCase() ?? null,
      })),
    [permissions],
  );

  const fetchPermissions = useCallback(async () => {
    if (!enabled) {
      setPermissions([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const { data, error: queryError } = await supabase
        .from("documentos_acesso")
        .select("id,user_id,email,modulo,created_at")
        .order("created_at", { ascending: false });

      if (queryError) {
        if (queryError.message?.toLowerCase().includes("modulo")) {
          const {
            data: fallbackData,
            error: fallbackError,
          } = await supabase
            .from("documentos_acesso")
            .select("id,user_id,email,created_at")
            .order("created_at", { ascending: false });

          if (fallbackError) {
            throw fallbackError;
          }

          setPermissions(
            fallbackData?.map((item) => ({
              id: item.id as string,
              user_id: item.user_id as string | null,
              email: item.email as string | null,
              module: "admin",
              created_at: item.created_at as string,
            })) ?? [],
          );
          setError(null);
          return;
        }
        throw queryError;
      }

      setPermissions(
        data?.map((item) => ({
          id: item.id as string,
          user_id: item.user_id as string | null,
          email: item.email as string | null,
          module: (item.modulo as PermissionModule | null) ?? "admin",
          created_at: item.created_at as string,
        })) ?? [],
      );
      setError(null);
    } catch (err) {
      console.error("Erro ao carregar permissões:", err);
      setPermissions([]);
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível carregar as permissões.",
      );
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void fetchPermissions();
  }, [fetchPermissions]);

  const grantPermission = useCallback(
    async ({
      email,
      userId,
      module,
    }: {
      email: string;
      userId?: string;
      module: PermissionModule;
    }) => {
      if (!enabled) {
        throw new Error("Gerenciamento de permissões está desabilitado.");
      }
      const normalizedEmail = email.toLowerCase().trim();

      if (!normalizedEmail) {
        throw new Error("Informe o e-mail do usuário.");
      }

      const exists = normalizedPermissions.find((permission) => {
        const sameIdentity =
          permission.email === normalizedEmail ||
          (userId && permission.user_id === userId);
        if (!sameIdentity) {
          return false;
        }
        if (module === "admin") {
          return ADMIN_MODULES.has(permission.module);
        }
        return permission.module === module;
      });
      if (exists) {
        throw new Error("Esse usuário já possui essa permissão.");
      }

      const token = await getAccessToken();
      const response = await fetch("/api/admin/permissions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "grant",
          email: normalizedEmail,
          module,
          userId,
        }),
      });

      const payload = (await response.json()) as {
        permission?: DocumentPermission;
        error?: string;
      };

      if (!response.ok || !payload.permission) {
        throw new Error(payload.error ?? "Falha ao conceder permissão.");
      }

      setPermissions((prev) => [payload.permission!, ...prev]);
    },
    [enabled, normalizedPermissions, getAccessToken],
  );

  const revokePermission = useCallback(
    async (permissionId: string) => {
      if (!enabled) {
        throw new Error("Gerenciamento de permissões está desabilitado.");
      }
      if (!permissionId) {
        return;
      }

      const token = await getAccessToken();
      const response = await fetch("/api/admin/permissions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "revoke",
          permissionId,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao remover permissão.");
      }

      setPermissions((prev) => prev.filter((item) => item.id !== permissionId));
    },
    [enabled, getAccessToken],
  );

  return {
    permissions,
    loading,
    error,
    refresh: fetchPermissions,
    grantPermission,
    revokePermission,
  };
}

