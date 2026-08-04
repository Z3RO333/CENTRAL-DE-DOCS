"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { useLojas } from "@/hooks/useLojas";
import { usePrestadores } from "@/hooks/usePrestadores";
import { useEquipamentos, type Equipamento } from "@/hooks/useEquipamentos";
import { useConfirmDialog } from "@/components/ConfirmDialog";

type FeedbackState = { kind: "success" | "error"; message: string } | null;

export default function EquipamentosPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();
  const { lojas } = useLojas({ enabled: isAdmin });
  const { prestadores } = usePrestadores({ enabled: isAdmin });
  const {
    equipamentos,
    loading: equipamentosLoading,
    error: equipamentosError,
    createEquipamento,
    updateEquipamento,
  } = useEquipamentos({ enabled: isAdmin });
  const { confirm, confirmationDialog } = useConfirmDialog();

  const [lojaFilter, setLojaFilter] = useState<string>("todas");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [editing, setEditing] = useState<Equipamento | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [formLojaId, setFormLojaId] = useState("");
  const [formTipo, setFormTipo] = useState("");
  const [formIdentificacao, setFormIdentificacao] = useState("");
  const [formMarca, setFormMarca] = useState("");
  const [formModelo, setFormModelo] = useState("");
  const [formPotencia, setFormPotencia] = useState("");
  const [formFrequencia, setFormFrequencia] = useState("mensal");
  const [formPrestadorId, setFormPrestadorId] = useState("");
  const [formNumeroSerie, setFormNumeroSerie] = useState("");
  const [formLocalizacao, setFormLocalizacao] = useState("");
  const [formDataInstalacao, setFormDataInstalacao] = useState("");
  const [formDataAtivacao, setFormDataAtivacao] = useState("");

  useEffect(() => {
    if (authLoading || accessLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!isAdmin) {
      router.replace("/documentos");
    }
  }, [authLoading, accessLoading, user, isAdmin, router]);

  const tiposSugeridos = useMemo(
    () => Array.from(new Set(equipamentos.map((eq) => eq.tipo_equipamento))).sort(),
    [equipamentos],
  );

  const visibleEquipamentos = useMemo(
    () =>
      lojaFilter === "todas"
        ? equipamentos
        : equipamentos.filter((eq) => eq.loja_id === lojaFilter),
    [equipamentos, lojaFilter],
  );

  const resetForm = () => {
    setFormLojaId("");
    setFormTipo("");
    setFormIdentificacao("");
    setFormMarca("");
    setFormModelo("");
    setFormPotencia("");
    setFormFrequencia("mensal");
    setFormPrestadorId("");
    setFormNumeroSerie("");
    setFormLocalizacao("");
    setFormDataInstalacao("");
    setFormDataAtivacao("");
  };

  const openCreate = () => {
    resetForm();
    setEditing(null);
    setFeedback(null);
    setIsCreateOpen(true);
  };

  const openEdit = (equipamento: Equipamento) => {
    setFormLojaId(equipamento.loja_id);
    setFormTipo(equipamento.tipo_equipamento);
    setFormIdentificacao(equipamento.identificacao ?? "");
    setFormMarca(equipamento.marca ?? "");
    setFormModelo(equipamento.modelo ?? "");
    setFormPotencia(equipamento.potencia ?? "");
    setFormFrequencia(equipamento.frequencia ?? "mensal");
    setFormPrestadorId(equipamento.prestador_id ?? "");
    setFormNumeroSerie(equipamento.numero_serie ?? "");
    setFormLocalizacao(equipamento.localizacao ?? "");
    setFormDataInstalacao(equipamento.data_instalacao ?? "");
    setFormDataAtivacao(equipamento.data_ativacao ?? "");
    setEditing(equipamento);
    setFeedback(null);
    setIsCreateOpen(true);
  };

  const closeModal = () => {
    setIsCreateOpen(false);
    setEditing(null);
    resetForm();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      if (editing) {
        await updateEquipamento({
          id: editing.id,
          loja_id: formLojaId,
          tipo_equipamento: formTipo,
          identificacao: formIdentificacao || null,
          marca: formMarca || null,
          modelo: formModelo || null,
          potencia: formPotencia || null,
          frequencia: formFrequencia as "mensal" | "semestral" | "anual",
          prestador_id: formPrestadorId || null,
          numero_serie: formNumeroSerie || null,
          localizacao: formLocalizacao || null,
          data_instalacao: formDataInstalacao || null,
          data_ativacao: formDataAtivacao || null,
        });
        setFeedback({ kind: "success", message: "Equipamento atualizado." });
      } else {
        await createEquipamento({
          loja_id: formLojaId,
          tipo_equipamento: formTipo,
          identificacao: formIdentificacao || null,
          marca: formMarca || null,
          modelo: formModelo || null,
          potencia: formPotencia || null,
          frequencia: formFrequencia as "mensal" | "semestral" | "anual",
          prestador_id: formPrestadorId || null,
          numero_serie: formNumeroSerie || null,
          localizacao: formLocalizacao || null,
          data_instalacao: formDataInstalacao || null,
          data_ativacao: formDataAtivacao || null,
        });
        setFeedback({ kind: "success", message: "Equipamento cadastrado." });
      }
      setIsCreateOpen(false);
      setEditing(null);
      resetForm();
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Falha ao salvar equipamento.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDesativar = async (equipamento: Equipamento) => {
    if (
      !(await confirm({
        title: "Desativar equipamento",
        description: `Desativar o equipamento "${equipamento.tipo_equipamento}"${
          equipamento.identificacao ? ` (${equipamento.identificacao})` : ""
        }?`,
        confirmLabel: "Desativar",
        destructive: true,
      }))
    ) {
      return;
    }
    setFeedback(null);
    try {
      await updateEquipamento({
        id: equipamento.id,
        status: "inativo",
        data_desativacao: new Date().toISOString().slice(0, 10),
      });
      setFeedback({ kind: "success", message: "Equipamento desativado." });
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Falha ao desativar.",
      });
    }
  };

  const handleReativar = async (equipamento: Equipamento) => {
    setFeedback(null);
    try {
      await updateEquipamento({
        id: equipamento.id,
        status: "ativo",
        data_desativacao: null,
      });
      setFeedback({ kind: "success", message: "Equipamento reativado." });
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Falha ao reativar.",
      });
    }
  };

  if (authLoading || accessLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando equipamentos...
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

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
      {confirmationDialog}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Gerenciamento de equipamentos
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Cadastre equipamentos e mantenha os dados das unidades.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-500"
        >
          Novo equipamento
        </button>
      </header>

      {equipamentosError && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-xs text-red-700">
          {equipamentosError}
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
        <label className="text-xs font-semibold text-slate-600">
          Filtrar por loja
          <select
            value={lojaFilter}
            onChange={(event) => setLojaFilter(event.target.value)}
            className="mt-2 w-full max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none md:w-auto"
          >
            <option value="todas">Todas as lojas</option>
            {lojas.map((loja) => (
              <option key={loja.id} value={loja.id}>
                {loja.nome}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm shadow-slate-200">
        <div className="space-y-3 p-3 md:hidden">
          {equipamentosLoading ? (
            <p className="py-3 text-center text-sm text-slate-500">
              Carregando equipamentos...
            </p>
          ) : visibleEquipamentos.length === 0 ? (
            <p className="py-3 text-center text-sm text-slate-500">
              Nenhum equipamento encontrado.
            </p>
          ) : (
            visibleEquipamentos.map((equipamento) => {
              const loja = lojas.find((item) => item.id === equipamento.loja_id);
              const prestador = prestadores.find(
                (item) => item.id === equipamento.prestador_id,
              );
              return (
                <article
                  key={equipamento.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-slate-900">
                      {equipamento.tipo_equipamento}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        equipamento.status === "ativo"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {equipamento.status === "ativo" ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-slate-500">
                    <p>{loja?.nome ?? "—"}</p>
                    <p>{equipamento.identificacao ?? "—"}</p>
                    <p>
                      {[equipamento.marca, equipamento.modelo]
                        .filter(Boolean)
                        .join(" / ") || "—"}
                    </p>
                    <p>{prestador?.nome ?? "—"}</p>
                    <p className="capitalize">{equipamento.frequencia ?? "mensal"}</p>
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(equipamento)}
                      className="rounded-full border border-slate-200 p-2 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                      aria-label="Editar equipamento"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {equipamento.status === "ativo" ? (
                      <button
                        type="button"
                        onClick={() => void handleDesativar(equipamento)}
                        className="rounded-full border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 transition hover:border-red-300 hover:bg-red-50"
                      >
                        Desativar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleReativar(equipamento)}
                        className="rounded-full border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50"
                      >
                        Reativar
                      </button>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Equipamentos cadastrados</caption>
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">Loja</th>
                <th className="px-5 py-3 text-left">Tipo</th>
                <th className="px-5 py-3 text-left">Identificação</th>
                <th className="px-5 py-3 text-left">Marca/Modelo</th>
                <th className="px-5 py-3 text-left">Prestador</th>
                <th className="px-5 py-3 text-left">Frequência</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {equipamentosLoading ? (
                <tr>
                  <td className="px-5 py-6 text-center text-slate-500" colSpan={8}>
                    Carregando equipamentos...
                  </td>
                </tr>
              ) : visibleEquipamentos.length === 0 ? (
                <tr>
                  <td className="px-5 py-6 text-center text-slate-500" colSpan={8}>
                    Nenhum equipamento encontrado.
                  </td>
                </tr>
              ) : (
                visibleEquipamentos.map((equipamento) => {
                  const loja = lojas.find((item) => item.id === equipamento.loja_id);
                  const prestador = prestadores.find(
                    (item) => item.id === equipamento.prestador_id,
                  );
                  return (
                    <tr key={equipamento.id} className="text-slate-700">
                      <td className="px-5 py-4">{loja?.nome ?? "—"}</td>
                      <td className="px-5 py-4 font-semibold text-slate-900">
                        {equipamento.tipo_equipamento}
                      </td>
                      <td className="px-5 py-4">{equipamento.identificacao ?? "—"}</td>
                      <td className="px-5 py-4">
                        {[equipamento.marca, equipamento.modelo]
                          .filter(Boolean)
                          .join(" / ") || "—"}
                      </td>
                      <td className="px-5 py-4">{prestador?.nome ?? "—"}</td>
                      <td className="px-5 py-4 capitalize">
                        {equipamento.frequencia ?? "mensal"}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            equipamento.status === "ativo"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {equipamento.status === "ativo" ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(equipamento)}
                            className="rounded-full border border-slate-200 p-2 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                            aria-label="Editar equipamento"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {equipamento.status === "ativo" ? (
                            <button
                              type="button"
                              onClick={() => void handleDesativar(equipamento)}
                              className="rounded-full border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 transition hover:border-red-300 hover:bg-red-50"
                            >
                              Desativar
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleReativar(equipamento)}
                              className="rounded-full border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50"
                            >
                              Reativar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {isCreateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-100/80 px-4 py-6"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 text-slate-900 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {editing ? "Editar equipamento" : "Novo equipamento"}
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {editing ? editing.tipo_equipamento : "Cadastrar novo equipamento"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200"
                aria-label="Fechar modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="grid gap-3">
                <label className="text-xs font-semibold text-slate-600">
                  Loja
                  <select
                    required
                    value={formLojaId}
                    onChange={(event) => setFormLojaId(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  >
                    <option value="">Selecione</option>
                    {lojas.map((loja) => (
                      <option key={loja.id} value={loja.id}>
                        {loja.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Tipo de equipamento
                  <input
                    required
                    list="tipos-equipamento-sugeridos"
                    value={formTipo}
                    onChange={(event) => setFormTipo(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  />
                  <datalist id="tipos-equipamento-sugeridos">
                    {tiposSugeridos.map((tipo) => (
                      <option key={tipo} value={tipo} />
                    ))}
                  </datalist>
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Identificação
                  <input
                    value={formIdentificacao}
                    onChange={(event) => setFormIdentificacao(event.target.value)}
                    placeholder='Ex.: "Gerador 01"'
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-semibold text-slate-600">
                    Marca
                    <input
                      value={formMarca}
                      onChange={(event) => setFormMarca(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-600">
                    Modelo
                    <input
                      value={formModelo}
                      onChange={(event) => setFormModelo(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    />
                  </label>
                </div>
                <label className="text-xs font-semibold text-slate-600">
                  Potência
                  <input
                    value={formPotencia}
                    onChange={(event) => setFormPotencia(event.target.value)}
                    placeholder='Ex.: "150KVA"'
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Frequência
                  <select
                    value={formFrequencia}
                    onChange={(event) => setFormFrequencia(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  >
                    <option value="mensal">Mensal</option>
                    <option value="semestral">Semestral</option>
                    <option value="anual">Anual</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Prestador
                  <select
                    value={formPrestadorId}
                    onChange={(event) => setFormPrestadorId(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  >
                    <option value="">Nenhum</option>
                    {prestadores.map((prestador) => (
                      <option key={prestador.id} value={prestador.id}>
                        {prestador.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Número de série
                  <input
                    value={formNumeroSerie}
                    onChange={(event) => setFormNumeroSerie(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Localização
                  <input
                    value={formLocalizacao}
                    onChange={(event) => setFormLocalizacao(event.target.value)}
                    placeholder="Ex.: Cobertura, área técnica"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-semibold text-slate-600">
                    Data de instalação
                    <input
                      type="date"
                      value={formDataInstalacao}
                      onChange={(event) => setFormDataInstalacao(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-600">
                    Data de ativação
                    <input
                      type="date"
                      value={formDataAtivacao}
                      onChange={(event) => setFormDataAtivacao(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    />
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
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
