"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  XCircle,
} from "lucide-react";
import type { NfseExtracted, NfseField, NfseRisco, NfseStatus } from "@/lib/nfseExtractor";
import type { BtrackerNfse, SaveNfseInput } from "@/lib/btrackerApi";

type Props = {
  data: NfseExtracted;
  btrackerConnected: boolean;
  matchedPedido: BtrackerNfse | null;
  fileName: string;
  initialNroPedido?: string | null;
  initialNumeroNf?: string | null;
  documentoId?: string;
  accessToken?: string;
  onReset: () => void;
};

// Valores conforme o dropdown nativo do BTracker (índice = valor da API)
const TIPO_PAGAMENTO_OPTIONS = [
  { value: 0, label: "BOLETO" },
  { value: 1, label: "DEPÓSITO" },
];

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ConfidenceBadge({ conf, source }: { conf: number; source: NfseField<unknown>["source"] }) {
  if (source === "xml") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
        <CheckCircle2 className="h-2.5 w-2.5" /> XML
      </span>
    );
  }
  if (source === "calculated") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
        calculado
      </span>
    );
  }
  const pct = Math.round(conf * 100);
  const cls =
    pct >= 90
      ? "bg-green-100 text-green-700"
      : pct >= 70
        ? "bg-amber-100 text-amber-700"
        : "bg-red-100 text-red-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {pct}%
    </span>
  );
}

function FieldRow<T>({
  label,
  f,
  display,
}: {
  label: string;
  f: NfseField<T>;
  display?: (v: T) => string;
}) {
  const val = display ? display(f.value) : String(f.value ?? "—");
  const isEmpty = f.value == null || val === "—";
  return (
    <div className="flex items-start justify-between gap-2 border-b border-slate-50 py-1.5 last:border-0">
      <span className="min-w-0 shrink text-[11px] text-slate-500">{label}</span>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`text-right text-xs font-medium ${isEmpty ? "text-slate-300" : "text-slate-800"}`}>
          {isEmpty ? "não encontrado" : val}
        </span>
        {!isEmpty && <ConfidenceBadge conf={f.confidence} source={f.source} />}
      </div>
    </div>
  );
}

