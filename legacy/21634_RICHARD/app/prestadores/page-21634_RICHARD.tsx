"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, UserPlus } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { usePrestadores } from "@/hooks/usePrestadores";
import { supabase } from "@/lib/supabaseClient";
import { SERVICOS_OFICIAIS } from "@/lib/servicosVocab";
import { type PrestadorRegra } from "@/lib/prestadorRegras";

export default function PrestadoresPage() {
  const router = useRouter();
  const { user, isLoading, error: authError } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();
  const canManagePrestadores = isAdmin;
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
    tipo_regra: "formulario",
    alvo: "",
    periodo: "mensal",
    quantidade: "12",
    label: "",
    aplica_anteriores: "true",
    aplica_desde: "",
    modo_conflito: "multi",
  });
  const [emailsForm, setEmailsForm] = useState("");
  const [emailsFeedback, setEmailsFeedback] = useState<{
    error: string | null;
    success: string | null;
  }>({ error: null, success: null });
  const [searchTerm, setSearchTerm] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isCreatePrestadorOpen, setIsCreatePrestadorOpen] = useState(false);
  const [isCreateRegraOpen, setIsCreateRegraOpen] = useState(false);
  const [isVinculoOpen, setIsVinculoOpen] = useState(false);
  const [vinculoRegraId, setVinculoRegraId] = useState<string | null>(null);
  const [vinculos, setVinculos] = useState<
    Record<
      string,
      { regra_id: string; tipo_vinculo: "auto" | "manual" }[]
    >
  >({});
  const [vinculosLoading, setVinculosLoading] = useState(false);
  const [vinculosError, setVinculosError] = useState<string | null>(null);
  const [documentosVinculo, setDocumentosVinculo] = useState<
    {
      id: string;
      tipo: string;
      created_at: string;
      dados: Record<string, unknown> | null;
      arquivo_path?: string | null;
      arquivo_assinado_path?: string | null;
    }[]
  >([]);
  const [documentosLoading, setDocumentosLoading] = useState(false);
  const [documentosError, setDocumentosError] = useState<string | null>(null);
  const [documentoSearch, setDocumentoSearch] = useState("");
  const [applyRegraId, setApplyRegraId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
      return;
    }
    if (!isLoading && !accessLoading && user && !canManagePrestadores) {
      router.replace("/documentos");
    }
  }, [isLoading, accessLoading, user, router, canManagePrestadores]);

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
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredPrestadores = useMemo(() => {
    if (!normalizedSearch) {
      return prestadores;
    }
    return prestadores.filter((prestador) => {
      const nome = prestador.nome?.toLowerCase() ?? "";
      const tipo = prestador.tipo_servico?.toLowerCase() ?? "";
      const cnpj = prestador.cnpj?.toLowerCase() ?? "";
      const emails = prestador.usuarios.join(" ").toLowerCase();
      return (
        nome.includes(normalizedSearch) ||
        tipo.includes(normalizedSearch) ||
        cnpj.includes(normalizedSearch) ||
        emails.includes(normalizedSearch)
      );
    });
  }, [prestadores, normalizedSearch]);
  const visiblePrestadores = useMemo(
    () => filteredPrestadores.slice(0, pageSize),
    [filteredPrestadores, pageSize],
  );

  const formularioOptions = [
    { value: "registro_laudos", label: "Registro e Laudos" },
    { value: "retencao_trabalhista", label: "Retenção Trabalhista" },
    { value: "notas_fiscais", label: "Notas Fiscais" },
  ];
  const alvoSugestoes = useMemo(() => {
    if (regraForm.tipo_regra === "formulario") {
      return formularioOptions.map((option) => option.value);
    }
    return [...SERVICOS_OFICIAIS];
  }, [regraForm.tipo_regra]);
const resolveRegraLabel = (alvo: string, label?: string | null) => {
  if (label && label.trim()) {
    return label.trim();
  }
  const match = formularioOptions.find((option) => option.value === alvo);
  return match?.label ?? alvo;
};

