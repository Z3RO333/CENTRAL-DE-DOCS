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
import { useLojas } from "@/hooks/useLojas";
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
    return "Usuário";
  }
  const handle = email.split("@")[0] ?? "";
  if (!handle) {
    return "Usuário";
  }
  return handle
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
};

const getDisplayName = (user: AppUser) =>
  user.name?.trim() || getNameFromEmail(user.email);

const getRoleLabel = (role: "admin" | "gerente_loja" | "colaborador") => {
  if (role === "admin") {
    return "Administrador";
  }
  if (role === "gerente_loja") {
    return "Gerente de Loja";
  }
  return "Colaborador";
};

export default function UsuariosPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();
  const { lojas, updateLoja } = useLojas({ enabled: isAdmin });
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
  const [editingRole, setEditingRole] = useState<
    "admin" | "colaborador" | "gerente_loja"
  >("colaborador");
  const [editingLojaId, setEditingLojaId] = useState<string>("");
  const [savingRole, setSavingRole] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const adminPermissions = useMemo(
    () => permissions.filter((permission) => ADMIN_MODULES.has(permission.module)),
    [permissions],
  );
  const gerenteEmails = useMemo(
    () =>
      new Set(
        lojas.flatMap((loja) =>
          loja.usuarios.map((email) => email.toLowerCase()),
        ),
      ),
    [lojas],
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

  const isUserGerente = useCallback(
    (target: AppUser) => {
      const normalizedEmail = target.email?.toLowerCase().trim() ?? null;
      if (!normalizedEmail) {
        return false;
      }
      return gerenteEmails.has(normalizedEmail);
    },
    [gerenteEmails],
  );

  const getUserRole = useCallback(
    (target: AppUser) => {
      if (isUserAdmin(target)) {
        return "admin";
      }
      if (isUserGerente(target)) {
        return "gerente_loja";
      }
      return "colaborador";
    },
    [isUserAdmin, isUserGerente],
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
        throw new Error("Sessão expirada. Faça login novamente.");
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
        throw new Error(payload.error ?? "Falha ao carregar usuários.");
      }
      setUsers(payload.users ?? []);
    } catch (err) {
      setUsers([]);
      setUsersError(
        err instanceof Error ? err.message : "Falha ao carregar usuários.",
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
      const gerente = isUserGerente(target);
      const gerenteLoja =
        gerente && target.email
          ? lojas.find((loja) =>
              loja.usuarios
                .map((email) => email.toLowerCase())
                .includes(target.email!.toLowerCase()),
            ) ?? null
          : null;
      setEditingUser(target);
      setEditingRole(admin ? "admin" : gerente ? "gerente_loja" : "colaborador");
      setEditingLojaId(gerenteLoja?.id ?? "");
      setFeedback(null);
    },
    [isUserAdmin, isUserGerente, lojas],
  );

  const handleSaveRole = useCallback(async () => {
    if (!editingUser) {
      return;
    }
    setSavingRole(true);
    setFeedback(null);
    try {
      const normalizedEmail = editingUser.email?.toLowerCase().trim() ?? "";
      if (editingRole === "gerente_loja" && !editingLojaId) {
        throw new Error("Selecione a loja do gerente.");
      }
      if (editingRole === "gerente_loja" && !normalizedEmail) {
        throw new Error("Informe o e-mail do usuário para virar gerente.");
      }
      const admin = isUserAdmin(editingUser);
      if (editingRole === "admin" && !admin) {
        await grantPermission({
          email: editingUser.email ?? "",
          userId: editingUser.id,
          module: "admin",
        });
      }
      if (editingRole !== "admin" && admin) {
        const entries = getAdminEntriesForUser(editingUser);
        await Promise.all(entries.map((entry) => revokePermission(entry.id)));
      }

      if (normalizedEmail) {
        if (editingRole === "gerente_loja") {
          await Promise.all(
            lojas.map((loja) => {
              const hasEmail = loja.usuarios
                .map((email) => email.toLowerCase())
                .includes(normalizedEmail);
              if (loja.id === editingLojaId && !hasEmail) {
                return updateLoja({
                  id: loja.id,
                  usuarios: [...loja.usuarios, normalizedEmail],
                });
              }
              if (loja.id !== editingLojaId && hasEmail) {
                return updateLoja({
                  id: loja.id,
                  usuarios: loja.usuarios.filter(
                    (email) => email.toLowerCase() !== normalizedEmail,
                  ),
                });
              }
              return Promise.resolve(null);
            }),
          );
        } else {
          await Promise.all(
            lojas.map((loja) => {
              if (
                loja.usuarios
                  .map((email) => email.toLowerCase())
                  .includes(normalizedEmail)
              ) {
                return updateLoja({
                  id: loja.id,
                  usuarios: loja.usuarios.filter(
                    (email) => email.toLowerCase() !== normalizedEmail,
                  ),
                });
              }
              return Promise.resolve(null);
            }),
          );
        }
      }

      await refreshPermissions();
      setEditingUser(null);
      setFeedback("Função atualizada com sucesso.");
    } catch (err) {
      setFeedback(
        err instanceof Error ? err.message : "Falha ao atualizar a função.",
      );
    } finally {
      setSavingRole(false);
    }
  }, [
    editingUser,
    editingRole,
    editingLojaId,
    getAdminEntriesForUser,
    grantPermission,
    isUserAdmin,
    lojas,
    refreshPermissions,
    revokePermission,
    updateLoja,
  ]);

  if (authLoading || accessLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando usuários...
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
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">\n\n      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Gerenciamento de usuários
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Aqui você pode gerenciar os usuários da aplicação. Altere as funções
          e permissões de cada usuário.
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
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">Nome</th>
                <th className="px-5 py-3 text-left">E-mail</th>
                <th className="px-5 py-3 text-left">Função</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {usersLoading || permissionsLoading ? (
                <tr>
                  <td className="px-5 py-6 text-center text-slate-500" colSpan={5}>
                    Carregando usuários...
                  </td>
                </tr>
              ) : visibleUsers.length === 0 ? (
                <tr>
                  <td className="px-5 py-6 text-center text-slate-500" colSpan={5}>
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              ) : (
                visibleUsers.map((entry) => {
                  const role = getUserRole(entry);
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
                          {getRoleLabel(role)}
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
                          aria-label="Editar usuário"
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
                Editar usuário
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {getDisplayName(editingUser)}
              </p>
              <p className="text-xs text-slate-500">{editingUser.email}</p>
            </div>
            <div className="mt-4">
              <label className="text-xs font-semibold text-slate-600">
                Função
                <select
                  value={editingRole}
                  onChange={(event) => {
                    const value = event.target.value as
                      | "admin"
                      | "colaborador"
                      | "gerente_loja";
                    setEditingRole(value);
                    if (value !== "gerente_loja") {
                      setEditingLojaId("");
                    }
                  }}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
                >
                  <option value="admin">Administrador</option>
                  <option value="colaborador">Colaborador</option>
                  <option value="gerente_loja">Gerente de Loja</option>
                </select>
              </label>
              <p className="mt-2 text-[11px] text-slate-500">
                Administradores veem todas as telas. Colaboradores veem apenas os
                documentos do grupo vinculado ao e-mail. Gerentes veem os
                documentos da sua loja.
              </p>
              {editingRole === "gerente_loja" && (
                <label className="mt-4 block text-xs font-semibold text-slate-600">
                  Loja
                  <select
                    value={editingLojaId}
                    onChange={(event) => setEditingLojaId(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
                  >
                    <option value="">Selecione uma loja</option>
                    {lojas.map((loja) => (
                      <option key={loja.id} value={loja.id}>
                        {loja.nome}
                        {loja.codigo ? ` - ${loja.codigo}` : ""}
                      </option>
                    ))}
                  </select>
                  {lojas.length === 0 && (
                    <span className="mt-2 block text-[11px] font-normal text-slate-500">
                      Cadastre uma loja antes de atribuir o gerente.
                    </span>
                  )}
                </label>
              )}
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






