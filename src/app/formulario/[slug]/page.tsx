"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabaseClient";
import { Eye, FilePlus2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { usePrestadores } from "@/hooks/usePrestadores";

type FormField = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "date";
  placeholder?: string;
  options?: string[];
};

type FormConfig = {
  slug: string;
  tipo: string;
  title: string;
  description: string;
  fields: FormField[];
  defaultStatus?: string;
};

const FORM_CONFIGS: FormConfig[] = [
  {
    slug: "retencao-trabalhista",
    tipo: "retencao_trabalhista",
    title: "Retenção Trabalhista",
    description:
      "Informe os dados necessários para análise e controle de retenções trabalhistas.",
    defaultStatus: "em_analise",
    fields: [
      {
        name: "empresa",
        label: "Empresa",
        type: "text",
        placeholder: "Razão social ou nome fantasia",
      },
      {
        name: "cnpj",
        label: "CNPJ do emitente",
        type: "text",
        placeholder: "00.000.000/0000-00",
      },
      {
        name: "competencia",
        label: "Competência",
        type: "text",
        placeholder: "MM/AAAA",
      },
      {
        name: "observacoes",
        label: "Observações",
        type: "textarea",
        placeholder: "Detalhes adicionais sobre a retenção",
      },
    ],
  },
  {
    slug: "registro-laudos",
    tipo: "registro_laudos",
    title: "Registro e Laudos",
    description:
      "Envie laudos e registros técnicos para armazenamento e controle interno.",
    fields: [
      {
        name: "tipo_laudo",
        label: "Tipo de laudo",
        type: "text",
        placeholder: "Ex.: Laudo Técnico, PPRA, LTCAT, etc.",
        options: ["Corretiva", "Preventiva"],
      },
      {
        name: "prestador",
        label: "Prestador",
        type: "text",
        placeholder: "Nome do prestador responsável pelo documento",
      },
      {
        name: "responsavel",
        label: "Responsável",
        type: "text",
        placeholder: "Nome do responsável técnico",
      },
      {
        name: "data_emissao",
        label: "Data de emissão",
        type: "date",
      },
      {
        name: "observacoes",
        label: "Observações",
        type: "textarea",
        placeholder: "Informações adicionais importantes",
      },
    ],
  },
  {
    slug: "notas-fiscais",
    tipo: "notas_fiscais",
    title: "Notas Fiscais",
    description:
      "Cadastre e armazene notas fiscais emitidas para controle e auditoria.",
    defaultStatus: "em_analise",
    fields: [
      {
        name: "numero_pedido",
        label: "Número do pedido",
        type: "text",
        placeholder: "Ex.: 12345",
      },
      {
        name: "numero_nf",
        label: "Número da nota",
        type: "text",
        placeholder: "Número completo da nota fiscal",
      },
      {
        name: "cnpj_emitente",
        label: "CNPJ do emitente",
        type: "text",
        placeholder: "00.000.000/0000-00",
      },
      {
        name: "valor",
        label: "Valor",
        type: "number",
        placeholder: "0,00",
      },
      {
        name: "descricao",
        label: "Descrição / Histórico",
        type: "textarea",
        placeholder: "Descrição dos serviços/produtos",
      },
    ],
  },
];

const FORM_TIPO_ASSINAVEL = "registro_laudos";
const STORAGE_BUCKET = "formularios";
const SIGNED_URL_EXPIRES_IN = 60 * 30;

const tipoLabel: Record<string, string> = {
  retencao_trabalhista: "Retenção Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
};

type DocumentoHistorico = {
  id: string;
  tipo: string;
  status: string;
  arquivo_path?: string | null;
  arquivo_assinado_path?: string | null;
  created_at: string;
  prestador_id?: string | null;
  dados: Record<string, unknown> | null;
};

type FormValues = Record<string, string>;

type UploadedFileSummary = {
  path: string;
  name: string;
  type: string;
  size: number;
};

