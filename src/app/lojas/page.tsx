"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Pencil, Search, Trash2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { useLojas, type Loja } from "@/hooks/useLojas";

const PAGE_SIZES = [10, 20, 50];

const normalizeEmails = (value: string) =>
  value
    .split(/[,;\n]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

export default function LojasPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();
  const {
    lojas,
    loading: lojasLoading,
    error: lojasError,
    createLoja,
    updateLoja,
    removeLoja,
  } = useLojas({ enabled: isAdmin });

  const [searchTerm, setSearchTerm] = useState("");
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editingLoja, setEditingLoja] = useState<Loja | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formNome, setFormNome] = useState("");
  const [formCodigo, setFormCodigo] = useState("");
  const [formEmails, setFormEmails] = useState("");

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

  const filteredLojas = useMemo(() => {
    if (!searchTerm.trim()) {
      return lojas;
    }
    const query = searchTerm.trim().toLowerCase();
    return lojas.filter((loja) => {
      const nome = loja.nome.toLowerCase();
      const codigo = loja.codigo?.toLowerCase() ?? "";
      const emails = loja.usuarios.join(" ").toLowerCase();
      return (
        nome.includes(query) || codigo.includes(query) || emails.includes(query)
      );
    });
  }, [lojas, searchTerm]);

  const visibleLojas = useMemo(
    () => filteredLojas.slice(0, pageSize),
    [filteredLojas, pageSize],
  );

  const resetForm = useCallback(() => {
    setFormNome("");
    setFormCodigo("");
    setFormEmails("");
  }, []);

  const openCreate = () => {
    resetForm();
    setFeedback(null);
    setIsCreateOpen(true);
  };

  const openEdit = (loja: Loja) => {
    setEditingLoja(loja);
    setFormNome(loja.nome);
    setFormCodigo(loja.codigo ?? "");
    setFormEmails(loja.usuarios.join(", "));
    setFeedback(null);
  };

  const handleSubmitCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await createLoja({
        nome: formNome.trim(),
        codigo: formCodigo.trim() || null,
        usuarios: normalizeEmails(formEmails),
      });
      setIsCreateOpen(false);
      resetForm();
      setFeedback("Loja criada com sucesso.");
    } catch (err) {
      setFeedback(
        err instanceof Error ? err.message : "Falha ao criar a loja.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingLoja) {
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await updateLoja({
        id: editingLoja.id,
        nome: formNome.trim(),
        codigo: formCodigo.trim() || null,
        usuarios: normalizeEmails(formEmails),
      });
      setEditingLoja(null);
      resetForm();
      setFeedback("Loja atualizada com sucesso.");
    } catch (err) {
      setFeedback(
        err instanceof Error ? err.message : "Falha ao atualizar a loja.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (loja: Loja) => {
    if (!window.confirm(`Remover a loja "${loja.nome}"?`)) {
      return;
    }
    setFeedback(null);
    try {
      await removeLoja(loja.id);
      setFeedback("Loja removida.");
    } catch (err) {
      setFeedback(
        err instanceof Error ? err.message : "Falha ao remover a loja.",
      );
    }
  };

  if (authLoading || accessLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando lojas...
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
        <span className="font-semibold text-slate-700">Lojas</span>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Gerenciamento de lojas
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Cadastre lojas e defina os gerentes responsáveis por cada unidade.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-500"
        >
          Nova loja
        </button>
      </header>

      {(lojasError || feedback) && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-xs text-red-700">
          {lojasError || feedback}
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
                placeholder="Pesquisar por nome, código ou e-mail..."
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
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">Loja</th>
                <th className="px-5 py-3 text-left">Código</th>
                <th className="px-5 py-3 text-left">Gerentes</th>
                <th className="px-5 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lojasLoading ? (
                <tr>
                  <td className="px-5 py-6 text-center text-slate-500" colSpan={4}>
                    Carregando lojas...
                  </td>
                </tr>
              ) : visibleLojas.length === 0 ? (
                <tr>
                  <td className="px-5 py-6 text-center text-slate-500" colSpan={4}>
                    Nenhuma loja encontrada.
                  </td>
                </tr>
              ) : (
                visibleLojas.map((loja) => (
                  <tr key={loja.id} className="text-slate-700">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-900">
                        {loja.nome}
                      </div>
                    </td>
                    <td className="px-5 py-4">{loja.codigo ?? "-"}</td>
                    <td className="px-5 py-4">
                      {loja.usuarios.length} e-mail(s)
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(loja)}
                          className="rounded-full border border-slate-200 p-2 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                          aria-label="Editar loja"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemove(loja)}
                          className="rounded-full border border-red-200 p-2 text-red-600 transition hover:border-red-300 hover:bg-red-50"
                          aria-label="Remover loja"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {(isCreateOpen || editingLoja) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-100/80 px-4 py-6"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 text-slate-900 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {editingLoja ? "Editar loja" : "Nova loja"}
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {editingLoja ? editingLoja.nome : "Cadastrar nova unidade"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsCreateOpen(false);
                  setEditingLoja(null);
                  resetForm();
                }}
                className="rounded-full bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200"
                aria-label="Fechar modal"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={editingLoja ? handleSubmitEdit : handleSubmitCreate}
              className="mt-4 space-y-4"
            >
              <div className="grid gap-3">
                <label className="text-xs font-semibold text-slate-600">
                  Nome da loja
                  <input
                    type="text"
                    value={formNome}
                    onChange={(event) => setFormNome(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    placeholder="Ex.: Loja Centro"
                    required
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Código da loja (opcional)
                  <input
                    type="text"
                    value={formCodigo}
                    onChange={(event) => setFormCodigo(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    placeholder="Ex.: LOJ-001"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Gerentes (e-mails)
                  <textarea
                    value={formEmails}
                    onChange={(event) => setFormEmails(event.target.value)}
                    className="mt-1 min-h-[90px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    placeholder="Ex.: gerente@empresa.com, outra@empresa.com"
                  />
                  <span className="text-[11px] text-slate-500">
                    Os gerentes de loja só visualizarão documentos da própria
                    loja.
                  </span>
                </label>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateOpen(false);
                    setEditingLoja(null);
                    resetForm();
                  }}
                  className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
