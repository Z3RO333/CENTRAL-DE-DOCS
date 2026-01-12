"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Pencil, Search } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import {
  useDocumentPermissions,
  type DocumentPermission,
} from "@/hooks/useDocumentPermissions";
import { supabase } from "@/lib/supabaseClient";

const ADMIN_MODULES = new Set(["admin", "documentos", "dashboards", "perfil"]);

type AppUser = {
  id: string;
  email: string | null;
  name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  phone: string | null;
};

const PAGE_SIZES = [10, 20, 50];

const normalizeText = (value: string | null) =>
  value?.toLowerCase().normalize("NFKD") ?? "";

const getNameFromEmail = (email: string | null) => {
  if (!email) {
    return "Usuario";
  }
  const handle = email.split("@")[0] ?? "";
  if (!handle) {
    return "Usuario";
  }
  return handle
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
};

const getDisplayName = (user: AppUser) =>
  user.name?.trim() || getNameFromEmail(user.email);

const getRoleLabel = (isAdmin: boolean) =>
  isAdmin ? "Administrador" : "Colaborador";

export default function UsuariosPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();
  const {
    permissions,
    loading: permissionsLoading,
    error: permissionsError,
    grantPermission,
    revokePermission,
    refresh: refreshPermissions,
  } = useDocumentPermissions({ enabled: isAdmin });
  const [users, setUsers] = useState<AppUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [editingRole, setEditingRole] = useState<"admin" | "colaborador">(
    "colaborador",
  );
  const [savingRole, setSavingRole] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const adminPermissions = useMemo(
    () => permissions.filter((permission) => ADMIN_MODULES.has(permission.module)),
    [permissions],
  );

  const isUserAdmin = useCallback(
    (target: AppUser) => {
      const normalizedEmail = target.email?.toLowerCase().trim() ?? null;
      return adminPermissions.some((permission) => {
        const sameEmail = normalizedEmail && permission.email === normalizedEmail;
        const sameId = permission.user_id && permission.user_id === target.id;
        return sameEmail || sameId;
      });
    },
    [adminPermissions],
  );

  const getAdminEntriesForUser = useCallback(
    (target: AppUser): DocumentPermission[] => {
      const normalizedEmail = target.email?.toLowerCase().trim() ?? null;
      return adminPermissions.filter((permission) => {
        const sameEmail = normalizedEmail && permission.email === normalizedEmail;
        const sameId = permission.user_id && permission.user_id === target.id;
        return sameEmail || sameId;
      });
    },
    [adminPermissions],
  );

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }
      const token = sessionData.session?.access_token;
      if (!token) {
        throw new Error("Sessao expirada. Faca login novamente.");
      }
      const response = await fetch("/api/admin/users", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as {
        users?: AppUser[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao carregar usuarios.");
      }
      setUsers(payload.users ?? []);
    } catch (err) {
      setUsers([]);
      setUsersError(
        err instanceof Error ? err.message : "Falha ao carregar usuarios.",
      );
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || accessLoading) {
      return;
    }
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!isAdmin) {
      router.replace("/documentos");
    }
  }, [authLoading, accessLoading, user, isAdmin, router]);

  useEffect(() => {
    if (!authLoading && !accessLoading && isAdmin) {
      void fetchUsers();
    }
  }, [authLoading, accessLoading, isAdmin, fetchUsers]);

  const filteredUsers = useMemo(() => {
    if (!searchTerm.trim()) {
      return users;
    }
    const query = normalizeText(searchTerm.trim());
    return users.filter((entry) => {
      const name = normalizeText(entry.name ?? getNameFromEmail(entry.email));
      const email = normalizeText(entry.email ?? "");
      return name.includes(query) || email.includes(query);
    });
  }, [users, searchTerm]);

  const visibleUsers = useMemo(
    () => filteredUsers.slice(0, pageSize),
    [filteredUsers, pageSize],
  );

  const openEditor = useCallback(
    (target: AppUser) => {
      const admin = isUserAdmin(target);
      setEditingUser(target);
      setEditingRole(admin ? "admin" : "colaborador");
      setFeedback(null);
    },
    [isUserAdmin],
  );

  const handleSaveRole = useCallback(async () => {
    if (!editingUser) {
      return;
    }
    setSavingRole(true);
    setFeedback(null);
    try {
      const admin = isUserAdmin(editingUser);
      if (editingRole === "admin" && !admin) {
        await grantPermission({
          email: editingUser.email ?? "",
          userId: editingUser.id,
          module: "admin",
        });
      }
      if (editingRole === "colaborador" && admin) {
        const entries = getAdminEntriesForUser(editingUser);
        await Promise.all(entries.map((entry) => revokePermission(entry.id)));
      }
      await refreshPermissions();
      setEditingUser(null);
      setFeedback("Funcao atualizada com sucesso.");
    } catch (err) {
      setFeedback(
        err instanceof Error ? err.message : "Falha ao atualizar a funcao.",
      );
    } finally {
      setSavingRole(false);
    }
  }, [
    editingUser,
    editingRole,
    getAdminEntriesForUser,
    grantPermission,
    isUserAdmin,
    refreshPermissions,
    revokePermission,
  ]);

  if (authLoading || accessLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando usuarios...
      </div>
    );
  }

  if (authError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        {authError}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="font-medium">Home</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="font-semibold text-slate-700">Usuarios</span>
      </div>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Gerenciamento de usuarios
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Aqui voce pode gerenciar os usuarios da aplicacao. Altere as funcoes
          e permissoes de cada usuario.
        </p>
      </header>

      {(usersError || permissionsError || feedback) && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-xs text-red-700">
          {usersError || permissionsError || feedback}
        </div>
      )}

      <section className="rounded-2xl bg-white p-5 shadow-sm shadow-slate-200">
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <label className="text-xs font-semibold text-slate-600">
            Pesquisar
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Pesquisar por nome..."
                className="w-full text-sm text-slate-700 outline-none"
              />
              <Search className="h-4 w-4 text-slate-400" />
            </div>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Qtd. de registros
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm shadow-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">Nome</th>
                <th className="px-5 py-3 text-left">E-mail</th>
                <th className="px-5 py-3 text-left">Funcao</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {usersLoading || permissionsLoading ? (
                <tr>
                  <td className="px-5 py-6 text-center text-slate-500" colSpan={5}>
                    Carregando usuarios...
                  </td>
                </tr>
              ) : visibleUsers.length === 0 ? (
                <tr>
                  <td className="px-5 py-6 text-center text-slate-500" colSpan={5}>
                    Nenhum usuario encontrado.
                  </td>
                </tr>
              ) : (
                visibleUsers.map((entry) => {
                  const admin = isUserAdmin(entry);
                  return (
                    <tr key={entry.id} className="text-slate-700">
                      <td className="px-5 py-4">
                        <div className="font-semibold text-slate-900">
                          {getDisplayName(entry)}
                        </div>
                      </td>
                      <td className="px-5 py-4">{entry.email ?? "-"}</td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                          {getRoleLabel(admin)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-3 w-3 rounded-full bg-emerald-500" />
                          Ativo
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => openEditor(entry)}
                          disabled={!entry.email}
                          className="rounded-full border border-slate-200 p-2 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label="Editar usuario"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-100/80 px-4 py-6">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Editar usuario
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {getDisplayName(editingUser)}
              </p>
              <p className="text-xs text-slate-500">{editingUser.email}</p>
            </div>
            <div className="mt-4">
              <label className="text-xs font-semibold text-slate-600">
                Funcao
                <select
                  value={editingRole}
                  onChange={(event) =>
                    setEditingRole(event.target.value as "admin" | "colaborador")
                  }
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
                >
                  <option value="admin">Administrador</option>
                  <option value="colaborador">Colaborador</option>
                </select>
              </label>
              <p className="mt-2 text-[11px] text-slate-500">
                Administradores veem todas as telas. Colaboradores veem apenas os
                documentos do grupo vinculado ao email.
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="rounded-full border border-slate-200 px-4 py-2 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleSaveRole()}
                disabled={savingRole}
                className="rounded-full bg-sky-600 px-4 py-2 font-semibold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {savingRole ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
