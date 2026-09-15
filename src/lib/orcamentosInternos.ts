import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  ApiHttpError as HttpError,
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
  type Actor,
} from "@/lib/apiAuth";
import { logDocumentoAuditEvent } from "@/lib/documentosAudit";
import { fixMojibakeText } from "@/lib/textEncoding";
import {
  ORCAMENTO_INTERNO_STATUSES,
  type OrcamentoInternoStatus,
} from "@/lib/orcamentosInternosShared";
export {
  ORCAMENTO_INTERNO_STATUSES,
  TIPO_ORCAMENTO_INTERNO,
  type OrcamentoInternoStatus,
} from "@/lib/orcamentosInternosShared";

export type OrcamentoInternoAction =
  | "salvar_rascunho"
  | "enviar_aprovacao"
  | "solicitar_ajuste"
  | "reenviar"
  | "aprovar_assinar"
  | "rejeitar"
  | "devolver_sem_decisao"
  | "cancelar"
  | "corrigir_metadados"
  | "registrar_numero_pedido"
  | "substituir_pdf_assinado";

export type OrcamentoInternoArquivoInput = {
  path?: string;
  name?: string;
  type?: string;
  size?: number;
  principal?: boolean;
};

export type OrcamentoInternoInput = {
  solicitanteId?: string | null;
  lojaId?: string | null;
  areaSolicitante?: string;
  prestadorId?: string | null;
  prestadorNome?: string;
  fornecedorCnpj?: string | null;
  numeroOrcamento?: string;
  descricao?: string;
  valorTotal?: string | number | null;
  dataValidade?: string | null;
  numeroReferencia?: string | null;
  numeroPedido?: string | null;
  gestorId?: string | null;
  gestorEmail?: string | null;
  gestorNome?: string | null;
  aprovadoresEmails?: string[] | null;
  observacoes?: string | null;
  arquivos?: OrcamentoInternoArquivoInput[];
};

export type OrcamentoInternoRow = {
  id: string;
  solicitante_id: string;
  solicitante_email: string | null;
  loja_id: string | null;
  loja_nome: string | null;
  area_solicitante: string;
  prestador_id: string | null;
  prestador_nome: string;
  fornecedor_cnpj: string | null;
  numero_orcamento: string;
  descricao: string;
  valor_total: number | string | null;
  data_validade: string | null;
  numero_referencia: string | null;
  numero_pedido: string | null;
  gestor_id: string | null;
  gestor_email: string;
  gestor_nome: string | null;
  aprovadores_emails: string[] | null;
  pre_aprovado_por: string | null;
  pre_aprovado_email: string | null;
  pre_aprovado_nome: string | null;
  pre_aprovado_em: string | null;
  observacoes: string | null;
  arquivo_original_path: string;
  arquivo_assinado_path: string | null;
  status: OrcamentoInternoStatus;
  versao_atual: number;
  enviado_em: string | null;
  aprovado_em: string | null;
  rejeitado_em: string | null;
  cancelado_em: string | null;
  ultima_justificativa: string | null;
  created_at: string;
  updated_at: string;
};

export type OrcamentoInternoVersaoRow = {
  id: string;
  orcamento_id: string;
  versao: number;
  arquivo_path: string;
  nome_arquivo: string;
  mime_type: string | null;
  tamanho_bytes: number | null;
  principal: boolean;
  criado_por: string | null;
  criado_por_email: string | null;
  arquivo_assinado_path: string | null;
  created_at: string;
};

export const STATUS_LABEL: Record<OrcamentoInternoStatus, string> = {
  rascunho: "Rascunho",
  aguardando_aprovacao: "Aguardando aprovação",
  em_analise_gestor: "Aguardando aprovação final",
  ajuste_solicitado: "Ajuste solicitado",
  reenviado: "Reenviado",
  aprovado_assinado: "Aprovado e assinado",
  rejeitado: "Rejeitado",
  cancelado: "Cancelado",
};

