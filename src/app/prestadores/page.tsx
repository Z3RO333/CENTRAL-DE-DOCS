"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ClipboardList, UserPlus } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { usePrestadores } from "@/hooks/usePrestadores";
import { supabase } from "@/lib/supabaseClient";
import { type PrestadorRegra } from "@/lib/prestadorRegras";

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
    refresh: refreshPrestadores,
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
  const [regras, setRegras] = useState<PrestadorRegra[]>([]);
  const [regrasLoading, setRegrasLoading] = useState(false);
  const [regrasError, setRegrasError] = useState<string | null>(null);
  const [regraFeedback, setRegraFeedback] = useState<{
    error: string | null;
    success: string | null;
  }>({ error: null, success: null });
  const [regraForm, setRegraForm] = useState({
    tipoRegra: "formulario",
    alvo: "registro_laudos",
    periodo: "mensal",
    quantidade: "12",
    label: "",
  });
  const [emailsForm, setEmailsForm] = useState("");
  const [emailsFeedback, setEmailsFeedback] = useState<{
    error: string | null;
    success: string | null;
  }>({ error: null, success: null });

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

  const formularioOptions = [
    { value: "registro_laudos", label: "Registro e Laudos" },
    { value: "retencao_trabalhista", label: "Retencao Trabalhista" },
    { value: "notas_fiscais", label: "Notas Fiscais" },
  ];

  const carregarRegras = useCallback(async () => {
    if (!user) {
      return;
    }
    if (prestadores.length === 0) {
      setRegras([]);
      setRegrasLoading(false);
      setRegrasError(null);
      return;
    }
    setRegrasLoading(true);
    setRegrasError(null);
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
        params.size > 0
          ? `/api/prestador-regras?${params.toString()}`
          : "/api/prestador-regras";
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as {
        regras?: PrestadorRegra[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Nao foi possivel carregar as regras.");
      }
      setRegras(payload.regras ?? []);
    } catch (err) {
      setRegrasError(
        err instanceof Error ? err.message : "Nao foi possivel carregar as regras.",
      );
    } finally {
      setRegrasLoading(false);
    }
  }, [prestadores, user]);

  useEffect(() => {
    if (user && !prestadoresLoading) {
      void carregarRegras();
    }
  }, [user, prestadoresLoading, carregarRegras]);

  const regrasPorPrestador = useMemo(() => {
    return regras.reduce<Record<string, PrestadorRegra[]>>((acc, regra) => {
      if (!acc[regra.prestador_id]) {
        acc[regra.prestador_id] = [];
      }
      acc[regra.prestador_id].push(regra);
      return acc;
    }, {});
  }, [regras]);

  useEffect(() => {
    if (!selectedPrestador) {
      return;
    }
    if (regraForm.tipoRegra === "tipo_servico" && !regraForm.alvo.trim()) {
      setRegraForm((prev) => ({
        ...prev,
        alvo: selectedPrestador.tipo_servico || "",
      }));
    }
  }, [regraForm.tipoRegra, regraForm.alvo, selectedPrestador]);

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

  const handleRegraFieldChange = (
    field: keyof typeof regraForm,
    value: string,
  ) => {
    setRegraForm((prev) => ({
      ...prev,
      [field]: value,
    }));
    setRegraFeedback({ error: null, success: null });
  };

  const handleRegraSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRegraFeedback({ error: null, success: null });

    if (!selectedPrestadorId) {
      setRegraFeedback({
        error: "Selecione um prestador para cadastrar a regra.",
        success: null,
      });
      return;
    }

    const alvo = regraForm.alvo.trim();
    const quantidade = Number(regraForm.quantidade);

    if (!alvo) {
      setRegraFeedback({
        error: "Informe o alvo da regra.",
        success: null,
      });
      return;
    }
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      setRegraFeedback({
        error: "Informe uma quantidade valida.",
        success: null,
      });
      return;
    }

    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }
      const token = data.session?.access_token;
      if (!token) {
        throw new Error("Sessao expirada. Faca login novamente.");
      }

      const response = await fetch("/api/prestador-regras", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prestador_id: selectedPrestadorId,
          tipo_regra: regraForm.tipoRegra,
          alvo,
          periodo: regraForm.periodo,
          quantidade,
          label: regraForm.label.trim() || null,
        }),
      });

      const payload = (await response.json()) as {
        regra?: PrestadorRegra;
        error?: string;
      };

      if (!response.ok || !payload.regra) {
        throw new Error(payload.error ?? "Nao foi possivel cadastrar a regra.");
      }

      setRegraFeedback({
        error: null,
        success: "Regra cadastrada com sucesso.",
      });
      setRegraForm((prev) => ({
        ...prev,
        label: "",
        quantidade: prev.quantidade || "12",
      }));
      await carregarRegras();
    } catch (err) {
      setRegraFeedback({
        error:
          err instanceof Error
            ? err.message
            : "Nao foi possivel cadastrar a regra.",
        success: null,
      });
    }
  };

  const handleEmailsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmailsFeedback({ error: null, success: null });

    if (!selectedPrestadorId) {
      setEmailsFeedback({
        error: "Selecione um prestador para adicionar e-mails.",
        success: null,
      });
      return;
    }

    const emails = emailsForm
      .split(/[,;\n]/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    if (emails.length === 0) {
      setEmailsFeedback({
        error: "Informe ao menos um e-mail valido.",
        success: null,
      });
      return;
    }

    if (
      !window.confirm(
        `Adicionar ${emails.length} e-mail(s) ao prestador selecionado?`,
      )
    ) {
      return;
    }

    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }
      const token = data.session?.access_token;
      if (!token) {
        throw new Error("Sessao expirada. Faca login novamente.");
      }

      const response = await fetch("/api/prestadores", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: selectedPrestadorId,
          emails,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Nao foi possivel atualizar o prestador.");
      }

      setEmailsFeedback({
        error: null,
        success: "E-mails adicionados ao prestador.",
      });
      setEmailsForm("");
      await refreshPrestadores();
    } catch (err) {
      setEmailsFeedback({
        error:
          err instanceof Error
            ? err.message
            : "Nao foi possivel atualizar o prestador.",
        success: null,
      });
    }
  };

  const handleEmailRemove = async (emailToRemove: string) => {
    if (!selectedPrestadorId) {
      return;
    }
    setEmailsFeedback({ error: null, success: null });
    if (!window.confirm(`Remover o e-mail ${emailToRemove}?`)) {
      return;
    }

    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }
      const token = data.session?.access_token;
      if (!token) {
        throw new Error("Sessao expirada. Faca login novamente.");
      }

      const response = await fetch("/api/prestadores", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: selectedPrestadorId,
          remove_emails: [emailToRemove],
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Nao foi possivel atualizar o prestador.");
      }

      setEmailsFeedback({
        error: null,
        success: "E-mail removido do prestador.",
      });
      await refreshPrestadores();
    } catch (err) {
      setEmailsFeedback({
        error:
          err instanceof Error
            ? err.message
            : "Nao foi possivel atualizar o prestador.",
        success: null,
      });
    }
  };

  const handlePrestadorDelete = async () => {
    if (!selectedPrestadorId) {
      return;
    }
    setPrestadorFeedback({ error: null, success: null });
    if (!window.confirm("Remover este prestador e suas regras?")) {
      return;
    }

    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }
      const token = data.session?.access_token;
      if (!token) {
        throw new Error("Sessao expirada. Faca login novamente.");
      }

      const response = await fetch(`/api/prestadores?id=${selectedPrestadorId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Nao foi possivel remover o prestador.");
      }

      setPrestadorFeedback({
        error: null,
        success: "Prestador removido.",
      });
      await refreshPrestadores();
      await carregarRegras();
      setSelectedPrestadorId("");
    } catch (err) {
      setPrestadorFeedback({
        error:
          err instanceof Error ? err.message : "Nao foi possivel remover o prestador.",
        success: null,
      });
    }
  };

  const handleRegraDelete = async (regraId: string) => {
    setRegraFeedback({ error: null, success: null });
    if (!window.confirm("Remover esta regra de monitoramento?")) {
      return;
    }
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }
      const token = data.session?.access_token;
      if (!token) {
        throw new Error("Sessao expirada. Faca login novamente.");
      }
      const response = await fetch(`/api/prestador-regras?id=${regraId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Nao foi possivel remover a regra.");
      }
      setRegraFeedback({
        error: null,
        success: "Regra removida.",
      });
      await carregarRegras();
    } catch (err) {
      setRegraFeedback({
        error:
          err instanceof Error ? err.message : "Nao foi possivel remover a regra.",
        success: null,
      });
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Building2 className="h-4 w-4 text-slate-600" />
            Prestadores
          </p>
          <p className="text-sm text-slate-500">
            Cadastre prestadores, adicione e-mails e defina regras de monitoramento.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex items-center rounded-full border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 transition hover:border-sky-400 hover:text-sky-600"
        >
          Voltar para formularios
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
      <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 text-xs text-slate-600">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <ClipboardList className="h-4 w-4 text-slate-500" />
          Passo 1
        </div>
        <p className="mt-2 text-sm font-semibold text-slate-800">
          Escolha um prestador
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Selecione o prestador para ver detalhes e regras.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-100 bg-white/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  1. Escolha o prestador
                </p>
                <span className="text-[11px] text-slate-500">
                  Selecione para ver detalhes e gerenciar regras.
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
                {prestadores.map((prestador) => {
                  const regrasDoPrestador =
                    regrasPorPrestador[prestador.id] ?? [];
                  const regraDestaque = regrasDoPrestador[0] ?? null;
                  const labelDestaque = regraDestaque
                    ? regraDestaque.label?.trim() ||
                      (regraDestaque.tipo_regra === "formulario"
                        ? formularioOptions.find(
                            (option) => option.value === regraDestaque.alvo,
                          )?.label ?? regraDestaque.alvo
                        : regraDestaque.alvo)
                    : null;

                  return (
                    <button
                      key={prestador.id}
                      type="button"
                      onClick={() => setSelectedPrestadorId(prestador.id)}
                      className={`text-left rounded-2xl border px-4 py-3 transition ${
                        selectedPrestadorId === prestador.id
                          ? "border-sky-300 bg-sky-50/60 shadow-sm shadow-sky-100"
                          : "border-slate-100 bg-slate-50/80 hover:border-slate-200"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            {prestador.nome}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {prestador.tipo_servico}
                          </p>
                        </div>
                        <span className="text-[11px] text-slate-500">
                          {regrasDoPrestador.length} regra(s)
                        </span>
                      </div>
                      {labelDestaque ? (
                        <p className="mt-2 text-[11px] text-slate-500">
                          Regra destaque: {labelDestaque} -{" "}
                          {regraDestaque?.quantidade} /{" "}
                          {regraDestaque?.periodo === "mensal" ? "mes" : "ano"}
                        </p>
                      ) : (
                        <p className="mt-2 text-[11px] text-slate-500">
                          Nenhuma regra cadastrada.
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              2. Detalhes do prestador
            </p>
            {regrasLoading && (
              <p className="mt-2 text-xs text-slate-500">
                Carregando regras de progresso...
              </p>
            )}
            {regrasError && (
              <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {regrasError}
              </p>
            )}
            {selectedPrestador ? (
              <div className="mt-3 space-y-2 text-xs text-slate-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-2">
                    <p>
                      <span className="font-semibold text-slate-700">
                        Tipo de servico:
                      </span>{" "}
                      {selectedPrestador.tipo_servico}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-700">CNPJ:</span>{" "}
                      {selectedPrestador.cnpj}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handlePrestadorDelete()}
                    className="rounded-full border border-red-200 px-3 py-1 text-[11px] font-semibold text-red-600 transition hover:border-red-300 hover:text-red-700"
                  >
                    Remover prestador
                  </button>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      E-mails do prestador
                    </p>
                    <form onSubmit={handleEmailsSubmit} className="mt-2 space-y-2">
                      {emailsFeedback.error || emailsFeedback.success ? (
                        <div
                          className={`rounded-md border px-2 py-1 text-[11px] ${
                            emailsFeedback.error
                              ? "border-red-200 bg-red-50 text-red-700"
                              : "border-emerald-200 bg-emerald-50 text-emerald-800"
                          }`}
                        >
                          {emailsFeedback.error || emailsFeedback.success}
                        </div>
                      ) : null}
                      <textarea
                        value={emailsForm}
                        onChange={(event) => setEmailsForm(event.target.value)}
                        className="min-h-[80px] w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700 outline-none transition focus:border-sky-400"
                        placeholder="Ex.: ana@empresa.com, bruno@empresa.com"
                      />
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          className="rounded-full bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-500"
                        >
                          Adicionar e-mails
                        </button>
                      </div>
                    </form>
                    <div className="mt-3">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Usuarios vinculados
                      </span>
                      {selectedPrestador.usuarios.length === 0 ? (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Nenhum e-mail vinculado.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
                          {selectedPrestador.usuarios.map((usuario) => (
                            <li
                              key={usuario}
                              className="flex items-center justify-between gap-2"
                            >
                              <span>{usuario}</span>
                              <button
                                type="button"
                                onClick={() => void handleEmailRemove(usuario)}
                                className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 transition hover:border-red-200 hover:text-red-600"
                              >
                                Remover
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Regras de monitoramento
                    </p>
                    {regrasPorPrestador[selectedPrestador.id]?.length ? (
                      <div className="mt-2 space-y-2">
                        {regrasPorPrestador[selectedPrestador.id].map((regra) => {
                          const label =
                            regra.label?.trim() ||
                            (regra.tipo_regra === "formulario"
                              ? formularioOptions.find(
                                  (option) => option.value === regra.alvo,
                                )?.label ?? regra.alvo
                              : regra.alvo);
                          const tipoRegraLabel =
                            regra.tipo_regra === "formulario"
                              ? "Formulario"
                              : "Tipo de servico";
                          return (
                            <div
                              key={regra.id}
                              className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2"
                            >
                              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                <div className="flex items-center gap-2">
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                    {tipoRegraLabel}
                                  </span>
                                  <span className="font-semibold text-slate-700">
                                    {label}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void handleRegraDelete(regra.id)}
                                  className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 transition hover:border-red-200 hover:text-red-600"
                                >
                                  Remover
                                </button>
                              </div>
                              <p className="mt-1 text-[11px] text-slate-500">
                                Meta: {regra.quantidade} no periodo {regra.periodo === "mensal" ? "mensal" : "anual"}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] text-slate-500">
                        Nenhuma regra cadastrada para este prestador.
                      </p>
                    )}
                  </div>
                </div>              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                Selecione um prestador para ver detalhes e regras.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <form
            onSubmit={handlePrestadorSubmit}
            className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-4"
          >
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <UserPlus className="h-4 w-4 text-slate-600" />
              3. Cadastrar novo prestador
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
                  placeholder="Ex.: ana@empresa.com, bruno@empresa.com"
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

          <form
            onSubmit={handleRegraSubmit}
            className="space-y-4 rounded-2xl border border-slate-100 bg-white/80 p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              4. Criar regra de monitoramento
            </p>
            <p className="text-[11px] text-slate-500">
              Prestador selecionado:{" "}
              <span className="font-semibold text-slate-700">
                {selectedPrestador?.nome ?? "Nenhum"}
              </span>
            </p>
            <p className="text-[11px] text-slate-500">
              Escolha um formulario ou tipo de servico e defina a quantidade por periodo.
            </p>
            {(regraFeedback.error || regraFeedback.success) && (
              <div
                className={`rounded-xl border px-3 py-2 text-[11px] ${
                  regraFeedback.error
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-800"
                }`}
              >
                {regraFeedback.error || regraFeedback.success}
              </div>
            )}
            <div className="grid gap-3">
              <label className="text-xs font-semibold text-slate-600">
                Tipo da regra
                <select
                  value={regraForm.tipoRegra}
                  onChange={(event) => {
                    const value = event.target.value;
                    setRegraForm((prev) => ({
                      ...prev,
                      tipoRegra: value,
                      alvo:
                        value === "formulario"
                          ? "registro_laudos"
                          : prev.alvo,
                    }));
                    setRegraFeedback({ error: null, success: null });
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                >
                  <option value="formulario">Formulario</option>
                  <option value="tipo_servico">Tipo de servico</option>
                </select>
              </label>
              {regraForm.tipoRegra === "formulario" ? (
                <label className="text-xs font-semibold text-slate-600">
                  Formulario alvo
                  <select
                    value={regraForm.alvo}
                    onChange={(event) =>
                      handleRegraFieldChange("alvo", event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  >
                    {formularioOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="text-xs font-semibold text-slate-600">
                  Tipo de servico alvo
                  <input
                    type="text"
                    value={regraForm.alvo}
                    onChange={(event) =>
                      handleRegraFieldChange("alvo", event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    placeholder="Ex.: Refrigeracao"
                    required
                  />
                </label>
              )}
              <label className="text-xs font-semibold text-slate-600">
                Periodo
                <select
                  value={regraForm.periodo}
                  onChange={(event) =>
                    handleRegraFieldChange("periodo", event.target.value)
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                >
                  <option value="mensal">Mensal</option>
                  <option value="anual">Anual</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Quantidade esperada
                <input
                  type="number"
                  min="1"
                  value={regraForm.quantidade}
                  onChange={(event) =>
                    handleRegraFieldChange("quantidade", event.target.value)
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  required
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Nome exibido (opcional)
                <input
                  type="text"
                  value={regraForm.label}
                  onChange={(event) =>
                    handleRegraFieldChange("label", event.target.value)
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  placeholder="Ex.: Refrigeracao mensal"
                />
              </label>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-500"
              >
                Salvar regra
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
