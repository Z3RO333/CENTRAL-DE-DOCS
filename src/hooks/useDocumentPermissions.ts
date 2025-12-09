"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type DocumentPermission = {
  id: string;
  user_id: string | null;
  email: string | null;
  created_at: string;
};

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
        .select("id,user_id,email,created_at")
        .order("created_at", { ascending: false });

      if (queryError) {
        throw queryError;
      }

      setPermissions(
        data?.map((item) => ({
          id: item.id as string,
          user_id: item.user_id as string | null,
          email: item.email as string | null,
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
    async ({ email, userId }: { email: string; userId?: string }) => {
      if (!enabled) {
        throw new Error("Gerenciamento de permissões está desabilitado.");
      }
      const normalizedEmail = email.toLowerCase().trim();

      if (!normalizedEmail) {
        throw new Error("Informe o e-mail do usuário.");
      }

      const exists = normalizedPermissions.find(
        (permission) =>
          permission.email === normalizedEmail ||
          (userId && permission.user_id === userId),
      );
      if (exists) {
        throw new Error("Esse usuário já possui permissão.");
      }

      const payload: Record<string, string> = {
        email: normalizedEmail,
      };

      if (userId) {
        payload.user_id = userId;
      }

      const { data, error: insertError } = await supabase
        .from("documentos_acesso")
        .insert(payload)
        .select("id,user_id,email,created_at")
        .single();

      if (insertError) {
        throw insertError;
      }

      if (data) {
        setPermissions((prev) => [
          {
            id: data.id as string,
            user_id: data.user_id as string | null,
            email: data.email as string | null,
            created_at: data.created_at as string,
          },
          ...prev,
        ]);
      }
    },
    [enabled, normalizedPermissions],
  );

  const revokePermission = useCallback(
    async (permissionId: string) => {
      if (!enabled) {
        throw new Error("Gerenciamento de permissões está desabilitado.");
      }
      if (!permissionId) {
        return;
      }
      const { error: deleteError } = await supabase
        .from("documentos_acesso")
        .delete()
        .eq("id", permissionId);

      if (deleteError) {
        throw deleteError;
      }

      setPermissions((prev) => prev.filter((item) => item.id !== permissionId));
    },
    [enabled],
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