export const DECISAO_STATUS = new Set<OrcamentoInternoStatus>([
  "aguardando_aprovacao",
  "em_analise_gestor",
  "reenviado",
]);

/**
 * Estrategia de liberacao por faixa de valor: ate este limite, o grupo
 * "padrao" (Walter/Luciana) aprova diretamente. A partir daqui, o grupo
 * "padrao" so pre-aprova e a decisao final fica com o grupo "alta"
 * (Daniel/Flavio). Valor nao informado e tratado como faixa alta (mais
 * criteriosa) por seguranca.
 */
export const FAIXA_ALTA_MINIMO = 15000.01;

export type GrupoAprovador = "padrao" | "alta";

export type AprovadorConfig = {
  email: string;
  nome: string | null;
  grupo: GrupoAprovador;
};

export type EtapaAprovacaoOrcamento = {
  grupo: GrupoAprovador;
  /** false = decisao de "aprovar" aqui e uma pre-aprovacao, nao finaliza. */
  finalizaAprovacao: boolean;
};

/**
 * Resolve quem deve decidir um orcamento agora e se a decisao de aprovar
 * finaliza (assina) ou e apenas uma pre-aprovacao que cai para o proximo
 * grupo.
 */
export function resolverEtapaAprovacao(
  row: Pick<OrcamentoInternoRow, "valor_total" | "pre_aprovado_por">,
): EtapaAprovacaoOrcamento {
  const valor =
    typeof row.valor_total === "number"
      ? row.valor_total
      : row.valor_total !== null
        ? Number(row.valor_total)
        : null;
  const isFaixaAlta = valor === null || !Number.isFinite(valor) || valor >= FAIXA_ALTA_MINIMO;

  if (!isFaixaAlta) {
    return { grupo: "padrao", finalizaAprovacao: true };
  }
  if (!row.pre_aprovado_por) {
    return { grupo: "padrao", finalizaAprovacao: false };
  }
  return { grupo: "alta", finalizaAprovacao: true };
}

export function normalizeEmail(value: string | null | undefined) {
  return value?.toLowerCase().trim() || null;
}

export function normalizeText(value: unknown) {
  return typeof value === "string" ? fixMojibakeText(value.trim()) : "";
}

