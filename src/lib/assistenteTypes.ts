import type { AzureOpenAiTool } from "@/lib/azureOpenAi";
import type { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

export type AssistenteDominioId = "documentos" | "orcamentos" | "cobrancas";

export type AssistenteContext = {
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
  userId: string;
  email: string | null;
  isAdmin: boolean;
  currentContext?: { dominio: AssistenteDominioId; filtros: Record<string, unknown> };
  /** memo por turno para evitar recomputar acesso a cada tool_call */
  cache: Map<string, unknown>;
};

export type AssistenteInsightItem = {
  key: string;
  label: string;
  total: number;
  percentual: number;
};

export type AssistenteTrendItem = {
  key: string;
  label: string;
  total: number;
};

export type AssistenteInsightTotal = {
  key: string;
  label: string;
  valor: number;
};

export type AssistenteInsights = {
  totais: AssistenteInsightTotal[];
  isTruncated: boolean;
  porStatus: AssistenteInsightItem[];
  porLoja: AssistenteInsightItem[];
  tendenciaMensal: AssistenteTrendItem[];
  observacoes: string[];
};

export type AssistenteResultItem = {
  id: string;
  titulo: string;
  subtitulo: string;
  /** rota para abrir o item na tela do domínio, quando aplicável */
  url?: string | null;
  /** path de storage para abrir o arquivo assinado direto, quando aplicável */
  abrirArquivoPath?: string | null;
};

export type AssistenteSearchOutcome = {
  dominio: AssistenteDominioId;
  filters: Record<string, unknown>;
  filtrosUrl: string | null;
  summary: string;
  results: AssistenteResultItem[];
  total: number;
  insights: AssistenteInsights;
};

export type AssistenteToolResult = {
  content: string;
  outcome?: AssistenteSearchOutcome;
};

export type AssistenteDominio = {
  id: AssistenteDominioId;
  descricaoPrompt: (ctx: AssistenteContext) => string;
  tools: AzureOpenAiTool[];
  podeAcessar: (ctx: AssistenteContext) => Promise<boolean>;
  executarTool: (
    nome: string,
    args: Record<string, unknown>,
    ctx: AssistenteContext,
  ) => Promise<AssistenteToolResult>;
};

export const createEmptyAssistenteInsights = (): AssistenteInsights => ({
  totais: [],
  isTruncated: false,
  porStatus: [],
  porLoja: [],
  tendenciaMensal: [],
  observacoes: [],
});