export default function FormularioPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading } = useAuth();

  const config = useMemo(
    () => FORM_CONFIGS.find((f) => f.slug === params.slug),
    [params.slug],
  );
  const enablePrestadorDropdown = config?.slug === "registro-laudos";
  const {
    prestadores: prestadoresDisponiveis,
    loading: prestadoresLoading,
  } = usePrestadores({
    assignedOnly: true,
    enabled: true,
  });
  const tipoServicoFiltro = searchParams.get("tipoServico") ?? "";

  const getInitialValues = useCallback((): FormValues => {
    if (!config) {
      return {};
    }
    const initial: FormValues = {};
    config.fields.forEach((field) => {
      let initialValue = "";
      if (
        config.slug === "registro-laudos" &&
        field.name === "tipo_laudo" &&
        tipoServicoFiltro
      ) {
        initialValue = tipoServicoFiltro;
      }
      initial[field.name] = initialValue;
    });
    return initial;
  }, [config, tipoServicoFiltro]);

  const [values, setValues] = useState<FormValues>({});
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formProgress, setFormProgress] = useState(0);
  const formProgressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [selectedPrestadorId, setSelectedPrestadorId] = useState<string>("");
  const [historico, setHistorico] = useState<DocumentoHistorico[]>([]);
  const [historicoLoading, setHistoricoLoading] = useState(true);
  const [historicoErro, setHistoricoErro] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (config) {
      setValues(getInitialValues());
      setSelectedPrestadorId("");
    }
  }, [config, getInitialValues]);

  const carregarHistorico = useCallback(async () => {
    if (!user) {
      return;
    }
    setHistoricoLoading(true);
    setHistoricoErro(null);
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
      if (prestadoresDisponiveis.length > 0) {
        prestadoresDisponiveis.forEach((prestador) => {
          params.append("prestadorId", prestador.id);
        });
      } else {
        params.set("userId", user.id);
      }
      const url =
        params.size > 0 ? `/api/documentos?${params.toString()}` : "/api/documentos";
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as {
        registros?: DocumentoHistorico[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.error ?? "Não foi possível carregar o histórico de envios.",
        );
      }
      setHistorico(payload.registros ?? []);
    } catch (err) {
      console.error("Erro ao carregar histórico:", err);
      setHistoricoErro(
        err instanceof Error
          ? err.message
          : "Não foi possível carregar o histórico.",
      );
    } finally {
      setHistoricoLoading(false);
    }
  }, [prestadoresDisponiveis, user]);

  useEffect(() => {
    if (user && !prestadoresLoading) {
      void carregarHistorico();
    }
  }, [user, prestadoresLoading, carregarHistorico]);

  useEffect(() => {
    return () => {
      if (formProgressTimer.current) {
        clearInterval(formProgressTimer.current);
      }
    };
  }, []);

  if (!config) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-sm text-slate-300">
        <p>Formulário não encontrado.</p>
      </div>
    );
  }

  if (authLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando formulário...
      </div>
    );
  }

  const handleChange = (name: string, value: string) => {
    setValues((prev) => {
      const updated = { ...prev, [name]: value };
      if (config.slug === "notas-fiscais" && name === "numero_pedido") {
        updated.numero_nf = value;
      }
      return updated;
    });
  };

  const handlePrestadorSelection = (prestadorId: string) => {
    setSelectedPrestadorId(prestadorId);
    if (!prestadorId) {
      handleChange("prestador", "");
      return;
    }
    const prestador = prestadoresDisponiveis.find(
      (item) => item.id === prestadorId,
    );
    handleChange("prestador", prestador?.nome ?? "");
  };

  const beginFormProgress = () => {
    if (formProgressTimer.current) {
      clearInterval(formProgressTimer.current);
    }
    setFormProgress(10);
    formProgressTimer.current = setInterval(() => {
      setFormProgress((prev) => (prev < 85 ? prev + 5 : prev));
    }, 400);
  };

  const completeFormProgress = () => {
    if (formProgressTimer.current) {
      clearInterval(formProgressTimer.current);
      formProgressTimer.current = null;
    }
    setFormProgress(100);
    setTimeout(() => setFormProgress(0), 700);
  };

  const statusLabelMap: Record<string, string> = {
    pendente: "Pendente",
    em_analise: "Em análise",
    assinado: "Assinado",
  };

  const historicoRecentes = useMemo(
    () => historico.slice(0, 5),
    [historico],
  );

  const formatStatus = (status: string) =>
    statusLabelMap[status] ?? status.replace(/_/g, " ");

  const formatTipo = (tipo: string) => tipoLabel[tipo] ?? tipo;

  const formatData = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "--";
    }
    return date.toLocaleString("pt-BR");
  };

  const resolveSignedPdfPath = (path?: string | null) => {
    if (!path) {
      return null;
    }
    if (path.endsWith("-view.html")) {
      return path.replace(/-view\.html$/, ".pdf");
    }
    if (path.endsWith(".html")) {
      return path.replace(/\.html$/, ".pdf");
    }
    return path;
  };

  const getSignedFileUrl = async (path: string) => {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_EXPIRES_IN);

    if (error || !data?.signedUrl) {
      throw error ?? new Error("Não foi possível gerar o link do arquivo.");
    }
    return data.signedUrl;
  };

  const abrirDocumento = async (registro: DocumentoHistorico) => {
    const path =
      resolveSignedPdfPath(registro.arquivo_assinado_path) ??
      registro.arquivo_assinado_path ??
      registro.arquivo_path;

    if (!path) {
      setError("Arquivo indisponível no momento.");
      return;
    }

    try {
      const signedUrl = await getSignedFileUrl(path);
      const anchor = document.createElement("a");
      anchor.href = signedUrl;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (err) {
      console.error("Erro ao abrir documento:", err);
      setError("Não foi possível abrir o documento. Tente novamente.");
    }
  };

  const resetFormProgress = () => {
    if (formProgressTimer.current) {
      clearInterval(formProgressTimer.current);
      formProgressTimer.current = null;
    }
    setFormProgress(0);
  };

  const salvarDocumentosSeparados = async (
    arquivos: UploadedFileSummary[],
    valoresFormulario: FormValues,
    usuarioId: string,
    tipoFormulario: string,
    statusPadrao: string,
    prestadorId?: string | null,
  ) => {
    for (const arquivo of arquivos) {
      const payloadDados: Record<string, unknown> = {
        ...valoresFormulario,
        anexos: [
          {
            nome: arquivo.name,
            path: arquivo.path,
            tipo: arquivo.type,
            tamanho: arquivo.size,
          },
        ],
      };

      const payload = {
        user_id: usuarioId,
        tipo: tipoFormulario,
        dados: payloadDados,
        arquivo_path: arquivo.path,
        status: statusPadrao,
        prestador_id: prestadorId ?? null,
      };

      const { error } = await supabase.from("formularios").insert(payload);
      if (error) {
        throw error;
      }
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      if (files.length === 0) {
        setError("Selecione ao menos um arquivo para enviar.");
        return;
      }

      if (!user) {
        setError("Sessão expirada. Faça login novamente.");
        router.push("/login");
        return;
      }

      beginFormProgress();

      const uploadResults: UploadedFileSummary[] = [];
      for (const [index, currentFile] of files.entries()) {
        const ext = currentFile.name.split(".").pop() ?? "bin";
        const uniqueSuffix = `${Date.now()}-${index}`;
        const filePath = `${user.id}/${config.tipo}/${uniqueSuffix}.${ext}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("formularios")
          .upload(filePath, currentFile);

        if (uploadError || !uploadData) {
          resetFormProgress();
          setError(
            uploadError?.message ||
              "Erro ao fazer upload de um dos arquivos para o Storage.",
          );
          return;
        }

        uploadResults.push({
          path: uploadData.path ?? filePath,
          name: currentFile.name,
          type: currentFile.type,
          size: currentFile.size,
        });
      }

      if (uploadResults.length === 0) {
        resetFormProgress();
        setError("Nenhum arquivo foi processado. Tente novamente.");
        return;
      }

      const valoresAtuais = { ...values };
      const statusPadrao =
        config.defaultStatus ??
        (config.tipo === FORM_TIPO_ASSINAVEL ? "pendente" : "em_analise");
      const prestadorIdParaSalvar =
        enablePrestadorDropdown && selectedPrestadorId
          ? selectedPrestadorId
          : null;
      await salvarDocumentosSeparados(
        uploadResults,
        valoresAtuais,
        user.id,
        config.tipo,
        statusPadrao,
        prestadorIdParaSalvar,
      );

      setSuccess(
        uploadResults.length > 1
          ? `${uploadResults.length} documentos enviados separadamente!`
          : "Formulário enviado com sucesso!",
      );
      completeFormProgress();
      setFiles([]);
      setValues(getInitialValues());
      setSelectedPrestadorId("");
    } catch (err) {
      console.error("Erro ao enviar formulário:", err);
      resetFormProgress();
      setError("Não foi possível enviar o formulário. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <div>
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-3 text-xs text-slate-500 hover:text-sky-600"
        >
          Voltar
        </button>
        <div className="flex items-center gap-2">
          <FilePlus2 className="h-5 w-5 text-slate-700" />
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            {config.title}
          </h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">{config.description}</p>
      </div>

      {formProgress > 0 && (
        <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 text-xs text-slate-600 shadow-sm shadow-sky-100">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-600">
              Enviando formulário
            </p>
            <span className="text-[11px] font-semibold text-sky-700">
              {Math.min(formProgress, 100).toFixed(0)}%
            </span>
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-white">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-sky-400 via-emerald-400 to-sky-400 transition-all"
              style={{ width: `${Math.min(formProgress, 100)}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Estamos carregando o arquivo e registrando os dados no Supabase.
          </p>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200"
      >
        <div className="grid gap-4 md:grid-cols-2">
          {config.fields.map((field) => (
            <div key={field.name} className="space-y-1.5 text-sm">
              <label
                htmlFor={field.name}
                className="block text-xs font-medium uppercase tracking-wide text-slate-600"
              >
                {field.label}
              </label>
              {enablePrestadorDropdown && field.name === "prestador" ? (
                <select
                  id={field.name}
                  required
                  value={selectedPrestadorId}
                  onChange={(e) => handlePrestadorSelection(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500/40 placeholder:text-slate-400 focus:border-sky-500 focus:ring"
                  disabled={prestadoresLoading || prestadoresDisponiveis.length === 0}
                >
                  <option value="">
                    {prestadoresLoading
                      ? "Carregando prestadores..."
                      : prestadoresDisponiveis.length === 0
                        ? "Nenhum prestador disponível"
                        : "Selecione um prestador"}
                  </option>
                  {prestadoresDisponiveis.map((prestador) => (
                    <option key={prestador.id} value={prestador.id}>
                      {prestador.nome} - {prestador.tipo_servico}
                    </option>
                  ))}
                </select>
              ) : field.type === "textarea" ? (
                <textarea
                  id={field.name}
                  required={
                    field.name !== "observacoes" && field.name !== "descricao"
                  }
                  value={values[field.name] ?? ""}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  className="min-h-[96px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500/40 placeholder:text-slate-400 focus:border-sky-500 focus:ring"
                />
              ) : (
                <input
                  id={field.name}
                  type={field.type}
                  required
                  value={values[field.name] ?? ""}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  list={field.options ? `${field.name}-options` : undefined}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500/40 placeholder:text-slate-400 focus:border-sky-500 focus:ring"
                />
              )}
              {field.options && (
                <datalist id={`${field.name}-options`}>
                  {field.options.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              )}
              {enablePrestadorDropdown && field.name === "prestador" && (
                <p className="text-[11px] text-slate-500">
                  {prestadoresLoading
                    ? "Buscando prestadores vinculados ao seu usuário..."
                    : prestadoresDisponiveis.length === 0
                      ? "Nenhum prestador foi associado à sua conta. Peça ao administrador para adicionar seu e-mail ao grupo correto."
                      : "Escolha um prestador cadastrado pelo administrador para vincular o envio."}
                </p>
              )}
            </div>
          ))}
        </div>

      <div className="mt-2 space-y-2 text-sm">
        <label
          htmlFor="arquivo"
          className="block text-xs font-medium uppercase tracking-wide text-slate-600"
        >
            Arquivos (PDF, PNG ou JPEG)
          </label>
          <input
            id="arquivo"
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            required
            multiple
            onChange={(e) => {
              const selectedFiles = e.target.files
                ? Array.from(e.target.files)
                : [];
              setFiles(selectedFiles);
            }}
            className="block w-full cursor-pointer rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-sky-500 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:border-sky-500"
          />
          <p className="text-[11px] text-slate-500">
            Png, Jpeg ou PDF
          </p>
        </div>

        {error && (
          <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
        {success && (
          <p className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
            {success}
          </p>
        )}

        <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <p className="text-[11px] text-slate-500">
            
            
            
            
      
          </p>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-sky-300/70 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? "Enviando..." : "Enviar formulário"}
          </button>
        </div>
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white/80 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Histórico de envios
            </p>
            <span className="text-[11px] text-slate-500">
              Consulte rapidamente os formulários enviados pelo seu grupo.
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            Mostrando {historicoRecentes.length} de {historico.length} registros
          </span>
        </div>

        {historicoLoading ? (
          <p className="mt-4 text-xs text-slate-500">
            Carregando histórico de envios...
          </p>
        ) : historicoErro ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {historicoErro}
          </p>
        ) : historicoRecentes.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">
            Ainda não há envios registrados para o seu acesso.
          </p>
        ) : (
          <ul className="mt-4 space-y-3 text-xs text-slate-600">
            {historicoRecentes.map((registro) => {
              const pathParaVisualizar =
                resolveSignedPdfPath(registro.arquivo_assinado_path) ??
                registro.arquivo_assinado_path ??
                registro.arquivo_path;
              const podeVisualizar = Boolean(pathParaVisualizar);

              return (
                <li
                  key={registro.id}
                  className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {formatTipo(registro.tipo)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Enviado em {formatData(registro.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void abrirDocumento(registro)}
                        disabled={!podeVisualizar}
                        className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white p-1.5 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Visualizar documento"
                        aria-label="Visualizar documento"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                          registro.status === "assinado"
                            ? "bg-emerald-50 text-emerald-700"
                            : registro.status === "em_analise"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {formatStatus(registro.status)}
                      </span>
                    </div>
                  </div>
                  {registro.dados &&
                    typeof registro.dados.numero_pedido === "string" && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Pedido: {registro.dados.numero_pedido as string}
                    </p>
                    )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

