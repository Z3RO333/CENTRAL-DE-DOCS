"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Search, Trash2, X } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { useLojas, type Loja, type LojaCategoria } from "@/hooks/useLojas";

const PAGE_SIZES = [10, 20, 50];

type CategoriaFilter = "todas" | LojaCategoria;

const CATEGORIA_LABEL: Record<LojaCategoria, string> = {
  LOJA: "Loja",
  CD: "CD",
  FARMA: "Farma",
  REVISAR: "Revisar",
};

const CATEGORIA_BADGE: Record<LojaCategoria, string> = {
  LOJA: "bg-sky-50 text-sky-700",
  CD: "bg-violet-50 text-violet-700",
  FARMA: "bg-emerald-50 text-emerald-700",
  REVISAR: "bg-amber-100 text-amber-700",
};

const compareCodigo = (a: string | null, b: string | null) => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const numA = Number(a);
  const numB = Number(b);
  if (Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB;
  return a.localeCompare(b);
};

type FeedbackState = {
  kind: "success" | "error";
  message: string;
} | null;

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
  const [categoriaFilter, setCategoriaFilter] = useState<CategoriaFilter>("todas");
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [currentPage, setCurrentPage] = useState(1);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
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
    const base =
      categoriaFilter === "todas"
        ? lojas
        : lojas.filter((loja) => loja.categoria === categoriaFilter);
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const query = norm(searchTerm.trim());
    const filtered = !query
      ? base
      : base.filter((loja) => {
          return (
            norm(loja.nome).includes(query) ||
            norm(loja.codigo ?? "").includes(query) ||
            norm(loja.usuarios.join(" ")).includes(query)
          );
        });
    return [...filtered].sort((a, b) => compareCodigo(a.codigo, b.codigo));
  }, [lojas, searchTerm, categoriaFilter]);

  const visibleLojas = useMemo(
    () =>
      filteredLojas.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize,
      ),
    [currentPage, filteredLojas, pageSize],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, pageSize, categoriaFilter]);

  const categoriaCount = useMemo(() => {
    const counts: Record<LojaCategoria, number> = {
      LOJA: 0,
      CD: 0,
      FARMA: 0,
      REVISAR: 0,
    };
    for (const loja of lojas) {
      counts[loja.categoria] = (counts[loja.categoria] ?? 0) + 1;
    }
    return counts;
  }, [lojas]);

  const totalPages = Math.max(1, Math.ceil(filteredLojas.length / pageSize));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const showingFrom =
    filteredLojas.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const showingTo = Math.min(currentPage * pageSize, filteredLojas.length);

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
      setFeedback({ kind: "success", message: "Loja criada com sucesso." });
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Falha ao criar a loja.",
      });
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
      setFeedback({ kind: "success", message: "Loja atualizada com sucesso." });
    } catch (err) {
      setFeedback({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Falha ao atualizar a loja.",
      });
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
      setFeedback({ kind: "success", message: "Loja removida." });
    } catch (err) {
      setFeedback({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Falha ao remover a loja.",
      });
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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Gerenciamento de lojas
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Cadastre lojas e mantenha os dados das unidades.
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

      {lojasError && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-xs text-red-700">
          {lojasError}
        </div>
      )}

      {feedback && (
        <div
          className={`rounded-2xl px-4 py-3 text-xs ${
            feedback.kind === "success"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
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
        <div className="mt-4 flex flex-wrap gap-2">
          {(["todas", "LOJA", "CD", "FARMA", "REVISAR"] as CategoriaFilter[]).map(
            (option) => {
              const active = categoriaFilter === option;
              const count =
                option === "todas"
                  ? lojas.length
                  : categoriaCount[option as LojaCategoria];
              const label =
                option === "todas"
                  ? "Todas"
                  : CATEGORIA_LABEL[option as LojaCategoria];
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCategoriaFilter(option)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    active
                      ? option === "REVISAR"
                        ? "border-amber-300 bg-amber-100 text-amber-800"
                        : "border-sky-300 bg-sky-100 text-sky-800"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {label} ({count})
                </button>
              );
            },
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span>
            Mostrando {showingFrom}-{showingTo} de {filteredLojas.length} registros
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              disabled={currentPage <= 1}
              className="rounded-full border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Anterior
            </button>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-600">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() =>
                setCurrentPage((prev) => Math.min(prev + 1, totalPages))
              }
              disabled={currentPage >= totalPages}
              className="rounded-full border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Próxima
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm shadow-slate-200">
        <div className="space-y-3 p-3 md:hidden">
          {lojasLoading ? (
            <p className="py-3 text-center text-sm text-slate-500">
              Carregando lojas...
            </p>
          ) : visibleLojas.length === 0 ? (
            <p className="py-3 text-center text-sm text-slate-500">
              Nenhuma loja encontrada.
            </p>
          ) : (
            visibleLojas.map((loja) => (
              <article
                key={loja.id}
                className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-slate-900">
                    <span className="font-mono text-xs text-slate-500">
                      {loja.codigo ?? "—"}
                    </span>{" "}
                    - {loja.nome}
                  </p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CATEGORIA_BADGE[loja.categoria]}`}
                  >
                    {CATEGORIA_LABEL[loja.categoria]}
                  </span>
                </div>
                <div className="mt-2 space-y-1 text-xs text-slate-500">
                  <p>{loja.usuarios.length} e-mail(s) vinculado(s)</p>
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
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
              </article>
            ))
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">Centro</th>
                <th className="px-5 py-3 text-left">Unidade</th>
                <th className="px-5 py-3 text-left">Categoria</th>
                <th className="px-5 py-3 text-left">Emails</th>
                <th className="px-5 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lojasLoading ? (
                <tr>
                  <td className="px-5 py-6 text-center text-slate-500" colSpan={5}>
                    Carregando lojas...
                  </td>
                </tr>
              ) : visibleLojas.length === 0 ? (
                <tr>
                  <td className="px-5 py-6 text-center text-slate-500" colSpan={5}>
                    Nenhuma loja encontrada.
                  </td>
                </tr>
              ) : (
                visibleLojas.map((loja) => (
                  <tr key={loja.id} className="text-slate-700">
                    <td className="px-5 py-4 font-mono text-xs text-slate-500">
                      {loja.codigo ?? "—"}
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-900">
                        {loja.nome}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CATEGORIA_BADGE[loja.categoria]}`}
                      >
                        {CATEGORIA_LABEL[loja.categoria]}
                      </span>
                    </td>
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
                <X className="h-4 w-4" />
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
                  Emails vinculados
                  <textarea
                    value={formEmails}
                    onChange={(event) => setFormEmails(event.target.value)}
                    className="mt-1 min-h-[90px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    placeholder="Ex.: gerente@empresa.com, outra@empresa.com"
                  />
                  <span className="text-[11px] text-slate-500">
                    A permissao de gerente e configurada em Usuarios.
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

