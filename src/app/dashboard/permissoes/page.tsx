"use client";

import { useEffect, useMemo, useState } from "react";
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
import { useDocumentPermissions } from "@/hooks/useDocumentPermissions";

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString("pt-BR");
};

export default function PermissoesPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const {
    hasAccess: hasDocumentsAccess,
    loading: accessLoading,
    error: accessError,
  } = useDocumentsAccess();
  const {
    permissions,
    loading: permissionsLoading,
    error: permissionsError,
    grantPermission,
    revokePermission,
    refresh,
  } = useDocumentPermissions({
    enabled: hasDocumentsAccess,
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

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!authLoading && !accessLoading && user && !hasDocumentsAccess) {
      router.replace("/dashboard");
    }
  }, [authLoading, accessLoading, user, hasDocumentsAccess, router]);

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
    (!hasDocumentsAccess && !accessLoading)
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
        accessError) && (
        <div
          className={`rounded-2xl border px-4 py-3 text-xs ${
            feedback.error || permissionsError || accessError
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {feedback.error ||
            permissionsError ||
            accessError ||
            feedback.success}
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <form
          onSubmit={handleGrant}
          className="space-y-4 rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm shadow-slate-200"
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

        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-sm shadow-slate-200">
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
                  className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                    permission.id === selectedPermissionId
                      ? "border-sky-300 bg-sky-50 text-sky-900"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
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
                    Registrado em {formatDateTime(permission.created_at)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {selectedPermission && (
        <section className="rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-sm shadow-slate-200">
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
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                user_id
              </p>
              <p className="mt-1 font-mono text-xs text-slate-700">
                {selectedPermission.user_id ?? "não informado"}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
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
    </div>
  );
}