const getDocumentoNome = (registro: {
  id: string;
  dados: Record<string, unknown> | null;
  arquivo_path?: string | null;
  arquivo_assinado_path?: string | null;
}) => {
  const anexos = registro.dados?.anexos;
  if (Array.isArray(anexos) && anexos.length > 0) {
    const primeiro = anexos[0] as { nome?: unknown } | null;
    if (primeiro && typeof primeiro.nome === "string" && primeiro.nome.trim()) {
      return primeiro.nome.trim();
    }
  }
  const path = registro.arquivo_assinado_path ?? registro.arquivo_path;
  if (path) {
    return path.split("/").pop() ?? path;
  }
  return registro.id;
};

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
        throw new Error("Sessão expirada. Faça login novamente.");
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
        throw new Error(payload.error ?? "Não foi possível carregar as regras.");
      }
      setRegras(payload.regras ?? []);
    } catch (err) {
      setRegrasError(
        err instanceof Error ? err.message : "Não foi possível carregar as regras.",
      );
    } finally {
      setRegrasLoading(false);
    }
  }, [prestadores, user]);

  const carregarVinculos = useCallback(
    async (prestadorId: string) => {
      if (!user) {
        return;
      }

      setVinculosLoading(true);
      setVinculosError(null);

      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          throw sessionError;
        }
        const token = data.session?.access_token;
        if (!token) {
          throw new Error("Sessão expirada. Faça login novamente.");
        }

        const response = await fetch(
          `/api/prestador-regras-vinculos?prestadorId=${encodeURIComponent(
            prestadorId,
          )}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        const payload = (await response.json()) as {
          vinculos?: {
            regra_id: string;
            documento_id: string;
            tipo_vinculo: "auto" | "manual";
          }[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Não foi possível carregar vínculos.");
        }

        const next = (payload.vinculos ?? []).reduce<
          Record<
            string,
            { regra_id: string; tipo_vinculo: "auto" | "manual" }[]
          >
        >((acc, vinculo) => {
          if (!acc[vinculo.documento_id]) {
            acc[vinculo.documento_id] = [];
          }
          acc[vinculo.documento_id].push({
            regra_id: vinculo.regra_id,
            tipo_vinculo: vinculo.tipo_vinculo,
          });
          return acc;
        }, {});

        setVinculos(next);
      } catch (err) {
        setVinculosError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar vínculos.",
        );
        setVinculos({});
      } finally {
        setVinculosLoading(false);
      }
    },
    [user],
  );

  const carregarDocumentosVinculo = useCallback(
    async (prestadorId: string) => {
      if (!user) {
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
          throw new Error("Sessão expirada. Faça login novamente.");
        }

        const params = new URLSearchParams();
        params.set("prestadorId", prestadorId);
        params.set("limit", "200");

        const response = await fetch(`/api/documentos?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const payload = (await response.json()) as {
          registros?: {
            id: string;
            tipo: string;
            created_at: string;
            dados: Record<string, unknown> | null;
            prestador_id?: string | null;
            arquivo_path?: string | null;
            arquivo_assinado_path?: string | null;
          }[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(
            payload.error ?? "Não foi possível carregar documentos.",
          );
        }

        const filtrados =
          payload.registros?.filter(
            (registro) => registro.prestador_id === prestadorId,
          ) ?? [];
        setDocumentosVinculo(filtrados);
      } catch (err) {
        setDocumentosError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar documentos.",
        );
        setDocumentosVinculo([]);
      } finally {
        setDocumentosLoading(false);
      }
    },
    [user],
  );

  useEffect(() => {
    if (user && !prestadoresLoading) {
      void carregarRegras();
    }
  }, [user, prestadoresLoading, carregarRegras]);

  useEffect(() => {
    if (!isVinculoOpen || !selectedPrestador?.id) {
      return;
    }
    void carregarVinculos(selectedPrestador.id);
    void carregarDocumentosVinculo(selectedPrestador.id);
  }, [
    isVinculoOpen,
    selectedPrestador?.id,
    carregarVinculos,
    carregarDocumentosVinculo,
  ]);

  const regrasPorPrestador = useMemo(() => {
    return regras.reduce<Record<string, PrestadorRegra[]>>((acc, regra) => {
      if (!acc[regra.prestador_id]) {
        acc[regra.prestador_id] = [];
      }
      acc[regra.prestador_id].push(regra);
      return acc;
    }, {});
  }, [regras]);

  const regraSelecionada = useMemo(() => {
    if (!selectedPrestadorId || !vinculoRegraId) {
      return null;
    }
    return (
      regrasPorPrestador[selectedPrestadorId]?.find(
        (regra) => regra.id === vinculoRegraId,
      ) ?? null
    );
  }, [regrasPorPrestador, selectedPrestadorId, vinculoRegraId]);

  const documentosFiltrados = useMemo(() => {
    const termo = documentoSearch.trim().toLowerCase();
    if (!termo) {
      return documentosVinculo;
    }
    return documentosVinculo.filter((doc) => {
      const tipo = doc.tipo?.toLowerCase() ?? "";
      const createdAt = doc.created_at ?? "";
      return tipo.includes(termo) || createdAt.includes(termo);
    });
  }, [documentosVinculo, documentoSearch]);

  const isDocumentoVinculado = useCallback(
    (documentoId: string, regraId: string) => {
      const list = vinculos[documentoId] ?? [];
      return list.some((item) => item.regra_id === regraId);
    },
    [vinculos],
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
      setIsCreatePrestadorOpen(false);
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
      ...(field === "tipo_regra" ? { alvo: "" } : {}),
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
    const aplicaAnteriores = regraForm.aplica_anteriores === "true";
    const aplicaDesde = regraForm.aplica_desde.trim();

    if (!alvo) {
      setRegraFeedback({
        error: "Informe o alvo da regra.",
        success: null,
      });
      return;
    }
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      setRegraFeedback({
        error: "Informe uma quantidade válida.",
        success: null,
      });
      return;
    }
    if (!aplicaAnteriores && !aplicaDesde) {
      setRegraFeedback({
        error: "Informe uma data inicial para aplicar a regra.",
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
        throw new Error("Sessão expirada. Faça login novamente.");
      }

      const response = await fetch("/api/prestador-regras", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prestador_id: selectedPrestadorId,
          tipo_regra: regraForm.tipo_regra,
          alvo,
          periodo: regraForm.periodo,
          quantidade,
          label: regraForm.label.trim() || null,
          aplica_anteriores: aplicaAnteriores,
          aplica_desde: aplicaAnteriores ? null : aplicaDesde,
          modo_conflito: regraForm.modo_conflito,
        }),
      });

      const payload = (await response.json()) as {
        regra?: PrestadorRegra;
        error?: string;
      };

      if (!response.ok || !payload.regra) {
        throw new Error(payload.error ?? "Não foi possível cadastrar a regra.");
      }

      setRegraFeedback({
        error: null,
        success: "Regra cadastrada com sucesso.",
      });
      setRegraForm((prev) => ({
        ...prev,
        label: "",
        quantidade: prev.quantidade || "12",
        aplica_desde: "",
      }));
      await carregarRegras();
      setIsCreateRegraOpen(false);
    } catch (err) {
      setRegraFeedback({
        error:
          err instanceof Error
            ? err.message
            : "Não foi possível cadastrar a regra.",
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
        error: "Informe ao menos um e-mail válido.",
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
        throw new Error("Sessão expirada. Faça login novamente.");
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
        throw new Error(payload.error ?? "Não foi possível atualizar o prestador.");
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
            : "Não foi possível atualizar o prestador.",
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
        throw new Error("Sessão expirada. Faça login novamente.");
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
        throw new Error(payload.error ?? "Não foi possível atualizar o prestador.");
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
            : "Não foi possível atualizar o prestador.",
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
        throw new Error("Sessão expirada. Faça login novamente.");
      }

      const response = await fetch(`/api/prestadores?id=${selectedPrestadorId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível remover o prestador.");
      }

      setPrestadorFeedback({
        error: null,
        success: "Prestador removido.",
      });
      await refreshPrestadores();
      await carregarRegras();
      setSelectedPrestadorId("");
      setIsDetailsOpen(false);
    } catch (err) {
      setPrestadorFeedback({
        error:
          err instanceof Error ? err.message : "Não foi possível remover o prestador.",
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
        throw new Error("Sessão expirada. Faça login novamente.");
      }
      const response = await fetch(`/api/prestador-regras?id=${regraId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível remover a regra.");
      }
      setRegraFeedback({
        error: null,
        success: "Regra removida.",
      });
      await carregarRegras();
    } catch (err) {
      setRegraFeedback({
        error:
          err instanceof Error ? err.message : "Não foi possível remover a regra.",
        success: null,
      });
    }
  };

  const handleAplicarRegra = async (regraId: string) => {
    if (!regraId) {
      return;
    }

    try {
      setApplyRegraId(regraId);
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }
      const token = data.session?.access_token;
      if (!token) {
        throw new Error("Sessão expirada. Faça login novamente.");
      }

      const response = await fetch("/api/prestador-regras-vinculos/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ regra_id: regraId }),
      });

      const payload = (await response.json()) as {
        inserted?: number;
        skipped?: number;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível aplicar a regra.");
      }

      setRegraFeedback({
        error: null,
        success: `Regra aplicada. Vinculos novos: ${payload.inserted ?? 0}.`,
      });
      if (selectedPrestadorId) {
        await carregarVinculos(selectedPrestadorId);
      }
    } catch (err) {
      setRegraFeedback({
        error:
          err instanceof Error
            ? err.message
            : "Não foi possível aplicar a regra.",
        success: null,
      });
    } finally {
      setApplyRegraId(null);
    }
  };

  const handleToggleVinculo = async (
    documentoId: string,
    regraId: string,
    nextValue: boolean,
  ) => {
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }
      const token = data.session?.access_token;
      if (!token) {
        throw new Error("Sessão expirada. Faça login novamente.");
      }

      if (nextValue) {
        const response = await fetch("/api/prestador-regras-vinculos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            regra_id: regraId,
            documento_id: documentoId,
            tipo_vinculo: "manual",
          }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Não foi possível criar o vínculo.");
        }
      } else {
        const params = new URLSearchParams();
        params.set("regraId", regraId);
        params.set("documentoId", documentoId);
        const response = await fetch(
          `/api/prestador-regras-vinculos?${params.toString()}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Não foi possível remover o vínculo.");
        }
      }

      if (selectedPrestadorId) {
        await carregarVinculos(selectedPrestadorId);
      }
    } catch (err) {
      setVinculosError(
        err instanceof Error
          ? err.message
          : "Não foi possível atualizar o vínculo.",
      );
    }
  };

  return (
    <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Gerenciamento de prestadores
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Cadastre prestadores, adicione e-mails e defina regras de monitoramento.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCreatePrestadorOpen(true)}
            className="inline-flex items-center rounded-full bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-500"
          >
            Novo prestador
          </button>
          <button
            type="button"
            onClick={() => setIsCreateRegraOpen(true)}
            className="inline-flex items-center rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-slate-600 shadow-sm shadow-slate-200 transition hover:bg-slate-50"
          >
            Nova regra
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-full border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 transition hover:border-sky-400 hover:text-sky-600"
          >
            Voltar para formulários
          </Link>
        </div>
      </header>

      {(prestadorFeedback.error ||
        prestadorFeedback.success ||
        prestadoresError) && (
        <div
          className={`rounded-2xl px-4 py-3 text-xs ${
            prestadorFeedback.error || prestadoresError
              ? "bg-red-50 text-red-700"
              : "bg-emerald-50 text-emerald-800"
          }`}
        >
          {prestadorFeedback.error ||
            prestadoresError ||
            prestadorFeedback.success}
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
                placeholder="Pesquisar por nome, serviço, CNPJ ou e-mail..."
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
              {[10, 20, 50].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm shadow-slate-200">
        <div className="space-y-3 p-3 md:hidden">
          {prestadoresLoading ? (
            <p className="py-3 text-center text-sm text-slate-500">
              Carregando prestadores...
            </p>
          ) : visiblePrestadores.length === 0 ? (
            <p className="py-3 text-center text-sm text-slate-500">
              Nenhum prestador encontrado.
            </p>
          ) : (
            visiblePrestadores.map((prestador) => {
              const isSelected = prestador.id === selectedPrestadorId;
              const regrasCount = regrasPorPrestador[prestador.id]?.length ?? 0;
              return (
                <article
                  key={prestador.id}
                  className={`rounded-xl border p-3 text-sm ${
                    isSelected
                      ? "border-sky-200 bg-sky-50/40"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <p className="font-semibold text-slate-900">{prestador.nome}</p>
                  <div className="mt-2 grid gap-1 text-xs text-slate-500">
                    <p>Serviço: {prestador.tipo_servico}</p>
                    <p>CNPJ: {prestador.cnpj}</p>
                    <p>{prestador.usuarios.length} e-mail(s)</p>
                    <p>{regrasCount} regra(s)</p>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPrestadorId(prestador.id);
                        setIsDetailsOpen(true);
                      }}
                      className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      {isSelected ? "Selecionado" : "Ver detalhes"}
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">Nome</th>
                <th className="px-5 py-3 text-left">Tipo de serviço</th>
                <th className="px-5 py-3 text-left">CNPJ</th>
                <th className="px-5 py-3 text-left">E-mails</th>
                <th className="px-5 py-3 text-left">Regras</th>
                <th className="px-5 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {prestadoresLoading ? (
                <tr>
                  <td className="px-5 py-6 text-center text-slate-500" colSpan={6}>
                    Carregando prestadores...
                  </td>
                </tr>
              ) : visiblePrestadores.length === 0 ? (
                <tr>
                  <td className="px-5 py-6 text-center text-slate-500" colSpan={6}>
                    Nenhum prestador encontrado.
                  </td>
                </tr>
              ) : (
                visiblePrestadores.map((prestador) => {
                  const isSelected = prestador.id === selectedPrestadorId;
                  const regrasCount =
                    regrasPorPrestador[prestador.id]?.length ?? 0;
                  return (
                    <tr
                      key={prestador.id}
                      className={isSelected ? "bg-sky-50/40" : "text-slate-700"}
                    >
                      <td className="px-5 py-4">
                        <div className="font-semibold text-slate-900">
                          {prestador.nome}
                        </div>
                      </td>
                      <td className="px-5 py-4">{prestador.tipo_servico}</td>
                      <td className="px-5 py-4">{prestador.cnpj}</td>
                      <td className="px-5 py-4">
                        {prestador.usuarios.length} e-mail(s)
                      </td>
                      <td className="px-5 py-4">{regrasCount} regra(s)</td>
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPrestadorId(prestador.id);
                            setIsDetailsOpen(true);
                          }}
                          className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          {isSelected ? "Selecionado" : "Ver detalhes"}
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

      {isDetailsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-100/80 px-4 py-6"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-4xl rounded-3xl bg-white p-6 text-slate-900 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Detalhes do prestador
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {selectedPrestador?.nome ?? "Nenhum prestador selecionado"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDetailsOpen(false)}
                className="rounded-full bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200"
                aria-label="Fechar detalhes"
              >
                ✕
              </button>
            </div>

            {regrasLoading && (
              <p className="mt-4 text-xs text-slate-500">
                Carregando regras de progresso...
              </p>
            )}
            {regrasError && (
              <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                {regrasError}
              </p>
            )}

            {selectedPrestador ? (
              <div className="mt-4 space-y-4 text-xs text-slate-600">
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Prestador selecionado
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-900 md:text-2xl">
                    {selectedPrestador.nome}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                    <span className="rounded-full bg-white px-3 py-1">
                      {selectedPrestador.usuarios.length} e-mail(s)
                    </span>
                    <span className="rounded-full bg-white px-3 py-1">
                      {selectedPrestador.tipo_servico}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-2">
                    <p>
                      <span className="font-semibold text-slate-700">
                        Tipo de serviço:
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
                  <div className="rounded-xl bg-white px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      E-mails do prestador
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2 py-1">
                        {selectedPrestador.usuarios.length} e-mail(s)
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-1">
                        {selectedPrestador.usuarios.length > 0
                          ? "Grupo ativo"
                          : "Sem usuários"}
                      </span>
                    </div>
                    <form onSubmit={handleEmailsSubmit} className="mt-2 space-y-2">
                      {emailsFeedback.error || emailsFeedback.success ? (
                        <div
                          className={`rounded-md px-2 py-1 text-[11px] ${
                            emailsFeedback.error
                              ? "bg-red-50 text-red-700"
                              : "bg-emerald-50 text-emerald-800"
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
                        Usuários vinculados
                      </span>
                      {selectedPrestador.usuarios.length === 0 ? (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Nenhum e-mail vinculado.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-2 text-sm text-slate-700">
                          {selectedPrestador.usuarios.map((usuario) => (
                            <li
                              key={usuario}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="rounded-full bg-slate-100 px-3 py-1">
                                {usuario}
                              </span>
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
                  <div className="rounded-xl bg-white px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Regras de monitoramento
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2 py-1">
                        {regrasPorPrestador[selectedPrestador.id]?.length ?? 0}{" "}
                        regra(s)
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-1">
                        {regrasPorPrestador[selectedPrestador.id]?.length
                          ? "Monitorando"
                          : "Sem regras"}
                      </span>
                    </div>
                    {regrasPorPrestador[selectedPrestador.id]?.length ? (
                      <div className="mt-2 space-y-2">
                        {regrasPorPrestador[selectedPrestador.id].map((regra) => {
                          const label = resolveRegraLabel(regra.alvo, regra.label);
                          return (
                            <div
                              key={regra.id}
                              className="rounded-xl bg-slate-50/60 px-3 py-2"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                                <span className="font-semibold text-slate-700">
                                  Regra: {label}
                                </span>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void handleAplicarRegra(regra.id)}
                                    disabled={applyRegraId === regra.id}
                                    className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {applyRegraId === regra.id
                                      ? "Aplicando..."
                                      : "Aplicar"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setVinculoRegraId(regra.id);
                                      setDocumentoSearch("");
                                      setIsVinculoOpen(true);
                                    }}
                                    className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                                  >
                                    Vincular docs
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRegraDelete(regra.id)}
                                    className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 transition hover:border-red-200 hover:text-red-600"
                                  >
                                    Remover
                                  </button>
                                </div>
                              </div>
                              <p className="mt-1 text-[11px] text-slate-500">
                                Meta: {regra.quantidade} no per︽do{" "}
                                {regra.periodo === "mensal" ? "mensal" : "anual"}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                Tipo:{" "}
                                {regra.tipo_regra === "tipo_servico"
                                  ? "Tipo de serviço"
                                  : "Tipo de formulario"}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                Aplicacao:{" "}
                                {regra.aplica_anteriores === false
                                  ? `A partir de ${regra.aplica_desde
                                      ? new Date(regra.aplica_desde).toLocaleDateString(
                                          "pt-BR",
                                        )
                                      : "data nao definida"}`
                                  : "Inclui documentos antigos"}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                Conflito:{" "}
                                {regra.modo_conflito === "single"
                                  ? "Uma regra por documento"
                                  : "Multiplas regras por documento"}
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
                </div>
              </div>
            ) : (
              <p className="mt-4 text-xs text-slate-500">
                Selecione um prestador para ver detalhes e regras.
              </p>
            )}

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setIsDetailsOpen(false)}
                className="rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-500"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {isCreatePrestadorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-100/80 px-4 py-6"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 text-slate-900 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Cadastrar novo prestador
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  Preencha os dados do prestador
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreatePrestadorOpen(false)}
                className="rounded-full bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200"
                aria-label="Fechar cadastro"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={handlePrestadorSubmit}
              className="mt-4 space-y-4"
            >
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
                    placeholder="Ex.: Laboratório XPTO"
                    required
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Tipo de serviço
                  <input
                    type="text"
                    value={prestadorForm.tipoServico}
                    onChange={(event) =>
                      handlePrestadorFieldChange("tipoServico", event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    placeholder="Ex.: Laudos técnicos"
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
                  Usuários autorizados
                  <textarea
                    value={prestadorForm.usuarios}
                    onChange={(event) =>
                      handlePrestadorFieldChange("usuarios", event.target.value)
                    }
                    className="mt-1 min-h-[90px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    placeholder="Ex.: ana@empresa.com, bruno@empresa.com"
                  />
                  <span className="text-[11px] text-slate-500">
                    Digite os e-mails de quem poderá usar esse prestador no formulário.
                  </span>
                </label>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreatePrestadorOpen(false)}
                  className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Cancelar
                </button>
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
      )}

      {isCreateRegraOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-100/80 px-4 py-6"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 text-slate-900 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Criar regra de monitoramento
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  Defina o alvo e o período
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateRegraOpen(false)}
                className="rounded-full bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200"
                aria-label="Fechar regra"
              >
                ✕
              </button>
            </div>

            <p className="mt-3 text-[11px] text-slate-500">
              Prestador selecionado:{" "}
              <span className="font-semibold text-slate-700">
                {selectedPrestador?.nome ?? "Nenhum"}
              </span>
            </p>
            <p className="text-[11px] text-slate-500">
              Informe o alvo da regra e a quantidade por período.
            </p>

            {(regraFeedback.error || regraFeedback.success) && (
              <div
                className={`mt-3 rounded-xl px-3 py-2 text-[11px] ${
                  regraFeedback.error
                    ? "bg-red-50 text-red-700"
                    : "bg-emerald-50 text-emerald-800"
                }`}
              >
                {regraFeedback.error || regraFeedback.success}
              </div>
            )}

            <form onSubmit={handleRegraSubmit} className="mt-4 space-y-4">
              <div className="grid gap-3">
                                <label className="text-xs font-semibold text-slate-600">
                  Tipo de regra
                  <select
                    value={regraForm.tipo_regra}
                    onChange={(event) =>
                      handleRegraFieldChange("tipo_regra", event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  >
                    <option value="formulario">Tipo de formulario</option>
                    <option value="tipo_servico">Tipo de serviço</option>
                  </select>
                  <span className="mt-1 block text-[11px] font-normal text-slate-500">
                    Use formulário para tipos (ex.: notas_fiscais) ou serviço
                    para laudos.
                  </span>
                </label>

                <label className="text-xs font-semibold text-slate-600">
                  Alvo da regra
                  <input
                    type="text"
                    value={regraForm.alvo}
                    onChange={(event) =>
                      handleRegraFieldChange("alvo", event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    placeholder="Ex.: refrigeração, notas_fiscais, retencao_trabalhista"
                    list="regra-alvos-sugestoes"
                    required
                  />
                </label>
                <datalist id="regra-alvos-sugestoes">
                  {alvoSugestoes.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
                <label className="text-xs font-semibold text-slate-600">
                  Período
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
                  Aplicar documentos antigos?
                  <select
                    value={regraForm.aplica_anteriores}
                    onChange={(event) =>
                      handleRegraFieldChange("aplica_anteriores", event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  >
                    <option value="true">Sim, incluir antigos</option>
                    <option value="false">Não, aplicar a partir de data</option>
                  </select>
                  <span className="mt-1 block text-[11px] font-normal text-slate-500">
                    Se escolher nao, a regra considera apenas documentos a partir
                    da data definida.
                  </span>
                </label>
                {regraForm.aplica_anteriores === "false" && (
                  <label className="text-xs font-semibold text-slate-600">
                    Data inicial
                    <input
                      type="date"
                      value={regraForm.aplica_desde}
                      onChange={(event) =>
                        handleRegraFieldChange("aplica_desde", event.target.value)
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    />
                  </label>
                )}
                <label className="text-xs font-semibold text-slate-600">
                  Conflito entre regras
                  <select
                    value={regraForm.modo_conflito}
                    onChange={(event) =>
                      handleRegraFieldChange("modo_conflito", event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  >
                    <option value="multi">Permitir varias regras por documento</option>
                    <option value="single">Apenas uma regra por documento</option>
                  </select>
                  <span className="mt-1 block text-[11px] font-normal text-slate-500">
                    Em modo unico, um documento so pode estar ligado a uma regra.
                  </span>
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
                    placeholder="Ex.: Refrigeração mensal"
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateRegraOpen(false)}
                  className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Cancelar
                </button>
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
      )}

      {isVinculoOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-100/80 px-4 py-6"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-5xl rounded-3xl bg-white p-6 text-slate-900 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Vincular documentos
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  Selecione os documentos para a regra
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsVinculoOpen(false);
                  setVinculoRegraId(null);
                }}
                className="rounded-full bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200"
                aria-label="Fechar vinculos"
              >
                ?
              </button>
            </div>

            <div className="mt-3 space-y-1 text-[11px] text-slate-500">
              <p>
                Prestador:{" "}
                <span className="font-semibold text-slate-700">
                  {selectedPrestador?.nome ?? "Nenhum"}
                </span>
              </p>
              <p>
                Regra:{" "}
                <span className="font-semibold text-slate-700">
                  {regraSelecionada
                    ? resolveRegraLabel(
                        regraSelecionada.alvo,
                        regraSelecionada.label,
                      )
                    : "Selecione uma regra"}
                </span>
              </p>
            </div>

            {(vinculosError || documentosError) && (
              <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[11px] text-red-700">
                {vinculosError || documentosError}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                type="search"
                value={documentoSearch}
                onChange={(event) => setDocumentoSearch(event.target.value)}
                placeholder="Buscar por tipo ou data..."
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400 md:max-w-sm"
              />
              {documentosVinculo.length >= 200 && (
                <span className="text-[11px] text-slate-400">
                  Mostrando ate 200 documentos.
                </span>
              )}
            </div>

            <div className="mt-4 max-h-[420px] overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50/40 p-2">
              {documentosLoading || vinculosLoading ? (
                <p className="py-6 text-center text-xs text-slate-500">
                  Carregando documentos...
                </p>
              ) : documentosFiltrados.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">
                  Nenhum documento encontrado.
                </p>
              ) : (
                <div className="space-y-2">
                  {documentosFiltrados.map((doc) => {
                    const isChecked =
                      vinculoRegraId &&
                      isDocumentoVinculado(doc.id, vinculoRegraId);
                    const servico =
                      typeof doc.dados?.tipo_laudo === "string"
                        ? doc.dados.tipo_laudo
                        : "";
                    const nomeArquivo = getDocumentoNome(doc);
                    return (
                      <label
                        key={doc.id}
                        className="flex items-start justify-between gap-3 rounded-xl bg-white px-3 py-2 text-xs text-slate-600 shadow-sm"
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={Boolean(isChecked)}
                            disabled={!vinculoRegraId}
                            onChange={(event) => {
                              if (!vinculoRegraId) {
                                return;
                              }
                              void handleToggleVinculo(
                                doc.id,
                                vinculoRegraId,
                                event.target.checked,
                              );
                            }}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                          />
                          <div>
                            <p className="font-semibold text-slate-700">
                              {nomeArquivo}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              Tipo: {doc.tipo}
                            </p>
                            {servico ? (
                              <p className="text-[11px] text-slate-500">
                                Serviço: {servico}
                              </p>
                            ) : null}
                            <p className="text-[11px] text-slate-400">
                              {new Date(doc.created_at).toLocaleDateString("pt-BR")}
                            </p>
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          {doc.id.slice(0, 8)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsVinculoOpen(false);
                  setVinculoRegraId(null);
                }}
                className="rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-500"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}








