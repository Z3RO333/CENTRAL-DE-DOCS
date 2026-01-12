"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  UserPlus,
  Users,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import {
  type PermissionModule,
  type DocumentPermission,
  useDocumentPermissions,
} from "@/hooks/useDocumentPermissions";
import { supabase } from "@/lib/supabaseClient";

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString("pt-BR");
};

const MODULE_BUTTONS: { key: PermissionModule; label: string }[] = [
  { key: "documentos", label: "Documentos" },
  { key: "dashboards", label: "Dashboards" },
  { key: "perfil", label: "Perfil" },
];

const MODULE_LABELS: Record<PermissionModule, string> = {
  documentos: "Documentos",
  dashboards: "Dashboards",
  perfil: "Perfil",
};

type AppUser = {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  phone: string | null;
};

export default function PermissoesPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const {
    modules: modulesAccess,
    loading: accessLoading,
    error: accessError,
    refresh: refreshModules,
  } = useDocumentsAccess();
  const canManagePermissions = modulesAccess.documentos;
  const {
    permissions,
    loading: permissionsLoading,
    error: permissionsError,
    grantPermission,
    revokePermission,
    refresh,
  } = useDocumentPermissions({
    enabled: canManagePermissions,
  });

  const [formState, setFormState] = useState({
    email: "",
    userId: "",
  });
  const [feedback, setFeedback] = useState<{
    error: string | null;
    success: string | null;
  }>({ error: null, success: null });
  const [granting, setGranting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPermissionId, setSelectedPermissionId] = useState<string>("");
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [appUsersLoading, setAppUsersLoading] = useState(true);
  const [appUsersError, setAppUsersError] = useState<string | null>(null);
  const [togglingTarget, setTogglingTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!authLoading && !accessLoading && user && !canManagePermissions) {
      router.replace("/dashboard");
    }
  }, [authLoading, accessLoading, user, canManagePermissions, router]);

  useEffect(() => {
    if (selectedPermissionId) {
      const stillExists = permissions.some(
        (permission) => permission.id === selectedPermissionId,
      );
      if (!stillExists) {
        setSelectedPermissionId("");
      }
    }
  }, [permissions, selectedPermissionId]);

  useEffect(() => {
    if (!canManagePermissions || authLoading || accessLoading) {
      return;
    }

    let active = true;
    const loadUsers = async () => {
      setAppUsersLoading(true);
      setAppUsersError(null);
      try {
        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        const token = sessionData.session?.access_token;
        if (!token) {
          throw new Error("Não foi possível confirmar a sessão atual.");
        }

        const response = await fetch("/api/admin/users", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(
            payload.error ?? "Falha ao carregar a lista de usuários.",
          );
        }

        const payload = (await response.json()) as { users: AppUser[] };
        if (active) {
          setAppUsers(payload.users);
        }
      } catch (err) {
        if (active) {
          setAppUsers([]);
          setAppUsersError(
            err instanceof Error
              ? err.message
              : "Erro desconhecido ao carregar usuários.",
          );
        }
      } finally {
        if (active) {
          setAppUsersLoading(false);
        }
      }
    };

    void loadUsers();

    return () => {
      active = false;
    };
  }, [canManagePermissions, authLoading, accessLoading]);

  const filteredPermissions = useMemo(() => {
    if (!searchTerm.trim()) {
      return permissions;
    }
    const normalized = searchTerm.toLowerCase();
    return permissions.filter((permission) => {
      return (
        permission.email?.toLowerCase().includes(normalized) ||
        permission.user_id?.toLowerCase().includes(normalized) ||
        permission.id.toLowerCase().includes(normalized)
      );
    });
  }, [permissions, searchTerm]);

  const selectedPermission =
    permissions.find((item) => item.id === selectedPermissionId) ?? null;

  const normalizeEmail = useCallback(
    (value: string | null) => value?.toLowerCase().trim() ?? null,
    [],
  );

  const getPermissionForUserAndModule = useCallback(
    (appUser: AppUser, module: PermissionModule) => {
      const normalizedEmail = normalizeEmail(appUser.email);
      return (
        permissions.find(
          (permission) =>
            permission.module === module &&
            ((permission.user_id && permission.user_id === appUser.id) ||
              (normalizedEmail && permission.email === normalizedEmail)),
        ) ?? null
      );
    },
    [normalizeEmail, permissions],
  );

  const handleToggleModule = useCallback(
    async (
      appUser: AppUser,
      module: PermissionModule,
      existing: DocumentPermission | null,
    ) => {
      if (!appUser.email) {
        setFeedback({
          error: "Usuário sem e-mail cadastrado. Cadastre um e-mail primeiro.",
          success: null,
        });
        return;
      }
      const targetKey = `${appUser.id}:${module}`;
      setTogglingTarget(targetKey);
      try {
        const label = MODULE_LABELS[module] ?? module;
        if (existing) {
          await revokePermission(existing.id);
          setFeedback({
            error: null,
            success: `Acesso a ${label} revogado.`,
          });
        } else {
          await grantPermission({
            email: appUser.email,
            module,
          });
          setFeedback({
            error: null,
            success: `Acesso a ${label} concedido.`,
          });
        }
        await refreshModules();
      } catch (err) {
        setFeedback({
          error:
            err instanceof Error
              ? err.message
              : "Não foi possível atualizar a permissão.",
          success: null,
        });
      } finally {
        setTogglingTarget(null);
      }
    },
    [grantPermission, revokePermission],
  );

  const handleGrant = async (event: React.FormEvent) => {
    event.preventDefault();
    setFeedback({ error: null, success: null });

    if (!formState.email.trim()) {
      setFeedback({
        error: "Informe o e-mail que receberá permissão.",
        success: null,
      });
      return;
    }

    setGranting(true);
    try {
      await grantPermission({
        email: formState.email.trim(),
        userId: formState.userId.trim() || undefined,
        module: "documentos",
      });
      setFeedback({
        error: null,
        success: "Permissão concedida com sucesso.",
      });
      setFormState({ email: "", userId: "" });
    } catch (err) {
      setFeedback({
        error:
          err instanceof Error
            ? err.message
            : "Não foi possível conceder a permissão.",
        success: null,
      });
    } finally {
      setGranting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setFeedback({ error: null, success: null });
    setRevokingId(id);
    try {
      await revokePermission(id);
      setFeedback({
        error: null,
        success: "Permissão revogada.",
      });
    } catch (err) {
      setFeedback({
        error:
          err instanceof Error
            ? err.message
            : "Não foi possível revogar a permissão.",
        success: null,
      });
    } finally {
      setRevokingId(null);
    }
  };

  if (
    authLoading ||
    accessLoading ||
    !user ||
    (!canManagePermissions && !accessLoading)
  ) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        {authError ||
          accessError ||
          "Validando permissões do administrador..."}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-slate-700" />
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Permissões de usuários
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Adicione ou revogue acesso aos módulos avançados do Formulário
            Central.
          </p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p>
            Administrador:{" "}
            <span className="font-semibold text-slate-700">
              {user.email}
            </span>
          </p>
          <p>
            Usuários com acesso:{" "}
            <span className="font-semibold text-slate-700">
              {permissions.length}
            </span>
          </p>
        </div>
      </header>

      {(feedback.error ||
        feedback.success ||
        permissionsError ||
        accessError ||
        appUsersError) && (
        <div
          className={`rounded-2xl px-4 py-3 text-xs ${
            feedback.error ||
            permissionsError ||
            accessError ||
            appUsersError
              ? "bg-red-50 text-red-700"
              : "bg-emerald-50 text-emerald-800"
          }`}
        >
          {feedback.error ||
            permissionsError ||
            accessError ||
            appUsersError ||
            feedback.success}
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <form
          onSubmit={handleGrant}
          className="space-y-4 rounded-3xl bg-white/90 p-5 shadow-sm shadow-slate-200"
        >
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <UserPlus className="h-4 w-4 text-slate-600" />
            Conceder permissão
          </p>
          <label className="text-xs font-semibold text-slate-600">
            E-mail do usuário
            <input
              type="email"
              value={formState.email}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  email: event.target.value,
                }))
              }
              required
              placeholder="usuario@empresa.com"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            ID do usuário (opcional)
            <input
              type="text"
              value={formState.userId}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  userId: event.target.value,
                }))
              }
              placeholder="Supabase user_id"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
            />
            <span className="text-[11px] text-slate-500">
              Informe o ID caso o usuário já tenha uma conta criada.
            </span>
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={granting}
              className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-emerald-200 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {granting ? "Concedendo..." : "Conceder permissão"}
            </button>
          </div>
        </form>

        <div className="space-y-4 rounded-3xl bg-white/95 p-5 shadow-sm shadow-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Users className="h-4 w-4 text-slate-600" />
                Usuários liberados
              </p>
              <p className="text-[11px] text-slate-500">
                Clique para selecionar um usuário e gerenciar rapidamente.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void refresh();
                setFeedback({ error: null, success: null });
              }}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-[11px] text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Atualizar
            </button>
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
            <Search className="h-4 w-4 text-slate-500" />
            <input
              type="search"
              placeholder="Buscar por e-mail, ID ou registro"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-600 outline-none placeholder:text-slate-400"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="text-[11px] font-semibold text-slate-500"
              >
                Limpar
              </button>
            )}
          </div>

          {permissionsLoading ? (
            <p className="text-xs text-slate-500">
              Carregando permissões atuais...
            </p>
          ) : filteredPermissions.length === 0 ? (
            <p className="text-xs text-slate-500">
              Nenhum usuário encontrado para os filtros aplicados.
            </p>
          ) : (
            <div className="space-y-2">
            {filteredPermissions.map((permission) => (
              <button
                key={permission.id}
                type="button"
                onClick={() => setSelectedPermissionId(permission.id)}
                  className={`w-full rounded-2xl px-4 py-3 text-left text-sm transition ${
                    permission.id === selectedPermissionId
                      ? "bg-sky-50 text-sky-900"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <p className="font-semibold text-slate-900">
                    {permission.email ?? "sem e-mail cadastrado"}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    user_id:{" "}
                    {permission.user_id ? (
                      <span className="text-slate-700">
                        {permission.user_id}
                      </span>
                    ) : (
                      <span className="text-amber-600">não informado</span>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Tela liberada:{" "}
                    <span className="font-semibold text-slate-700">
                      {MODULE_LABELS[permission.module] ?? permission.module}
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Registrado em {formatDateTime(permission.created_at)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {selectedPermission && (
        <section className="rounded-3xl bg-white/95 p-5 shadow-sm shadow-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Usuário selecionado
              </p>
              <p className="text-sm text-slate-700">{selectedPermission.email}</p>
            </div>
            <span className="text-[11px] text-slate-500">
              ID do registro: {selectedPermission.id}
            </span>
          </div>
          <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                user_id
              </p>
              <p className="mt-1 font-mono text-xs text-slate-700">
                {selectedPermission.user_id ?? "não informado"}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Tela liberada
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-700">
                {MODULE_LABELS[selectedPermission.module] ??
                  selectedPermission.module}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Criado em
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-700">
                {formatDateTime(selectedPermission.created_at)}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleRevoke(selectedPermission.id)}
              disabled={revokingId === selectedPermission.id}
              className="inline-flex items-center gap-2 rounded-full border border-red-200 px-4 py-1.5 text-xs font-semibold text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {revokingId === selectedPermission.id
                ? "Revogando..."
                : "Revogar permissão"}
            </button>
          </div>
        </section>
      )}

      <section className="rounded-3xl bg-white/95 p-5 shadow-sm shadow-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Usuários cadastrados no aplicativo
            </p>
            <p className="text-[11px] text-slate-500">
              Lista fornecida diretamente pelo Supabase Auth. Use os botões para
              liberar cada tela.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            Total:{" "}
            <span className="font-semibold text-slate-700">
              {appUsers.length}
            </span>
          </div>
        </div>
        {appUsersLoading ? (
          <p className="mt-4 text-sm text-slate-500">
            Carregando usuários cadastrados...
          </p>
        ) : appUsers.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            Nenhum usuário foi encontrado. Crie uma conta pelo login para que
            apareça aqui.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">E-mail</th>
                  <th className="px-4 py-3 text-left">Criado em</th>
                  <th className="px-4 py-3 text-left">Último acesso</th>
                  <th className="px-4 py-3 text-left">Telefone</th>
                  <th className="px-4 py-3 text-left">Acesso às telas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-600">
                {appUsers.map((appUser) => (
                  <tr key={appUser.id}>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {appUser.email ?? "sem e-mail"}
                    </td>
                    <td className="px-4 py-3">
                      {formatDateTime(appUser.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {appUser.last_sign_in_at
                        ? formatDateTime(appUser.last_sign_in_at)
                        : "Nunca"}
                    </td>
                    <td className="px-4 py-3">
                      {appUser.phone ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {MODULE_BUTTONS.map((module) => {
                          const existing = getPermissionForUserAndModule(
                            appUser,
                            module.key,
                          );
                          const active = Boolean(existing);
                          const isProcessing =
                            togglingTarget === `${appUser.id}:${module.key}`;
                          return (
                            <button
                              key={module.key}
                              type="button"
                              disabled={!appUser.email || isProcessing}
                              onClick={() =>
                                handleToggleModule(
                                  appUser,
                                  module.key,
                                  existing,
                                )
                              }
                              className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                                active
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                              } ${
                                !appUser.email
                                  ? "opacity-60"
                                  : "disabled:opacity-60"
                              }`}
                            >
                              {isProcessing
                                ? "Atualizando..."
                                : module.label}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
