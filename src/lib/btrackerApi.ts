export const BTRACKER_API = "https://api-prd.bemol.com.br/btracker/api";
export const BTRACKER_AUTH_URL = "https://btracker.bemol.com.br/api/usuarios/social/microsoft/";
export const BTRACKER_CLIENT_ID = "537930b3-59ac-42c8-9362-f85d0b1edba8";
export const BTRACKER_TENANT_ID = "f10f91e5-f905-48aa-8c4c-a68d0ae5f6ec";

export type BtrackerNfse = {
  id: number | null;
  numero: number | null;
  nroPedido: string | null;
  nroItemPedido: string | null;
  nroItemServico: string | null;
  quantidade: number;
  prestador: BtrackerPrestador | null;
  tomador: BtrackerPrestador | null;
  municipio: { id: number; codigo: number; nome: string; siglaEstado: string } | null;
  codigoVerificacao: string | null;
  emissao: string | null;
  vencimento: string | null;
  dataEntrada: string | null;
  discriminacao: string | null;
  itemListaServico: string | null;
  descricaoListaServico: string | null;
  servicos: Array<{ valorTotal: string | null }>;
  valorServicos: string | null;
  baseCalculo: string | null;
  aliquota: string | null;
  valorIss: string | null;
  valorIssRetido: string | null;
  valorInss: string | null;
  valorPis: string | null;
  valorCofins: string | null;
  valorCsll: string | null;
  valorIr: string | null;
  outrasRetencoes: string | null;
  totalRetencoes: string | null;
  valorLiquidoNfse: string | null;
  tipoPagamento: number | null;
  tipoNota: number | null;
  statusSolicitacao: number;
  statusNota: number;
  hashcodigo: string | null;
};

export type BtrackerPrestador = {
  id: number | null;
  razaoSocial: string | null;
  documento: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  inscricaoMunicipal: string | null;
  fone: string | null;
  uf: string | null;
  municipio: { id: number; codigo: number; nome: string; siglaEstado: string } | null;
  email: string | null;
  nomeFantasia: string | null;
  tipoDocumento: number | null;
  bloqueadoErp: boolean;
};

export type BtrackerTokens = {
  access: string;
  refresh: string;
};