export function NfseReview({
  data,
  btrackerConnected,
  matchedPedido,
  fileName,
  initialNroPedido,
  initialNumeroNf,
  documentoId,
  accessToken,
  onReset,
}: Props) {
  const [openSection, setOpenSection] = useState<string | null>("geral");
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<"ok" | "error" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Prioridade do pedido: o que veio do documento (preenchido pelo prestador) > match do BTracker
  const [nroPedido, setNroPedido] = useState(
    initialNroPedido ?? matchedPedido?.nroPedido ?? "",
  );
  const [nroItemPedido, setNroItemPedido] = useState(matchedPedido?.nroItemPedido ?? "");
  const [nroItemServico, setNroItemServico] = useState(matchedPedido?.nroItemServico ?? "");
  const [tipoPagamento, setTipoPagamento] = useState<number | "">(
    matchedPedido?.tipoPagamento ?? "",
  );
  const [justVencimento, setJustVencimento] = useState("");
  const [justLiberacao, setJustLiberacao] = useState("");

  function toggleSection(s: string) {
    setOpenSection((prev) => (prev === s ? null : s));
  }

  async function handleSubmit() {
    if (!btrackerConnected) return;
    if (tipoPagamento === "") {
      setSubmitError("Selecione o Tipo de Pagamento antes de enviar.");
      setSubmitResult("error");
      setOpenSection("pedido");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = buildBtrackerPayload(data, nroPedido, nroItemPedido, nroItemServico);
      if (!payload.numero && initialNumeroNf) payload.numero = initialNumeroNf;
      payload.tipoPagamento = tipoPagamento;
      payload.justificativaVencimento = justVencimento.trim() || null;
      payload.justificativaLiberacao = justLiberacao.trim() || null;
      const res = await fetch("/api/btracker/nfse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ input: payload, documentoId }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Status ${res.status}`);
      setSubmitResult("ok");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Erro ao enviar");
      setSubmitResult("error");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitResult === "ok") {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <CheckCircle2 className="h-12 w-12 text-green-500" />
        <p className="text-lg font-semibold text-slate-800">NFS-e enviada ao BTracker!</p>
        <p className="text-sm text-slate-500">Arquivo: {fileName}</p>
        <div className="flex gap-2">
          <a
            href="https://btracker.bemol.com.br/notas/recebimento"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Ver no BTracker
          </a>
          <button
            type="button"
            onClick={onReset}
            className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Nova NFS-e
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            NFS-e {data.numero.value ?? "—"} — {data.emitente.razaoSocial.value ?? "Prestador desconhecido"}
          </p>
          <p className="text-xs text-slate-500">
            Arquivo: {fileName} ·{" "}
            <span className={data.numero.source === "xml" ? "text-green-600" : "text-sky-600"}>
              {data.numero.source === "xml" ? "lido do XML" : "extraído via OCR + IA"}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
        >
          Trocar arquivo
        </button>
      </div>

      {/* Status de Conferência */}
      <StatusBanner status={data.statusConferencia.value} risco={data.risco.value} />

      {/* Alerta ZFM */}
      {data.alertaZmf.value && (
        <div className={`rounded-xl px-4 py-3 text-xs ${
          data.alertaZmf.value.includes("inconsistência")
            ? "border border-red-200 bg-red-50 text-red-800"
            : "border border-emerald-200 bg-emerald-50 text-emerald-800"
        }`}>
          <p className="mb-1 flex items-center gap-1.5 font-semibold">
            {data.alertaZmf.value.includes("inconsistência") ? (
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            )}
            PIS/COFINS — Bemol / Zona Franca de Manaus
          </p>
          <p className="leading-5">{data.alertaZmf.value}</p>
        </div>
      )}

      {/* Alertas gerais */}
      {data.alertas.length > 0 && (
        <div className="rounded-xl bg-amber-50 px-3 py-2">
          <p className="mb-1 text-[11px] font-semibold text-amber-800">Alertas</p>
          {data.alertas.map((v, i) => (
            <p key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {v}
            </p>
          ))}
        </div>
      )}

      {/* Seção Dados Gerais */}
      <Section title="Dados Gerais" id="geral" open={openSection === "geral"} onToggle={toggleSection}>
        <FieldRow label="Número da NFS-e" f={data.numero} />
        <FieldRow label="Série" f={data.serie} />
        <FieldRow label="Código de Verificação" f={data.codigoVerificacao} />
        <FieldRow label="Data de Emissão" f={data.dataEmissao} />
        <FieldRow label="Data de Vencimento" f={data.dataVencimento} />
        <FieldRow label="Município de Emissão" f={data.municipioEmissao} />
        <FieldRow label="UF" f={data.ufEmissao} />
      </Section>

      {/* Seção Emitente */}
      <Section title="Emitente (Prestador)" id="emitente" open={openSection === "emitente"} onToggle={toggleSection}>
        <FieldRow label="Razão Social" f={data.emitente.razaoSocial} />
        <FieldRow label="CNPJ" f={data.emitente.cnpj} />
        <FieldRow
          label="Regime Tributário"
          f={data.emitente.regimeTributario}
          display={fmtRegime}
        />
        <FieldRow label="Inscrição Municipal" f={data.emitente.inscricaoMunicipal} />
        <FieldRow label="CEP" f={data.emitente.cep} />
        <FieldRow label="Logradouro" f={data.emitente.logradouro} />
        <FieldRow label="Número" f={data.emitente.numero} />
        <FieldRow label="UF" f={data.emitente.uf} />
        <FieldRow label="Município" f={data.emitente.municipio} />
        <FieldRow label="Telefone" f={data.emitente.fone} />
      </Section>

      {/* Seção Valores */}
      <Section title="Valores e Tributos" id="valores" open={openSection === "valores"} onToggle={toggleSection}>
        <FieldRow label="Descrição do Serviço" f={data.servico.discriminacao} />
        <FieldRow label="Código do Serviço" f={data.servico.itemListaServico} />
        <FieldRow label="CFOP" f={data.servico.cfop} />
        <FieldRow label="NCM" f={data.servico.ncm} />
        <FieldRow label="Valor dos Serviços" f={data.servico.valorServicos} display={fmt} />
        <FieldRow label="Base de Cálculo" f={data.servico.baseCalculo} display={fmt} />
        <FieldRow
          label="Alíquota ISS"
          f={data.servico.aliquotaIss}
          display={(v) => (v != null ? `${(v * 100).toFixed(2)}%` : "—")}
        />
        <FieldRow label="Valor ISS" f={data.servico.valorIss} display={fmt} />
        <FieldRow
          label="ISS Retido na Fonte"
          f={data.servico.issRetido}
          display={(v) => (v == null ? "—" : v ? "Sim" : "Não")}
        />
      </Section>

      {/* Seção Retenções */}
      <Section title="Retenções na Fonte" id="retencoes" open={openSection === "retencoes"} onToggle={toggleSection}>
        {/* ZFM warning inline */}
        {data.zmfDestino.value && (data.retencoes.pisDestacado.value ?? 0) + (data.retencoes.cofinsDestacado.value ?? 0) > 0 && (
          <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-700">
            <ShieldAlert className="h-3 w-3 shrink-0" />
            PIS/COFINS destacados — verificar não incidência ZFM
          </div>
        )}
        <FieldRow label="PIS (retido)" f={data.retencoes.valorPis} display={fmt} />
        <FieldRow label="COFINS (retido)" f={data.retencoes.valorCofins} display={fmt} />
        <FieldRow label="CSLL" f={data.retencoes.valorCsll} display={fmt} />
        <FieldRow label="IRRF" f={data.retencoes.valorIr} display={fmt} />
        <FieldRow label="INSS" f={data.retencoes.valorInss} display={fmt} />
        <FieldRow label="Outras Retenções" f={data.retencoes.outrasRetencoes} display={fmt} />
        <div className="mt-2 rounded-lg bg-slate-100 px-2 py-2 text-xs">
          <div className="mb-1 font-semibold text-slate-600">Conferência matemática</div>
          <div className="space-y-0.5 font-mono text-[11px] text-slate-700">
            <p>Valor bruto:          R$ {fmt(data.servico.valorServicos.value)}</p>
            {data.retencoes.valorPis.value ? <p>(-) PIS:              R$ {fmt(data.retencoes.valorPis.value)}</p> : null}
            {data.retencoes.valorCofins.value ? <p>(-) COFINS:           R$ {fmt(data.retencoes.valorCofins.value)}</p> : null}
            {data.retencoes.valorCsll.value ? <p>(-) CSLL:             R$ {fmt(data.retencoes.valorCsll.value)}</p> : null}
            {data.retencoes.valorIr.value ? <p>(-) IRRF:             R$ {fmt(data.retencoes.valorIr.value)}</p> : null}
            {data.retencoes.valorInss.value ? <p>(-) INSS:             R$ {fmt(data.retencoes.valorInss.value)}</p> : null}
            {data.servico.issRetido.value && data.servico.valorIss.value ? <p>(-) ISS retido:       R$ {fmt(data.servico.valorIss.value)}</p> : null}
            {data.retencoes.outrasRetencoes.value ? <p>(-) Outras:           R$ {fmt(data.retencoes.outrasRetencoes.value)}</p> : null}
            <p className="mt-1 border-t border-slate-300 pt-1 font-bold">
              = Líquido calculado: R$ {fmt(data.valorLiquidoNfse.value)}
            </p>
          </div>
        </div>
      </Section>

      {/* Seção Pedido */}
      <Section title="Vínculo com Pedido BTracker" id="pedido" open={openSection === "pedido"} onToggle={toggleSection}>
        {matchedPedido ? (
          <div className="mb-2 rounded-lg bg-sky-50 px-3 py-2 text-xs">
            <p className="font-semibold text-sky-800">Pedido encontrado no BTracker</p>
            <p className="text-sky-700">
              Nro. Pedido: {matchedPedido.nroPedido} · Item: {matchedPedido.nroItemPedido} ·
              Valor: R$ {fmt(parseFloat(matchedPedido.valorServicos ?? "0"))}
            </p>
          </div>
        ) : (
          <p className="mb-2 text-[11px] text-slate-500">
            {btrackerConnected
              ? "Nenhum pedido aberto encontrado para este CNPJ."
              : "Conecte ao BTracker para buscar pedidos automaticamente."}
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Nro. Pedido", val: nroPedido, set: setNroPedido },
            { label: "Nro. Item/Pedido", val: nroItemPedido, set: setNroItemPedido },
            { label: "Nro. Item/Serviço", val: nroItemServico, set: setNroItemServico },
          ].map(({ label, val, set }) => (
            <div key={label}>
              <p className="mb-1 text-[10px] text-slate-500">{label}</p>
              <input
                value={val}
                onChange={(e) => set(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-sky-400 focus:outline-none"
                placeholder="—"
              />
            </div>
          ))}
        </div>
        <div className="mt-3">
          <p className="mb-1 text-[10px] font-semibold text-slate-600">
            Tipo de Pagamento <span className="text-red-500">*</span>
          </p>
          <select
            aria-label="Tipo de Pagamento"
            value={tipoPagamento}
            onChange={(e) =>
              setTipoPagamento(e.target.value === "" ? "" : Number(e.target.value))
            }
            className={`w-full rounded-lg border px-2 py-1.5 text-xs focus:outline-none ${
              tipoPagamento === ""
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-slate-200 focus:border-sky-400"
            }`}
          >
            <option value="">Selecione…</option>
            {TIPO_PAGAMENTO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </Section>

      {/* Justificativas (preencha apenas se o BTracker bloquear por data) */}
      <details className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">
          Justificativas (se houver bloqueio de data)
        </summary>
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-1 text-[10px] text-slate-500">
              Justificativa de vencimento (vencimento &lt; 30 dias da emissão)
            </p>
            <input
              value={justVencimento}
              onChange={(e) => setJustVencimento(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-sky-400 focus:outline-none"
              placeholder="Ex: vencimento conforme acordo comercial"
            />
          </div>
          <div>
            <p className="mb-1 text-[10px] text-slate-500">
              Justificativa de liberação (data de emissão fora do período)
            </p>
            <input
              value={justLiberacao}
              onChange={(e) => setJustLiberacao(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-sky-400 focus:outline-none"
              placeholder="Ex: nota recebida com atraso pelo prestador"
            />
          </div>
        </div>
      </details>

      {/* Ações */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {btrackerConnected ? (
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {submitting ? "Enviando..." : "Enviar ao BTracker"}
          </button>
        ) : null}

        <a
          href="https://btracker.bemol.com.br/notas/recebimento"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Abrir BTracker
        </a>
      </div>

      {submitResult === "error" && submitError ? (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {submitError}
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  id,
  open,
  onToggle,
  children,
}: {
  title: string;
  id: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/80">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        )}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

const REGIME_LABEL: Record<string, string> = {
  simples_nacional: "Simples Nacional",
  mei: "MEI",
  lucro_presumido: "Lucro Presumido",
  lucro_real: "Lucro Real",
  pessoa_fisica: "Pessoa Física",
  desconhecido: "Não identificado",
};

function fmtRegime(v: string | null) {
  if (!v) return "—";
  return REGIME_LABEL[v] ?? v;
}

const STATUS_CONFIG: Record<NfseStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  aprovavel: {
    label: "Aprovável para lançamento",
    cls: "border-green-200 bg-green-50 text-green-800",
    icon: <ShieldCheck className="h-4 w-4 text-green-600" />,
  },
  revisar: {
    label: "Revisar antes de lançar",
    cls: "border-amber-200 bg-amber-50 text-amber-800",
    icon: <ShieldQuestion className="h-4 w-4 text-amber-600" />,
  },
  consultar_contabilidade: {
    label: "Consultar contabilidade antes de lançar",
    cls: "border-orange-200 bg-orange-50 text-orange-800",
    icon: <ShieldAlert className="h-4 w-4 text-orange-600" />,
  },
  bloquear: {
    label: "Bloquear lançamento — divergência tributária",
    cls: "border-red-200 bg-red-50 text-red-800",
    icon: <Ban className="h-4 w-4 text-red-600" />,
  },
};

const RISCO_LABEL: Record<NfseRisco, { label: string; cls: string }> = {
  baixo: { label: "Risco baixo", cls: "bg-green-100 text-green-700" },
  medio: { label: "Risco médio", cls: "bg-amber-100 text-amber-700" },
  alto: { label: "Risco alto", cls: "bg-red-100 text-red-700" },
};

function StatusBanner({ status, risco }: { status: NfseStatus; risco: NfseRisco }) {
  const s = STATUS_CONFIG[status];
  const r = RISCO_LABEL[risco];
  return (
    <div className={`flex items-center justify-between rounded-xl border px-4 py-2.5 ${s.cls}`}>
      <div className="flex items-center gap-2 text-xs font-semibold">
        {s.icon}
        {s.label}
      </div>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.cls}`}>
        {r.label}
      </span>
    </div>
  );
}

function buildBtrackerPayload(
  d: NfseExtracted,
  nroPedido: string,
  nroItemPedido: string,
  nroItemServico: string,
): SaveNfseInput {
  return {
    numero: d.numero.value,
    serie: d.serie.value,
    codigoVerificacao: d.codigoVerificacao.value,
    emissao: d.dataEmissao.value,
    vencimento: d.dataVencimento.value,
    municipioNome: d.municipioEmissao.value ?? d.emitente.municipio.value,
    uf: d.ufEmissao.value ?? d.emitente.uf.value,
    prestador: {
      razaoSocial: d.emitente.razaoSocial.value,
      documento: d.emitente.cnpj.value,
      municipioNome: d.emitente.municipio.value,
      uf: d.emitente.uf.value,
      inscricaoMunicipal: d.emitente.inscricaoMunicipal.value,
      cep: d.emitente.cep.value,
      logradouro: d.emitente.logradouro.value,
      numero: d.emitente.numero.value,
      complemento: d.emitente.complemento.value,
      bairro: d.emitente.bairro.value,
      fone: d.emitente.fone.value,
    },
    tomador: {
      razaoSocial: d.tomador.razaoSocial.value,
      documento: d.tomador.cnpj.value,
      municipioNome: d.tomador.municipio.value,
      uf: d.tomador.uf.value,
      logradouro: d.tomador.logradouro.value,
      numero: d.tomador.numero.value,
      complemento: d.tomador.complemento.value,
      bairro: d.tomador.bairro.value,
    },
    servico: {
      discriminacao: d.servico.discriminacao.value,
      itemListaServico: d.servico.itemListaServico.value,
      valorServicos: d.servico.valorServicos.value,
      baseCalculo: d.servico.baseCalculo.value,
      aliquota: d.servico.aliquotaIss.value,
      valorIss: d.servico.valorIss.value,
      issRetido: d.servico.issRetido.value,
    },
    retencoes: {
      valorPis: d.retencoes.valorPis.value,
      valorCofins: d.retencoes.valorCofins.value,
      valorCsll: d.retencoes.valorCsll.value,
      valorIr: d.retencoes.valorIr.value,
      valorInss: d.retencoes.valorInss.value,
      outrasRetencoes: d.retencoes.outrasRetencoes.value,
      totalRetencoes: d.retencoes.totalRetencoes.value,
    },
    valorLiquido: d.valorLiquidoNfse.value,
    nroPedido: nroPedido || null,
    nroItemPedido: nroItemPedido || null,
    nroItemServico: nroItemServico || null,
    tipoPagamento: null,
  };
}
