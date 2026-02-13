"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Search } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { useDocumentPermissions } from "@/hooks/useDocumentPermissions";
import { useLojas } from "@/hooks/useLojas";
import { usePrestadores } from "@/hooks/usePrestadores";
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

type GerenteAccessEntry = {
  id: string;
  user_id: string | null;
  email: string | null;
  loja_id: string | null;
  prestador_id: string | null;
  can_view_all: boolean | null;
};

type LojaAccessConfig = {
  canViewAll: boolean;
  prestadorIds: string[];
};

type FeedbackState = {
  kind: "success" | "error";
  message: string;
} | null;

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
  const { lojas } = useLojas({ enabled: isAdmin });
  const {
    prestadores,
    loading: prestadoresLoading,
    error: prestadoresError,
  } = usePrestadores({ enabled: isAdmin });
  const {
    permissions,
    loading: permissionsLoading,
    error: permissionsError,
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
  const [selectedLojas, setSelectedLojas] = useState<string[]>([]);
  const [lojaAccess, setLojaAccess] = useState<Record<string, LojaAccessConfig>>(
    {},
  );
  const [savingRole, setSavingRole] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [gerenteEntries, setGerenteEntries] = useState<GerenteAccessEntry[]>([]);
  const [gerenteEntriesLoading, setGerenteEntriesLoading] = useState(false);
  const [gerenteEntriesError, setGerenteEntriesError] = useState<string | null>(
    null,
  );

  const adminPermissions = useMemo(
    () => permissions.filter((permission) => ADMIN_MODULES.has(permission.module)),
    [permissions],
  );
  const gerenteIds = useMemo(
    () =>
      new Set(
        gerenteEntries
          .map((entry) => entry.user_id)
          .filter((value): value is string => Boolean(value)),
      ),
    [gerenteEntries],
  );
  const gerenteEmails = useMemo(
    () =>
      new Set(
        gerenteEntries
          .map((entry) => entry.email?.toLowerCase())
          .filter((value): value is string => Boolean(value)),
      ),
    [gerenteEntries],
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
      if (gerenteIds.has(target.id)) {
        return true;
      }
      if (!normalizedEmail) {
        return false;
      }
      return gerenteEmails.has(normalizedEmail);
    },
    [gerenteEmails, gerenteIds],
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

  const getAccessToken = useCallback(async () => {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }
    const token = sessionData.session?.access_token;
    if (!token) {
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    return token;
  }, []);

  const saveUserRole = useCallback(
    async (
      target: AppUser,
      role: "admin" | "colaborador" | "gerente_loja",
      access: {
        lojaId: string;
        canViewAll: boolean;
        prestadorIds: string[];
      }[],
    ) => {
      const token = await getAccessToken();
      const response = await fetch("/api/admin/users/role", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: target.id,
          email: target.email,
          role,
          access,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao atualizar funcao.");
      }
    },
    [getAccessToken],
  );

  const fetchGerenteEntries = useCallback(async () => {
    if (!isAdmin) {
      setGerenteEntries([]);
      setGerenteEntriesLoading(false);
      setGerenteEntriesError(null);
      return;
    }
    setGerenteEntriesLoading(true);
    setGerenteEntriesError(null);
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/admin/gerentes", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as {
        entries?: GerenteAccessEntry[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao carregar gerentes.");
      }
      setGerenteEntries(payload.entries ?? []);
    } catch (err) {
      setGerenteEntries([]);
      setGerenteEntriesError(
        err instanceof Error ? err.message : "Falha ao carregar gerentes.",
      );
    } finally {
      setGerenteEntriesLoading(false);
    }
  }, [getAccessToken, isAdmin]);

  const getGerenteEntriesForUser = useCallback(
    (target: AppUser) => {
      const normalizedEmail = target.email?.toLowerCase().trim() ?? null;
      return gerenteEntries.filter((entry) => {
        const sameId = entry.user_id && entry.user_id === target.id;
        const sameEmail =
          normalizedEmail &&
          entry.email?.toLowerCase().trim() === normalizedEmail;
        return sameId || sameEmail;
      });
    },
    [gerenteEntries],
  );

  const buildLojaAccessFromEntries = useCallback(
    (entries: GerenteAccessEntry[]) => {
      const access: Record<string, LojaAccessConfig> = {};
      entries.forEach((entry) => {
        const lojaId = entry.loja_id ?? "";
        if (!lojaId) {
          return;
        }
        const current = access[lojaId] ?? {
          canViewAll: false,
          prestadorIds: [],
        };
        if (entry.can_view_all) {
          access[lojaId] = { canViewAll: true, prestadorIds: [] };
          return;
        }
        if (current.canViewAll) {
          return;
        }
        if (entry.prestador_id) {
          current.prestadorIds.push(entry.prestador_id);
          access[lojaId] = current;
        }
      });

      Object.keys(access).forEach((lojaId) => {
        access[lojaId] = {
          ...access[lojaId],
          prestadorIds: Array.from(new Set(access[lojaId].prestadorIds)),
        };
      });

      return {
        selected: Object.keys(access),
        access,
      };
    },
    [],
  );

  const toggleLojaSelection = useCallback((lojaId: string, enabled: boolean) => {
    setSelectedLojas((prev) => {
      if (enabled) {
        return prev.includes(lojaId) ? prev : [...prev, lojaId];
      }
      return prev.filter((id) => id !== lojaId);
    });
    setLojaAccess((prev) => {
      const next = { ...prev };
      if (enabled) {
        if (!next[lojaId]) {
          next[lojaId] = { canViewAll: true, prestadorIds: [] };
        }
      } else {
        delete next[lojaId];
      }
      return next;
    });
  }, []);

  const toggleLojaViewAll = useCallback((lojaId: string, enabled: boolean) => {
    setLojaAccess((prev) => {
      const current = prev[lojaId] ?? { canViewAll: true, prestadorIds: [] };
      return {
        ...prev,
        [lojaId]: {
          canViewAll: enabled,
          prestadorIds: enabled ? [] : current.prestadorIds,
        },
      };
    });
  }, []);

  const togglePrestadorForLoja = useCallback(
    (lojaId: string, prestadorId: string, enabled: boolean) => {
      setLojaAccess((prev) => {
        const current = prev[lojaId] ?? { canViewAll: false, prestadorIds: [] };
        const nextPrestadores = enabled
          ? Array.from(new Set([...current.prestadorIds, prestadorId]))
          : current.prestadorIds.filter((id) => id !== prestadorId);
        return {
          ...prev,
          [lojaId]: {
            canViewAll: false,
            prestadorIds: nextPrestadores,
          },
        };
      });
    },
    [],
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
      void fetchGerenteEntries();
    }
  }, [authLoading, accessLoading, isAdmin, fetchUsers, fetchGerenteEntries]);

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
      const gerenteEntriesForUser = gerente
        ? getGerenteEntriesForUser(target)
        : [];
      const gerenteConfig = buildLojaAccessFromEntries(gerenteEntriesForUser);
      setEditingUser(target);
      setEditingRole(admin ? "admin" : gerente ? "gerente_loja" : "colaborador");
      setSelectedLojas(gerenteConfig.selected);
      setLojaAccess(gerenteConfig.access);
      setFeedback(null);
    },
    [
      buildLojaAccessFromEntries,
      getGerenteEntriesForUser,
      isUserAdmin,
      isUserGerente,
    ],
  );

  const handleSaveRole = useCallback(async () => {
    if (!editingUser) {
      return;
    }

    setSavingRole(true);
    setFeedback(null);

    try {
      const accessList =
        editingRole === "gerente_loja"
          ? selectedLojas.map((lojaId) => {
              const config = lojaAccess[lojaId] ?? {
                canViewAll: true,
                prestadorIds: [],
              };
              if (!config.canViewAll && config.prestadorIds.length === 0) {
                throw new Error(
                  "Selecione prestadores ou habilite o acesso total da loja.",
                );
              }
              return {
                lojaId,
                canViewAll: config.canViewAll,
                prestadorIds: config.prestadorIds,
              };
            })
          : [];

      if (editingRole === "gerente_loja" && accessList.length === 0) {
        throw new Error("Selecione ao menos uma loja para o gerente.");
      }

      await saveUserRole(editingUser, editingRole, accessList);
      await refreshPermissions();
      await fetchGerenteEntries();
      setEditingUser(null);
      setFeedback({ kind: "success", message: "Funcao atualizada com sucesso." });
    } catch (err) {
      setFeedback({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Falha ao atualizar a funcao.",
      });
    } finally {
      setSavingRole(false);
    }
  }, [
    editingUser,
    editingRole,
    fetchGerenteEntries,
    lojaAccess,
    refreshPermissions,
    saveUserRole,
    selectedLojas,
  ]);

  const combinedError =
    usersError || permissionsError || gerenteEntriesError || prestadoresError;

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
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Gerenciamento de usuários
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Aqui você pode gerenciar os usuários da aplicação. Altere as funções
          e permissões de cada usuário.
        </p>
      </header>

      {combinedError && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-xs text-red-700">
          {combinedError}
        </div>
      )}

      {feedback?.kind === "success" && (
        <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
          {feedback.message}
        </div>
      )}

      {feedback?.kind === "error" && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-xs text-red-700">
          {feedback.message}
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
                <th className="px-5 py-3 text-left">Funcao</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {usersLoading || permissionsLoading || gerenteEntriesLoading ? (
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
                  onChange={(event) => {
                    const value = event.target.value as
                      | "admin"
                      | "colaborador"
                      | "gerente_loja";
                    setEditingRole(value);
                    if (value !== "gerente_loja") {
                      setSelectedLojas([]);
                      setLojaAccess({});
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
                documentos do grupo vinculado ao e-mail. Gerentes veem apenas os
                documentos das lojas autorizadas e, se configurado, apenas dos
                prestadores selecionados.
              </p>
              {editingRole === "gerente_loja" && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs font-semibold text-slate-600">Lojas</p>
                  {lojas.length === 0 ? (
                    <span className="mt-2 block text-[11px] font-normal text-slate-500">
                      Cadastre uma loja antes de atribuir o gerente.
                    </span>
                  ) : (
                    <div className="grid gap-2">
                      {lojas.map((loja) => {
                        const checked = selectedLojas.includes(loja.id);
                        return (
                          <label
                            key={loja.id}
                            className="flex items-center gap-2 text-xs text-slate-600"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                toggleLojaSelection(loja.id, event.target.checked)
                              }
                              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                            />
                            <span>
                              {loja.nome}
                              {loja.codigo ? ` - ${loja.codigo}` : ""}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {selectedLojas.map((lojaId) => {
                    const loja = lojas.find((item) => item.id === lojaId);
                    const config = lojaAccess[lojaId] ?? {
                      canViewAll: true,
                      prestadorIds: [],
                    };

                    return (
                      <div
                        key={lojaId}
                        className="rounded-2xl border border-slate-200 p-3 text-xs text-slate-600"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-700">
                            {loja?.nome ?? "Loja"}
                          </span>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={config.canViewAll}
                              onChange={(event) =>
                                toggleLojaViewAll(lojaId, event.target.checked)
                              }
                              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                            />
                            Ver todos os prestadores
                          </label>
                        </div>

                        {!config.canViewAll && (
                          <div className="mt-3 space-y-2">
                            {prestadoresLoading ? (
                              <span className="text-[11px] text-slate-500">
                                Carregando prestadores...
                              </span>
                            ) : prestadores.length === 0 ? (
                              <span className="text-[11px] text-slate-500">
                                Nenhum prestador cadastrado.
                              </span>
                            ) : (
                              <div className="grid gap-2 sm:grid-cols-2">
                                {prestadores.map((prestador) => {
                                  const checked = config.prestadorIds.includes(
                                    prestador.id,
                                  );
                                  return (
                                    <label
                                      key={prestador.id}
                                      className="flex items-center gap-2 text-[11px] text-slate-600"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(event) =>
                                          togglePrestadorForLoja(
                                            lojaId,
                                            prestador.id,
                                            event.target.checked,
                                          )
                                        }
                                        className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                                      />
                                      <span>{prestador.nome}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
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