export function parseValorTotal(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const normalized = value
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateStatus(status: string): OrcamentoInternoStatus {
  if ((ORCAMENTO_INTERNO_STATUSES as readonly string[]).includes(status)) {
    return status as OrcamentoInternoStatus;
  }
  throw new HttpError(400, "Status de orçamento inválido.");
}

export function getArquivoPrincipal(files: OrcamentoInternoArquivoInput[]) {
  const validFiles = files.filter((file) => file.path?.trim());
  if (validFiles.length === 0) {
    return null;
  }
  return (
    validFiles.find((file) => file.principal) ??
    validFiles.find((file) => file.type === "application/pdf") ??
    validFiles[0]
  );
}

export function validateOrcamentoInput(
  input: OrcamentoInternoInput,
  mode: "draft" | "submit",
) {
  const arquivos = input.arquivos ?? [];
  const principal = getArquivoPrincipal(arquivos);

  if (mode === "draft") {
    if (!principal?.path) {
      throw new HttpError(400, "Anexe ao menos o orçamento principal.");
    }
    return;
  }

  const required: Array<[unknown, string]> = [
    [principal?.path, "Anexe o orçamento principal em PDF."],
    [input.prestadorNome, "Confirme o fornecedor identificado no orçamento."],
  ];

  const missing = required.find(([value]) => {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return value.trim().length === 0;
    return false;
  });
  if (missing) {
    throw new HttpError(400, missing[1]);
  }

  if (!principal?.name?.toLowerCase().endsWith(".pdf")) {
    throw new HttpError(400, "O orçamento principal deve ser um PDF.");
  }
}

export async function assertInternalActor(input: {
  actor: Actor;
  supabaseAdmin?: ReturnType<typeof createSupabaseAdminClient>;
}) {
  const supabaseAdmin = input.supabaseAdmin ?? createSupabaseAdminClient();
  const email = input.actor.email;
  const [prestadores, gerenteEntries] = await Promise.all([
    getAuthorizedPrestadorIds(email, supabaseAdmin),
    getGerenteAccessEntries(input.actor.userId, email, supabaseAdmin),
  ]);

  if (input.actor.isAdmin || gerenteEntries.length > 0) {
    return { isFornecedorExterno: false, gerenteEntries };
  }

  if (prestadores.length > 0) {
    throw new HttpError(
      403,
      "Orçamentos internos são restritos a colaboradores internos.",
    );
  }

  return { isFornecedorExterno: false, gerenteEntries };
}

export async function getAprovadorEmails(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
) {
  const { data, error } = await supabaseAdmin
    .from("orcamentos_internos_aprovadores")
    .select("email");
  if (error) throw error;
  const emails = (data ?? [])
    .map((row) => normalizeEmail(row.email as string | null))
    .filter((email): email is string => Boolean(email));
  return new Set(emails);
}

export async function getAprovadoresPorGrupo(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<Record<GrupoAprovador, AprovadorConfig[]>> {
  const { data, error } = await supabaseAdmin
    .from("orcamentos_internos_aprovadores")
    .select("email,nome,grupo");
  if (error) throw error;

  const result: Record<GrupoAprovador, AprovadorConfig[]> = { padrao: [], alta: [] };
  for (const row of data ?? []) {
    const email = normalizeEmail(row.email as string | null);
    if (!email) continue;
    const grupo: GrupoAprovador = row.grupo === "alta" ? "alta" : "padrao";
    result[grupo].push({ email, nome: (row.nome as string | null) ?? null, grupo });
  }
  return result;
}

export function emailsDoGrupo(
  aprovadoresPorGrupo: Record<GrupoAprovador, AprovadorConfig[]>,
  grupo: GrupoAprovador,
): Set<string> {
  return new Set(aprovadoresPorGrupo[grupo].map((a) => a.email));
}

export async function isAprovadorInterno(
  email: string | null,
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }
  const aprovadores = await getAprovadorEmails(supabaseAdmin);
  return aprovadores.has(normalized);
}

export function canViewOrcamento(
  row: OrcamentoInternoRow,
  actor: Actor,
  aprovadores: Set<string>,
) {
  const actorEmail = normalizeEmail(actor.email);
  const gestorEmail = normalizeEmail(row.gestor_email);
  return (
    actor.isAdmin ||
    row.solicitante_id === actor.userId ||
    row.gestor_id === actor.userId ||
    (actorEmail !== null && actorEmail === gestorEmail) ||
    (actorEmail !== null && aprovadores.has(actorEmail))
  );
}

export function assertCanViewOrcamento(
  row: OrcamentoInternoRow,
  actor: Actor,
  aprovadores: Set<string>,
) {
  if (!canViewOrcamento(row, actor, aprovadores)) {
    throw new HttpError(404, "Orçamento interno não encontrado.");
  }
}

export function assertCanEditAsSolicitante(
  row: OrcamentoInternoRow,
  actor: Actor,
) {
  if (row.solicitante_id !== actor.realUserId && !actor.isAdmin) {
    throw new HttpError(403, "Somente o solicitante pode editar este orçamento.");
  }
  if (!["rascunho", "ajuste_solicitado"].includes(row.status)) {
    throw new HttpError(
      400,
      "Este orçamento não pode mais ter o original alterado.",
    );
  }
}

/**
 * `aprovadores` deve ser o conjunto de e-mails elegiveis para a etapa atual
 * do orcamento (ver `resolverEtapaAprovacao`) — não a lista completa de
 * aprovadores cadastrados. `aprovadores_emails` do registro não restringe
 * mais quem pode decidir (a faixa de valor já define isso); ele só narra
 * quem o solicitante prefere notificar.
 */
export function assertCanDecide(
  row: OrcamentoInternoRow,
  actor: Actor,
  aprovadores: Set<string>,
) {
  const actorEmail = normalizeEmail(actor.realEmail);
  const isAprovador = actorEmail !== null && aprovadores.has(actorEmail);
  if (!isAprovador) {
    throw new HttpError(
      403,
      "Somente um aprovador do grupo responsável por esta etapa pode decidir este orçamento.",
    );
  }
  if (row.solicitante_id === actor.realUserId) {
    throw new HttpError(
      403,
      "Você não pode decidir um orçamento que você mesmo enviou.",
    );
  }
  if (!DECISAO_STATUS.has(row.status)) {
    throw new HttpError(400, "Este orçamento não está aguardando decisão.");
  }
}

export function canDecideOrcamento(
  row: OrcamentoInternoRow,
  actor: Actor,
  aprovadores: Set<string>,
) {
  try {
    assertCanDecide(row, actor, aprovadores);
    return true;
  } catch {
    return false;
  }
}

export function resolveAprovadoresSelecionados(
  value: unknown,
  aprovadores: Set<string>,
  solicitanteEmail?: string | null,
): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new HttpError(400, "Seleção de gestores inválida.");
  }

  const selecionados = [
    ...new Set(
      value
        .map((email) =>
          typeof email === "string" ? normalizeEmail(email) : null,
        )
        .filter((email): email is string => Boolean(email)),
    ),
  ];
  if (selecionados.length === 0) {
    throw new HttpError(400, "Selecione ao menos um gestor ou envie para todos.");
  }
  if (selecionados.some((email) => !aprovadores.has(email))) {
    throw new HttpError(
      400,
      "Um dos gestores selecionados não é um aprovador válido.",
    );
  }

  const solicitante = normalizeEmail(solicitanteEmail);
  if (solicitante && selecionados.every((email) => email === solicitante)) {
    throw new HttpError(400, "Selecione um gestor diferente do solicitante.");
  }
  return selecionados;
}

