"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, UserPlus } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { usePrestadores } from "@/hooks/usePrestadores";
import { supabase } from "@/lib/supabaseClient";
import { isInPeriodo, resolvePrestadorMeta } from "@/lib/prestadorMetas";

export default function PrestadoresPage() {
  const router = useRouter();
  const { user, isLoading, error: authError } = useAuth();
  const { modules: modulesAccess } = useDocumentsAccess();
  const canManagePrestadores = modulesAccess.documentos;
  const {
    prestadores,
    loading: prestadoresLoading,
    error: prestadoresError,
    createPrestador,
  } = usePrestadores({ enabled: canManagePrestadores });
  const [prestadorForm, setPrestadorForm] = useState({
    nome: "",
    tipoServico: "",
    cnpj: "",
    usuarios: "",
  });
  const [prestadorFeedback, setPrestadorFeedback] = useState<{
    error: string | null;
    success: string | null;
  }>({ error: null, success: null });
  const [creatingPrestador, setCreatingPrestador] = useState(false);
  const [selectedPrestadorId, setSelectedPrestadorId] = useState<string>("");
  const [documentos, setDocumentos] = useState<
    {
      id: string;
      prestador_id?: string | null;
      created_at: string;
      tipo: string;
    }[]
  >([]);
  const [documentosLoading, setDocumentosLoading] = useState(false);
  const [documentosError, setDocumentosError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (
      prestadores.length > 0 &&
      !prestadores.find((item) => item.id === selectedPrestadorId)
    ) {
      setSelectedPrestadorId(prestadores[0].id);
    }
  }, [prestadores, selectedPrestadorId]);

  const selectedPrestador =
    prestadores.find((item) => item.id === selectedPrestadorId) ?? null;

  const carregarDocumentos = useCallback(async () => {
    if (!user) {
      return;
    }
    if (prestadores.length === 0) {
      setDocumentos([]);
      setDocumentosLoading(false);
      setDocumentosError(null);
      return;
    }
    setDocumentosLoading(true);
    setDocumentosError(null);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }
      const token = data.session?.access_token;
      if (!token) {
        throw new Error("Sessao expirada. Faca login novamente.");
      }
      const params = new URLSearchParams();
      prestadores.forEach((prestador) => params.append("prestadorId", prestador.id));
      const url =
        params.size > 0 ? `/api/documentos?${params.toString()}` : "/api/documentos";
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as {
        registros?: {
          id: string;
          prestador_id?: string | null;
          created_at: string;
          tipo: string;
        }[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Nao foi possivel carregar documentos.");
      }
      setDocumentos(payload.registros ?? []);
    } catch (err) {
      setDocumentosError(
        err instanceof Error ? err.message : "Nao foi possivel carregar documentos.",
      );
    } finally {
      setDocumentosLoading(false);
    }
  }, [prestadores, user]);

  useEffect(() => {
    if (user && !prestadoresLoading) {
      void carregarDocumentos();
    }
  }, [user, prestadoresLoading, carregarDocumentos]);

  const progressoPrestadores = useMemo(() => {
    const now = new Date();
    return prestadores.map((prestador) => {
      const meta = resolvePrestadorMeta(prestador);
      const enviados = documentos.filter(
        (item) =>
          item.prestador_id === prestador.id &&
          isInPeriodo(item.created_at, meta.periodo, now),
      ).length;
      const percentual =
        meta.quantidade > 0
          ? Math.min((enviados / meta.quantidade) * 100, 100)
          : 0;
      return {
        prestador,
        meta,
        enviados,
        percentual,
      };
    });
  }, [documentos, prestadores]);

  const selectedProgress = useMemo(
    () =>
      progressoPrestadores.find(
        (item) => item.prestador.id === selectedPrestadorId,
      ) ?? null,
    [progressoPrestadores, selectedPrestadorId],
  );

  if (isLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        {authError ?? "Carregando tela de prestadores..."}
      </div>
    );
  }

  if (!canManagePrestadores) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-4 py-10 text-center text-sm text-slate-500">
        <p>Você não possui autorização para gerenciar prestadores.</p>
        <Link
          href="/dashboard"
          className="rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-sky-200 transition hover:bg-sky-500"
        >
          Voltar para formulários
        </Link>
      </div>
    );
  }

  const handlePrestadorFieldChange = (
    field: keyof typeof prestadorForm,
    value: string,
  ) => {
    setPrestadorForm((prev) => ({
      ...prev,
      [field]: value,
    }));
    setPrestadorFeedback({ error: null, success: null });
  };

  const handlePrestadorSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPrestadorFeedback({ error: null, success: null });

    if (!prestadorForm.nome.trim()) {
      setPrestadorFeedback({
        error: "Informe o nome do prestador.",
        success: null,
      });
      return;
    }
    if (!prestadorForm.tipoServico.trim()) {
      setPrestadorFeedback({
        error: "Informe o tipo de serviço.",
        success: null,
      });
      return;
    }
    if (!prestadorForm.cnpj.trim()) {
      setPrestadorFeedback({
        error: "Informe o CNPJ do prestador.",
        success: null,
      });
      return;
    }
    const usuariosList = prestadorForm.usuarios
      .split(/[,;\n]/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    if (usuariosList.length === 0) {
      setPrestadorFeedback({
        error:
          "Informe pelo menos um e-mail de usuário autorizado, separados por vírgula.",
        success: null,
      });
      return;
    }

    setCreatingPrestador(true);
    try {
      const created = await createPrestador({
        nome: prestadorForm.nome.trim(),
        tipo_servico: prestadorForm.tipoServico.trim(),
        cnpj: prestadorForm.cnpj.trim(),
        usuarios: usuariosList,
      });
      setPrestadorFeedback({
        error: null,
        success: created
          ? `Prestador ${created.nome} cadastrado com sucesso!`
          : "Prestador cadastrado.",
      });
      setPrestadorForm({
        nome: "",
        tipoServico: "",
        cnpj: "",
        usuarios: "",
      });
      if (created) {
        setSelectedPrestadorId(created.id);
      }
    } catch (err) {
      setPrestadorFeedback({
        error:
          err instanceof Error
            ? err.message
            : "Não foi possível cadastrar o prestador.",
        success: null,
      });
    } finally {
      setCreatingPrestador(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Building2 className="h-4 w-4 text-slate-600" />
            Cadastro de prestadores
          </p>
          <p className="text-sm text-slate-500">
            Administre quais prestadores e usuários podem enviar laudos.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex items-center rounded-full border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 transition hover:border-sky-400 hover:text-sky-600"
        >
          Voltar para formulários
        </Link>
      </div>

      {(prestadorFeedback.error ||
        prestadorFeedback.success ||
        prestadoresError) && (
        <div
          className={`rounded-2xl border px-4 py-3 text-xs ${
            prestadorFeedback.error || prestadoresError
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {prestadorFeedback.error ||
            prestadoresError ||
            prestadorFeedback.success}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-100 bg-white/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Prestadores cadastrados
                </p>
                <span className="text-[11px] text-slate-500">
                  Selecione um prestador para ver detalhes e progresso.
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                {prestadores.length} prestador(es)
              </span>
            </div>

            {prestadoresLoading ? (
              <p className="mt-3 text-xs text-slate-500">
                Carregando prestadores...
              </p>
            ) : prestadores.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">
                Nenhum prestador cadastrado ainda.
              </p>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {progressoPrestadores.map((item) => (
                  <button
                    key={item.prestador.id}
                    type="button"
                    onClick={() => setSelectedPrestadorId(item.prestador.id)}
                    className={`text-left rounded-2xl border px-4 py-3 transition ${
                      selectedPrestadorId === item.prestador.id
                        ? "border-sky-300 bg-sky-50/60 shadow-sm shadow-sky-100"
                        : "border-slate-100 bg-slate-50/80 hover:border-slate-200"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {item.prestador.nome}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {item.prestador.tipo_servico}
                        </p>
                      </div>
                      <span className="text-[11px] font-semibold text-slate-600">
                        {item.enviados}/{item.meta.quantidade}
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-white">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-sky-300"
                        style={{ width: `${item.percentual}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Meta {item.meta.quantidade} / {item.meta.periodo === "mensal" ? "mes" : "ano"} - {Math.round(item.percentual)}% no periodo atual
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Detalhes do prestador
            </p>
            {documentosLoading && (
              <p className="mt-2 text-xs text-slate-500">
                Carregando monitoramento de documentos...
              </p>
            )}
            {documentosError && (
              <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {documentosError}
              </p>
            )}
            {selectedPrestador ? (
              <div className="mt-3 space-y-2 text-xs text-slate-600">
                <p>
                  <span className="font-semibold text-slate-700">Tipo de servico:</span>{" "}
                  {selectedPrestador.tipo_servico}
                </p>
                <p>
                  <span className="font-semibold text-slate-700">CNPJ:</span>{" "}
                  {selectedPrestador.cnpj}
                </p>
                {selectedProgress && (
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[11px] text-slate-500">
                      Meta monitorada: {selectedProgress.meta.label} - {selectedProgress.meta.quantidade} {selectedProgress.meta.periodo === "mensal" ? "mes" : "ano"}
                    </p>
                    <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-sky-300"
                        style={{ width: `${selectedProgress.percentual}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Enviados {selectedProgress.enviados} de {selectedProgress.meta.quantidade} no periodo atual
                    </p>
                  </div>
                )}
                <div>
                  <span className="font-semibold text-slate-700">Usuarios vinculados:</span>
                  <ul className="mt-1 list-disc pl-4 text-[11px]">
                    {selectedPrestador.usuarios.map((usuario) => (
                      <li key={usuario} className="text-slate-600">
                        {usuario}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                Selecione um prestador para ver os detalhes.
              </p>
            )}
          </div>
        </div>

        <form
          onSubmit={handlePrestadorSubmit}
          className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-4"
        >
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <UserPlus className="h-4 w-4 text-slate-600" />
            Novo prestador
          </p>
          <div className="grid gap-3">
            <label className="text-xs font-semibold text-slate-600">
              Nome do prestador
              <input
                type="text"
                value={prestadorForm.nome}
                onChange={(event) =>
                  handlePrestadorFieldChange("nome", event.target.value)
                }
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                placeholder="Ex.: Laboratorio XPTO"
                required
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Tipo de servico
              <input
                type="text"
                value={prestadorForm.tipoServico}
                onChange={(event) =>
                  handlePrestadorFieldChange("tipoServico", event.target.value)
                }
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                placeholder="Ex.: Laudos tecnicos"
                required
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              CNPJ do prestador
              <input
                type="text"
                value={prestadorForm.cnpj}
                onChange={(event) =>
                  handlePrestadorFieldChange("cnpj", event.target.value)
                }
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                placeholder="00.000.000/0000-00"
                required
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Usuarios autorizados
              <textarea
                value={prestadorForm.usuarios}
                onChange={(event) =>
                  handlePrestadorFieldChange("usuarios", event.target.value)
                }
                className="mt-1 min-h-[90px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                placeholder="Informe os e-mails separados por virgula"
              />
              <span className="text-[11px] text-slate-500">
                Digite os e-mails de quem podera usar esse prestador no formulario.
              </span>
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={creatingPrestador}
              className="rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {creatingPrestador ? "Salvando..." : "Cadastrar prestador"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
