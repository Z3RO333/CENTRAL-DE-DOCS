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

export async function saveNfseToBtracker(
  payload: Partial<BtrackerNfse>,
  jwt: string,
): Promise<BtrackerNfse> {
  // Try the list create endpoint first
  const res = await fetch(`${BTRACKER_API}/recebimento/nfses/`, {
    method: "POST",
    headers: btrackerHeaders(jwt),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`BTracker save falhou (${res.status}): ${text.slice(0, 400)}`);
  }

  return res.json() as Promise<BtrackerNfse>;
}