export function assertCanManageSignedOrcamento(
  row: OrcamentoInternoRow,
  actor: Actor,
) {
  if (!actor.realIsAdmin) {
    throw new HttpError(
      403,
      "Somente administradores podem alterar um orçamento já assinado.",
    );
  }
  if (row.status !== "aprovado_assinado") {
    throw new HttpError(
      400,
      "Esta ação só está disponível depois que o orçamento for aprovado e assinado.",
    );
  }
}

export async function resolveLojaNome(
  lojaId: string | null,
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
) {
  if (!lojaId) return null;
  const { data, error } = await supabaseAdmin
    .from("lojas")
    .select("id,nome,codigo")
    .eq("id", lojaId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new HttpError(404, "Loja não encontrada.");
  }
  const nome = normalizeText(data.nome);
  return data.codigo ? `${nome} - ${data.codigo}` : nome;
}

export async function resolvePrestadorNome(
  input: { prestadorId?: string | null; prestadorNome?: string | null },
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
) {
  if (!input.prestadorId) {
    return normalizeText(input.prestadorNome);
  }
  const { data, error } = await supabaseAdmin
    .from("prestadores")
    .select("id,nome")
    .eq("id", input.prestadorId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new HttpError(404, "Prestador não encontrado.");
  }
  return normalizeText(data.nome);
}

export async function logOrcamentoEvent(input: {
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
  documentoId: string;
  eventType: string;
  actorId?: string | null;
  actorEmail?: string | null;
  from?: string | null;
  to?: string | null;
  justificativa?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await logDocumentoAuditEvent({
    supabaseAdmin: input.supabaseAdmin,
    documentoId: input.documentoId,
    eventType: input.eventType,
    actorId: input.actorId ?? null,
    actorEmail: input.actorEmail ?? null,
    metadata: {
      ...(input.from !== undefined ? { from: input.from } : {}),
      ...(input.to !== undefined ? { to: input.to } : {}),
      ...(input.justificativa ? { justificativa: input.justificativa } : {}),
      ...(input.metadata ?? {}),
    },
  });
}