function btrackerHeaders(jwt: string) {
  return {
    Authorization: `Bearer ${jwt}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "time-zone": "America/Manaus",
  };
}

export async function exchangeMicrosoftForBtrackerJwt(opts: {
  idToken: string;
  accessToken: string;
  name: string;
  email: string;
}): Promise<BtrackerTokens> {
  const [firstName, ...rest] = (opts.name ?? "").split(" ");
  const lastName = rest.join(" ");

  const body = {
    provider: "MICROSOFT",
    id: opts.idToken,
    authToken: opts.accessToken,
    name: opts.name,
    email: opts.email,
    idToken: opts.idToken,
    firstName,
    lastName,
  };

  const res = await fetch(BTRACKER_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`BTracker auth falhou (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<BtrackerTokens>;
}

export async function searchOpenNfsesByPrestador(
  cnpj: string,
  jwt: string,
): Promise<BtrackerNfse[]> {
  // strip punctuation for query
  const cnpjClean = cnpj.replace(/\D/g, "");
  const url = `${BTRACKER_API}/recebimento/nfses/?prestador_documento=${cnpjClean}&page_size=50`;

  const res = await fetch(url, { headers: btrackerHeaders(jwt) });
  if (!res.ok) return [];

  const data = (await res.json()) as { results?: BtrackerNfse[] };
  return data.results ?? [];
}

export async function extractPdfViaBtracker(
  fileBuffer: ArrayBuffer,
  fileName: string,
  jwt: string,
): Promise<BtrackerNfse> {
  const formData = new FormData();
  formData.append("arquivo", new Blob([fileBuffer]), fileName);

  const res = await fetch(`${BTRACKER_API}/nfses/extrair_pdf_nfse/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "time-zone": "America/Manaus",
    },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`BTracker extrair_pdf_nfse falhou (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<BtrackerNfse>;
}

type BtrackerMunicipio = { id: number; codigo: number; nome: string; siglaEstado: string };

async function resolveMunicipio(
  nome: string | null,
  uf: string | null,
  jwt: string,
): Promise<BtrackerMunicipio | null> {
  if (!nome || !uf) return null;
  const url = `${BTRACKER_API}/nfses/municipios/?nome=${encodeURIComponent(nome)}&sigla_estado=${encodeURIComponent(uf)}`;
  const res = await fetch(url, { headers: btrackerHeaders(jwt) });
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: BtrackerMunicipio[] };
  // exact match first, else first result
  const exact = data.results?.find(
    (m) => m.nome.toLowerCase() === nome.toLowerCase() && m.siglaEstado === uf,
  );
  return exact ?? data.results?.[0] ?? null;
}

type BtrackerServicoErp = { id: number; codigo: string; descricao: string };

async function resolveServicoErp(
  itemListaServico: string | null,
  jwt: string,
): Promise<BtrackerServicoErp | null> {
  if (!itemListaServico) return null;
  const url = `${BTRACKER_API}/integracao_erp/servico_nfse/?busca=${encodeURIComponent(itemListaServico)}`;
  const res = await fetch(url, { headers: btrackerHeaders(jwt) });
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: BtrackerServicoErp[] };
  const r = data.results?.[0];
  return r ? { id: r.id, codigo: r.codigo, descricao: r.descricao } : null;
}

export type SaveNfseInput = {
  numero: string | null;
  serie: string | null;
  codigoVerificacao: string | null;
  emissao: string | null; // YYYY-MM-DD
  vencimento: string | null; // YYYY-MM-DD
  municipioNome: string | null;
  uf: string | null;
  prestador: {
    razaoSocial: string | null;
    documento: string | null;
    municipioNome: string | null;
    uf: string | null;
    inscricaoMunicipal: string | null;
    cep: string | null;
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    fone: string | null;
  };
  tomador: {
    razaoSocial: string | null;
    documento: string | null;
    municipioNome: string | null;
    uf: string | null;
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
  };
  servico: {
    discriminacao: string | null;
    itemListaServico: string | null;
    valorServicos: number | null;
    baseCalculo: number | null;
    aliquota: number | null;
    valorIss: number | null;
    issRetido: boolean | null;
  };
  retencoes: {
    valorPis: number | null;
    valorCofins: number | null;
    valorCsll: number | null;
    valorIr: number | null;
    valorInss: number | null;
    outrasRetencoes: number | null;
    totalRetencoes: number | null;
  };
  valorLiquido: number | null;
  nroPedido: string | null;
  nroItemPedido: string | null;
  nroItemServico: string | null;
  tipoPagamento: number | null;
  justificativaVencimento?: string | null;
  justificativaLiberacao?: string | null;
};

const num = (v: number | null | undefined) => (v != null ? v.toFixed(2) : "0.00");
const today = () => new Date().toISOString().slice(0, 10);

export async function saveNfseToBtracker(
  input: SaveNfseInput,
  jwt: string,
): Promise<BtrackerNfse> {
  const [munNf, munPrest, munTom] = await Promise.all([
    resolveMunicipio(input.municipioNome, input.uf, jwt),
    resolveMunicipio(input.prestador.municipioNome, input.prestador.uf, jwt),
    resolveMunicipio(input.tomador.municipioNome, input.tomador.uf, jwt),
  ]);

  const servicoErp = await resolveServicoErp(input.servico.itemListaServico, jwt);

  const munObj = (m: BtrackerMunicipio | null) =>
    m
      ? { id: m.id, codigo: m.codigo, nome: m.nome, sigla_estado: m.siglaEstado }
      : null;

  const digits = (s: string | null) => (s ? s.replace(/\D/g, "").slice(0, 14) : null);
  const cepDigits = (s: string | null) => {
    const d = s ? s.replace(/\D/g, "").slice(0, 8) : "";
    return d.length === 8 ? d : null;
  };
  // servico.codigo não pode ser nulo; usa o código da lista de serviço ou um padrão
  const servicoCodigo =
    servicoErp?.codigo ?? input.servico.itemListaServico ?? "00.00";
  const servicoDescricao =
    servicoErp?.descricao ??
    input.servico.discriminacao ??
    input.servico.itemListaServico ??
    "Servico";

  // O backend do BTracker faz json.loads() nos campos compostos → enviar como STRING JSON.
  // municipio/prestador/tomador exigem id; servicos é um DICT único (não array);
  // iss_retido é choice (1=retido, 2=não retido); documento só dígitos.
  const payload = {
    numero: input.numero ? Number(input.numero) || input.numero : null,
    serie: input.serie,
    nro_pedido: input.nroPedido,
    nro_item_pedido: input.nroItemPedido,
    nro_item_servico: input.nroItemServico,
    quantidade: 1,
    codigo_verificacao: input.codigoVerificacao,
    emissao: input.emissao,
    vencimento: input.vencimento,
    data_entrada: today(),
    tipo_pagamento: input.tipoPagamento,
    municipio: JSON.stringify(munObj(munNf)),
    codigo_municipio: munNf?.codigo ?? null,
    prestador: JSON.stringify({
      id: null,
      razao_social: input.prestador.razaoSocial,
      documento: digits(input.prestador.documento),
      tipo_documento: 0,
      municipio: munObj(munPrest),
      inscricao_municipal: input.prestador.inscricaoMunicipal,
      cep: cepDigits(input.prestador.cep),
      logradouro: input.prestador.logradouro,
      numero: input.prestador.numero,
      complemento: input.prestador.complemento,
      bairro: input.prestador.bairro,
      fone: input.prestador.fone,
      uf: input.prestador.uf,
    }),
    tomador: JSON.stringify({
      id: null,
      razao_social: input.tomador.razaoSocial,
      documento: digits(input.tomador.documento),
      tipo_documento: 0,
      municipio: munObj(munTom),
      logradouro: input.tomador.logradouro,
      numero: input.tomador.numero,
      complemento: input.tomador.complemento,
      bairro: input.tomador.bairro,
      uf: input.tomador.uf,
    }),
    discriminacao: input.servico.discriminacao,
    item_lista_servico: input.servico.itemListaServico,
    servicos: JSON.stringify({
      servico: {
        id: servicoErp?.id ?? null,
        codigo: servicoCodigo,
        descricao: servicoDescricao,
      },
      quantidade: 1,
      valor_total: num(input.servico.valorServicos),
      valor_servicos: num(input.servico.valorServicos),
      texto_breve: (input.servico.discriminacao ?? servicoDescricao).slice(0, 60),
      nfse: null,
    }),
    valor_servicos: num(input.servico.valorServicos),
    // Obrigatórios numéricos — BTracker bloqueia se vierem nulos; default 0,00.
    desconto_incondicionado: "0.00",
    valor_deducoes: "0.00",
    base_calculo: num(input.servico.baseCalculo ?? input.servico.valorServicos),
    aliquota: input.servico.aliquota != null ? num(input.servico.aliquota) : "0.00",
    valor_iss: num(input.servico.valorIss),
    valor_iss_retido: "0.00",
    iss_retido: input.servico.issRetido ? 1 : 2,
    valor_pis: num(input.retencoes.valorPis),
    valor_cofins: num(input.retencoes.valorCofins),
    valor_csll: num(input.retencoes.valorCsll),
    valor_ir: num(input.retencoes.valorIr),
    valor_inss: num(input.retencoes.valorInss),
    outras_retencoes: num(input.retencoes.outrasRetencoes),
    total_retencoes: num(input.retencoes.totalRetencoes),
    valor_liquido_nfse: num(input.valorLiquido),
    ...(input.justificativaVencimento
      ? { justificativa_vencimento: input.justificativaVencimento }
      : {}),
    ...(input.justificativaLiberacao
      ? { justificativa_liberacao_bloqueio_solicitacao: input.justificativaLiberacao }
      : {}),
  };

  const res = await fetch(`${BTRACKER_API}/nfses/`, {
    method: "POST",
    headers: btrackerHeaders(jwt),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text.slice(0, 600);
    try {
      const j = JSON.parse(text) as { detalhes?: unknown; erro?: unknown; detail?: unknown };
      // 'detalhes' tem a mensagem específica; 'erro' costuma ser genérico ("Erro interno...")
      const isGeneric = (s: unknown) =>
        typeof s === "string" && /erro interno no servidor/i.test(s);
      const raw =
        j.detalhes ?? (isGeneric(j.erro) ? undefined : j.erro) ?? j.detail ?? j.erro;
      if (typeof raw === "string") {
        detail = raw;
      } else if (raw && typeof raw === "object") {
        // Achata mensagens de validação aninhadas (ex: justificativas)
        detail = Object.entries(raw as Record<string, unknown>)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : JSON.stringify(v)}`)
          .join(" | ");
      }
    } catch {
      /* keep raw */
    }
    throw new Error(detail);
  }

  return res.json() as Promise<BtrackerNfse>;
}
