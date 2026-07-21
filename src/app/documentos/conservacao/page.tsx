"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { DocumentActions } from "../_components/DocumentActions";
import { DocumentDetailsDrawer } from "../_components/DocumentDetailsDrawer";
import {
  type FormularioRecord,
  type EditField,
  TIPO_LABEL,
  getEditFields,
  getIdentificacaoConfig,
  getIdentificacaoValor,
  getSignedFileUrl,
  resolveSignedPdfPath,
  normalizeRegistroStatus,
  formatStatusLabel,
  getTipoDescricao,
  getDocumentoNome,
  getValorOrcamento,
  formatCurrencyBRL,
} from "../_lib/documentosShared";

const CATEGORIA_CONSERVACAO = "conservacao";

type PdfAction = { id: string; type: "open" | "download" } | null;

type EditDialogState = {
  registro: FormularioRecord;
  values: Record<string, string>;
};

const getPathParaVisualizacao = (registro: FormularioRecord) =>
  resolveSignedPdfPath(registro.arquivo_assinado_path) ??
  registro.arquivo_assinado_path ??
  registro.arquivo_path;

const downloadSignedUrlAsBlob = async (signedUrl: string, fileName: string) => {
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error("Não foi possível baixar o arquivo.");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};

export default function ConservacaoPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { isAdmin, role, loading: accessLoading } = useDocumentsAccess();
  const canAccess = isAdmin || role === "gerente_loja";
  const canManageDocuments = isAdmin;

  const [registros, setRegistros] = useState<FormularioRecord[]>([]);
  const [tipoFilter, setTipoFilter] = useState<string>("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pdfAction, setPdfAction] = useState<PdfAction>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedRegistro, setSelectedRegistro] = useState<FormularioRecord | null>(null);

  const [editDialog, setEditDialog] = useState<EditDialogState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [confirmRemove, setConfirmRemove] = useState<FormularioRecord | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
    if (!authLoading && user && !accessLoading && !canAccess) {
      router.replace("/documentos");
    }
  }, [accessLoading, authLoading, canAccess, router, user]);

  const getAccessToken = useCallback(async () => {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");
    return token;
  }, []);

  const carregarDocumentos = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const params = new URLSearchParams({
        categoriaPrestador: CATEGORIA_CONSERVACAO,
        limit: "500",
        offset: "0",
      });
      const response = await fetch(`/api/documentos?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json()) as {
        registros?: FormularioRecord[];
        error?: string;
      };
      if (!response.ok || !payload.registros) {
        throw new Error(payload.error ?? "Não foi possível carregar os documentos.");
      }
      setRegistros(payload.registros.map((r) => normalizeRegistroStatus(r)));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível carregar os documentos.",
      );
      setRegistros([]);
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, user]);

  useEffect(() => {
    if (user) void carregarDocumentos();
  }, [carregarDocumentos, user]);

  const tiposDisponiveis = Array.from(new Set(registros.map((r) => r.tipo))).sort();
  const registrosFiltrados =
    tipoFilter === "todos" ? registros : registros.filter((r) => r.tipo === tipoFilter);

  const abrirDocumento = async (registro: FormularioRecord) => {
    const path = getPathParaVisualizacao(registro);
    if (!path) {
      setError("Arquivo indisponível no momento.");
      return;
    }
    try {
      setPdfAction({ id: registro.id, type: "open" });
      setError(null);
      const signedUrl = await getSignedFileUrl(path);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("Erro ao abrir documento:", err);
      setError("Não foi possível abrir o PDF.");
    } finally {
      setPdfAction(null);
    }
  };

  const baixarDocumento = async (registro: FormularioRecord) => {
    const path = getPathParaVisualizacao(registro);
    if (!path) {
      setError("Arquivo indisponível no momento.");
      return;
    }
    try {
      setPdfAction({ id: registro.id, type: "download" });
      setError(null);
      const signedUrl = await getSignedFileUrl(path);
      const nome = getDocumentoNome(registro) || path.split("/").pop() || "documento.pdf";
      await downloadSignedUrlAsBlob(signedUrl, nome);
    } catch (err) {
      console.error("Erro ao baixar documento:", err);
      setError("Não foi possível baixar o PDF.");
    } finally {
      setPdfAction(null);
    }
  };

  const marcarComoRevisado = async (registro: FormularioRecord) => {
    if (!canManageDocuments) return;
    try {
      setReviewingId(registro.id);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/documentos", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: registro.id, status: "revisado" }),
      });
      const payload = (await response.json()) as {
        registro?: FormularioRecord;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível revisar o documento.");
      }
      setRegistros((prev) =>
        prev.map((item) =>
          item.id === registro.id
            ? normalizeRegistroStatus(payload.registro ?? { ...item, status: "revisado" })
            : item,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível revisar o documento.");
    } finally {
      setReviewingId(null);
    }
  };

  const abrirEdicao = (registro: FormularioRecord) => {
    if (!canManageDocuments) return;
    const campos = getEditFields(registro.tipo);
    const values = campos.reduce<Record<string, string>>((acc, campo) => {
      const raw = registro.dados?.[campo.name];
      acc[campo.name] = raw === null || raw === undefined ? "" : String(raw);
      return acc;
    }, {});
    setEditDialog({ registro, values });
  };

  const salvarEdicao = async () => {
    if (!editDialog) return;
    try {
      setSavingEdit(true);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/documentos", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: editDialog.registro.id,
          updates: editDialog.values,
        }),
      });
      const payload = (await response.json()) as {
        registro?: FormularioRecord;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível atualizar o documento.");
      }
      setRegistros((prev) =>
        prev.map((item) =>
          item.id === editDialog.registro.id
            ? normalizeRegistroStatus(
                payload.registro ?? {
                  ...item,
                  dados: { ...(item.dados ?? {}), ...editDialog.values },
                },
              )
            : item,
        ),
      );
      setEditDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar o documento.");
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmarRemocao = async () => {
    if (!confirmRemove) return;
    try {
      setDeletingId(confirmRemove.id);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch(
        `/api/documentos?id=${encodeURIComponent(confirmRemove.id)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível remover o documento.");
      }
      setRegistros((prev) => prev.filter((item) => item.id !== confirmRemove.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover o documento.");
    } finally {
      setDeletingId(null);
      setConfirmRemove(null);
    }
  };

  const editFields: EditField[] = editDialog ? getEditFields(editDialog.registro.tipo) : [];

  if (authLoading || accessLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando documentos de conservação...
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
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-slate-700" />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Conservação
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Documentos das empresas conservadoras, separados dos demais fornecedores.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={tipoFilter}
            onChange={(event) => setTipoFilter(event.target.value)}
            className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
          >
            <option value="todos">Todos os tipos</option>
            {tiposDisponiveis.map((tipo) => (
              <option key={tipo} value={tipo}>
                {TIPO_LABEL[tipo] ?? getTipoDescricao(tipo)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void carregarDocumentos()}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-100">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <span className="font-semibold">{registrosFiltrados.length} documento(s)</span>
          {loading && (
            <span className="inline-flex items-center gap-1">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Carregando
            </span>
          )}
        </div>

        {!loading && registrosFiltrados.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Nenhum documento de conservação encontrado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Documento</th>
                  <th className="px-4 py-3">Identificação</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {registrosFiltrados.map((registro) => {
                  const identificacaoConfig = getIdentificacaoConfig(registro.tipo);
                  const identificacao =
                    getIdentificacaoValor(registro) ??
                    `${identificacaoConfig.label} não informado`;
                  const nomeDocumento = getDocumentoNome(registro);
                  const valorOrcamento =
                    registro.tipo === "orcamentos"
                      ? formatCurrencyBRL(getValorOrcamento(registro.dados))
                      : null;
                  const opening = pdfAction?.id === registro.id && pdfAction.type === "open";
                  const downloading =
                    pdfAction?.id === registro.id && pdfAction.type === "download";

                  return (
                    <tr
                      key={registro.id}
                      className="cursor-pointer align-top hover:bg-slate-50"
                      onClick={() => {
                        setSelectedRegistro(registro);
                        setSelectedDocumentId(registro.id);
                      }}
                    >
                      <td className="px-4 py-3">
                        <p className="max-w-[220px] break-words font-semibold text-slate-900">
                          {nomeDocumento}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {identificacaoConfig.label}
                        </p>
                        <p className="text-sm font-medium text-slate-900">{identificacao}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {getTipoDescricao(registro.tipo)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-slate-600">
                        {valorOrcamento ?? "-"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                          {formatStatusLabel(registro.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                        <DocumentActions
                          registro={registro}
                          canManageDocuments={canManageDocuments}
                          canReview={
                            registro.status !== "revisado" && registro.status !== "assinado"
                          }
                          canSign={false}
                          opening={opening}
                          downloading={downloading}
                          deleting={deletingId === registro.id}
                          reviewing={reviewingId === registro.id}
                          containerClassName="flex flex-wrap justify-end gap-2 text-[11px]"
                          onOpen={abrirDocumento}
                          onDownload={baixarDocumento}
                          onReview={marcarComoRevisado}
                          onEdit={abrirEdicao}
                          onRemove={(r) => setConfirmRemove(r)}
                          onSign={() => {}}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <DocumentDetailsDrawer
        documentId={selectedDocumentId}
        fallbackRegistro={selectedRegistro}
        isOpen={Boolean(selectedDocumentId)}
        canManageDocuments={canManageDocuments}
        pdfAction={pdfAction}
        reviewingId={reviewingId}
        onClose={() => {
          setSelectedDocumentId(null);
          setSelectedRegistro(null);
        }}
        onOpenPdf={(registro) => void abrirDocumento(registro)}
        onDownloadPdf={(registro) => void baixarDocumento(registro)}
        onEdit={(registro) => abrirEdicao(registro)}
        onReview={(registro) => void marcarComoRevisado(registro)}
        onSign={() => {}}
        onAppliedSuggestions={(registro) => {
          setRegistros((prev) =>
            prev.map((item) => (item.id === registro.id ? registro : item)),
          );
        }}
      />

      {editDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setEditDialog(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Editar documento</h2>
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {editFields.map((campo) => (
                <label
                  key={campo.name}
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  {campo.label}
                  {campo.type === "textarea" ? (
                    <textarea
                      value={editDialog.values[campo.name] ?? ""}
                      onChange={(event) =>
                        setEditDialog((prev) =>
                          prev
                            ? {
                                ...prev,
                                values: { ...prev.values, [campo.name]: event.target.value },
                              }
                            : prev,
                        )
                      }
                      className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                    />
                  ) : (
                    <input
                      type={
                        campo.type === "date"
                          ? "date"
                          : campo.type === "number"
                            ? "number"
                            : "text"
                      }
                      value={editDialog.values[campo.name] ?? ""}
                      onChange={(event) =>
                        setEditDialog((prev) =>
                          prev
                            ? {
                                ...prev,
                                values: { ...prev.values, [campo.name]: event.target.value },
                              }
                            : prev,
                        )
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                    />
                  )}
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditDialog(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => void salvarEdicao()}
                className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
              >
                {savingEdit ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmRemove && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setConfirmRemove(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2 text-red-600">
              <h2 className="text-sm font-semibold">Remover documento</h2>
            </div>
            <p className="text-sm text-slate-600">
              Tem certeza que deseja remover este documento? Essa ação não pode ser
              desfeita.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRemove(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingId === confirmRemove.id}
                onClick={() => void confirmarRemocao()}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-60"
              >
                {deletingId === confirmRemove.id ? "Removendo..." : "Remover"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
