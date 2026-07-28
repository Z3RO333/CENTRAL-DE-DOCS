"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { useIsAprovadorInterno } from "@/hooks/useIsAprovadorInterno";
import {
  getSignedFileUrl,
  resolveSignedPdfPath,
  formatCurrencyBRL,
  getSemaforoRecebimentoNota,
  SEMAFORO_BADGE,
} from "../../_lib/documentosShared";
import { ConservacaoSubNav } from "../_components/ConservacaoSubNav";
import { StatusBadge } from "@/components/StatusBadge";

type NotaFiscalConservacao = {
  id: string;
  prestador_id: string;
  prestador_nome: string;
  loja_id: string;
  loja_nome: string;
  numero_nf: string;
  numero_pedido: string | null;
  valor: number | null;
  competencia: string | null;
  data_recebimento: string;
  observacoes: string | null;
  responsavel: string | null;
  status: "aguardando_verificacao" | "concluida" | "rejeitada";
  motivo_status: string | null;
  created_at: string;
  arquivo_path: string;
};

export default function NotasFiscaisConservacaoManagementPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();
  const { isAprovadorInterno, loading: aprovadorLoading } = useIsAprovadorInterno();
  const canAccess = isAdmin || isAprovadorInterno;

  const [notas, setNotas] = useState<NotaFiscalConservacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [rejectDialog, setRejectDialog] = useState<NotaFiscalConservacao | null>(null);
  const [rejectMotivo, setRejectMotivo] = useState("");
  const [deleteDialog, setDeleteDialog] = useState<NotaFiscalConservacao | null>(null);
  const [deleteMotivo, setDeleteMotivo] = useState("");
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [pdfActionId, setPdfActionId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
    if (
      !authLoading &&
      user &&
      !accessLoading &&
      !aprovadorLoading &&
      !canAccess
    ) {
      router.replace("/documentos");
    }
  }, [accessLoading, aprovadorLoading, authLoading, canAccess, router, user]);

  const getAccessToken = useCallback(async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const token = data.session?.access_token;
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");
    return token;
  }, []);

  const carregarNotas = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const params = new URLSearchParams();
      if (statusFilter !== "todos") {
        params.set("status", statusFilter);
      }
      const response = await fetch(`/api/notas-fiscais-conservacao?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json()) as {
        notas?: NotaFiscalConservacao[];
        error?: string;
      };
      if (!response.ok || !payload.notas) {
        throw new Error(payload.error ?? "Não foi possível carregar as notas fiscais.");
      }
      setNotas(payload.notas);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível carregar as notas fiscais.",
      );
      setNotas([]);
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, statusFilter, user]);

  useEffect(() => {
    if (user && canAccess) void carregarNotas();
  }, [canAccess, carregarNotas, user]);

  const abrirPdf = async (nota: NotaFiscalConservacao) => {
    if (!nota.arquivo_path) return;
    try {
      setPdfActionId(nota.id);
      setError(null);
      const path = resolveSignedPdfPath(nota.arquivo_path) ?? nota.arquivo_path;
      const signedUrl = await getSignedFileUrl(path);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível abrir o PDF.");
    } finally {
      setPdfActionId(null);
    }
  };

  const baixarPdf = async (nota: NotaFiscalConservacao) => {
    if (!nota.arquivo_path) return;
    try {
      setPdfActionId(nota.id);
      setError(null);
      const path = resolveSignedPdfPath(nota.arquivo_path) ?? nota.arquivo_path;
      const signedUrl = await getSignedFileUrl(path);
      const response = await fetch(signedUrl);
      if (!response.ok) throw new Error("Não foi possível baixar o arquivo.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = nota.arquivo_path.split("/").pop() ?? "nota.pdf";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível baixar o PDF.");
    } finally {
      setPdfActionId(null);
    }
  };

  const alterarStatus = async (
    nota: NotaFiscalConservacao,
    status: "concluida" | "rejeitada",
    motivo?: string,
  ) => {
    try {
      setActioningId(nota.id);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch(`/api/notas-fiscais-conservacao/${nota.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status, motivo }),
      });
      const payload = (await response.json()) as {
        nota?: NotaFiscalConservacao;
        error?: string;
      };
      if (!response.ok || !payload.nota) {
        throw new Error(payload.error ?? "Não foi possível atualizar a nota fiscal.");
      }
      setNotas((prev) =>
        prev.map((item) =>
          item.id === nota.id
            ? {
                ...item,
                status: payload.nota!.status,
                motivo_status: payload.nota!.motivo_status,
              }
            : item,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível atualizar a nota fiscal.",
      );
    } finally {
      setActioningId(null);
    }
  };

  const confirmarRejeicao = async () => {
    if (!rejectDialog || !rejectMotivo.trim()) return;
    await alterarStatus(rejectDialog, "rejeitada", rejectMotivo.trim());
    setRejectDialog(null);
    setRejectMotivo("");
  };

  const confirmarExclusao = async () => {
    if (!deleteDialog || !deleteMotivo.trim()) return;
    try {
      setActioningId(deleteDialog.id);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch(
        `/api/notas-fiscais-conservacao/${deleteDialog.id}?motivo=${encodeURIComponent(
          deleteMotivo.trim(),
        )}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível remover a nota fiscal.");
      }
      setNotas((prev) => prev.filter((item) => item.id !== deleteDialog.id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível remover a nota fiscal.",
      );
    } finally {
      setActioningId(null);
      setDeleteDialog(null);
      setDeleteMotivo("");
    }
  };

  if (authLoading || accessLoading || aprovadorLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando notas fiscais...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => router.back()}
            className="mb-2 text-xs text-slate-500 hover:text-sky-600"
          >
            Voltar
          </button>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Notas Fiscais — Conservação
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Controle das notas fiscais recebidas das empresas conservadoras.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
          >
            <option value="todos">Todos os status</option>
            <option value="aguardando_verificacao">Aguardando verificação</option>
            <option value="concluida">Concluída</option>
            <option value="rejeitada">Rejeitada</option>
          </select>
          <button
            type="button"
            onClick={() => void carregarNotas()}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        </div>
      </header>

      <ConservacaoSubNav active="notas-fiscais" />

      {error && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-100">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <span className="font-semibold">{notas.length} nota(s)</span>
          {loading && (
            <span className="inline-flex items-center gap-1">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Carregando
            </span>
          )}
        </div>

        {!loading && notas.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Nenhuma nota fiscal encontrada.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <caption className="sr-only">Notas fiscais de conservação</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Conservadora</th>
                  <th className="px-4 py-3">Loja</th>
                  <th className="px-4 py-3">NF</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                  <th className="px-4 py-3">Competência</th>
                  <th className="px-4 py-3">Prazo</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {notas.map((nota) => (
                  <tr key={nota.id} className="align-top">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {nota.prestador_nome}
                      {nota.responsavel && (
                        <p className="text-[11px] font-normal text-slate-400">
                          Gestor: {nota.responsavel}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{nota.loja_nome}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {nota.numero_nf}
                      {nota.numero_pedido && (
                        <p className="text-[11px] text-slate-400">
                          Pedido: {nota.numero_pedido}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-600">
                      {formatCurrencyBRL(nota.valor) ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {nota.competencia ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const semaforo = getSemaforoRecebimentoNota(
                          nota.data_recebimento,
                          nota.status,
                        );
                        if (!semaforo) {
                          return <span className="text-xs text-slate-400">-</span>;
                        }
                        return (
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${SEMAFORO_BADGE[semaforo.status]}`}
                          >
                            {semaforo.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={nota.status} />
                      {nota.motivo_status && (
                        <p className="mt-1 max-w-[200px] text-[11px] text-slate-400">
                          {nota.motivo_status}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2 text-[11px]">
                        <button
                          type="button"
                          disabled={pdfActionId === nota.id || !nota.arquivo_path}
                          onClick={() => void abrirPdf(nota)}
                          className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Ver PDF
                        </button>
                        <button
                          type="button"
                          disabled={pdfActionId === nota.id || !nota.arquivo_path}
                          onClick={() => void baixarPdf(nota)}
                          className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Baixar PDF
                        </button>
                        {nota.status === "aguardando_verificacao" && (
                          <>
                            <button
                              type="button"
                              disabled={actioningId === nota.id}
                              onClick={() => void alterarStatus(nota, "concluida")}
                              className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                            >
                              Concluir
                            </button>
                            <button
                              type="button"
                              disabled={actioningId === nota.id}
                              onClick={() => {
                                setRejectMotivo("");
                                setRejectDialog(nota);
                              }}
                              className="rounded-full border border-red-200 px-3 py-1 text-red-600 hover:bg-red-50 disabled:opacity-60"
                            >
                              Rejeitar
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          disabled={actioningId === nota.id}
                          onClick={() => {
                            setDeleteMotivo("");
                            setDeleteDialog(nota);
                          }}
                          className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {rejectDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setRejectDialog(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              Rejeitar nota fiscal
            </h2>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Motivo
              <textarea
                value={rejectMotivo}
                onChange={(event) => setRejectMotivo(event.target.value)}
                className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectDialog(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!rejectMotivo.trim() || actioningId === rejectDialog.id}
                onClick={() => void confirmarRejeicao()}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-60"
              >
                Rejeitar
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setDeleteDialog(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              Remover nota fiscal
            </h2>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Motivo (obrigatório)
              <textarea
                value={deleteMotivo}
                onChange={(event) => setDeleteMotivo(event.target.value)}
                className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteDialog(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!deleteMotivo.trim() || actioningId === deleteDialog.id}
                onClick={() => void confirmarExclusao()}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-60"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
