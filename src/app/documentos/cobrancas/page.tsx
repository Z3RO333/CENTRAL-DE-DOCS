"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Mail,
  RefreshCcw,
  Search,
  Store,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import {
  useCobrancas,
  type FornecedorPendencia,
  type LojaPendencia,
} from "@/hooks/useCobrancas";

const MESES_CURTOS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

function anosDisponiveis(): number[] {
  const atual = new Date().getFullYear();
  return [atual, atual - 1, atual - 2];
}

function MesGridBase({ loja }: { loja: LojaPendencia }) {
  const presentes = new Set(loja.meses_com_documentos);
  const pendentes = new Set(loja.meses_pendentes);
  return (
    <div className="flex flex-wrap gap-1">
      {MESES_CURTOS.map((label, idx) => {
        const mes = idx + 1;
        let cls = "bg-slate-100 text-slate-400"; // não vencido
        if (presentes.has(mes)) {
          cls = "bg-emerald-100 text-emerald-700";
        } else if (pendentes.has(mes)) {
          cls = "bg-red-100 text-red-700";
        }
        return (
          <span
            key={label}
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}
            title={
              presentes.has(mes)
                ? `${label}: recebido`
                : pendentes.has(mes)
                  ? `${label}: pendente`
                  : `${label}: não vencido`
            }
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

function MesTipoRow({
  label,
  recebidos,
  pendentes,
}: {
  label: string;
  recebidos: number[];
  pendentes: number[];
}) {
  const recebidosSet = new Set(recebidos);
  const pendentesSet = new Set(pendentes);

  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-2">
      <span className="text-[11px] font-semibold text-slate-500">{label}</span>
      <div className="flex flex-wrap gap-1">
        {MESES_CURTOS.map((mesLabel, idx) => {
          const mes = idx + 1;
          let cls = "bg-slate-100 text-slate-400";
          if (recebidosSet.has(mes)) {
            cls = "bg-emerald-100 text-emerald-700";
          } else if (pendentesSet.has(mes)) {
            cls = "bg-red-100 text-red-700";
          }
          return (
            <span
              key={mesLabel}
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}
              title={
                recebidosSet.has(mes)
                  ? `${mesLabel}: recebido`
                  : pendentesSet.has(mes)
                    ? `${mesLabel}: pendente`
                    : `${mesLabel}: nao vencido`
              }
            >
              {mesLabel}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function MesGrid({ loja }: { loja: LojaPendencia }) {
  const temTipos =
    loja.meses_com_documentos_laudos.length > 0 ||
    loja.meses_com_documentos_retencao.length > 0 ||
    loja.meses_pendentes_laudos.length > 0 ||
    loja.meses_pendentes_retencao.length > 0;

  if (!temTipos) return <MesGridBase loja={loja} />;

  return (
    <div className="space-y-1.5">
      <MesTipoRow
        label="Laudos"
        recebidos={loja.meses_com_documentos_laudos}
        pendentes={loja.meses_pendentes_laudos}
      />
      <MesTipoRow
        label="Retenção"
        recebidos={loja.meses_com_documentos_retencao}
        pendentes={loja.meses_pendentes_retencao}
      />
    </div>
  );
}

function FornecedorCard({ fornecedor }: { fornecedor: FornecedorPendencia }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <span className="text-slate-400">
          {aberto ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            {fornecedor.prestador_nome}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Store className="h-3 w-3" />
              {fornecedor.total_lojas} loja
              {fornecedor.total_lojas > 1 ? "s" : ""}
            </span>
            {fornecedor.emails_contato.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3 w-3" />
                {fornecedor.emails_contato.join(", ")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-600">
                <Mail className="h-3 w-3" />
                sem e-mail externo
              </span>
            )}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
          {fornecedor.total_documentos_faltantes} faltando
        </span>
      </button>

      {aberto && (
        <div className="border-t border-slate-100">
          {/* Desktop */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Pendências de cobrança por prestador e loja</caption>
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 text-left">Loja / Unidade</th>
                  <th className="px-5 py-3 text-left">Meses</th>
                  <th className="px-3 py-3 text-center">Esper.</th>
                  <th className="px-3 py-3 text-center">Receb.</th>
                  <th className="px-3 py-3 text-center">Falt.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fornecedor.lojas.map((loja) => (
                  <tr key={loja.loja_id}>
                    <td className="px-5 py-3 font-medium text-slate-700">
                      {loja.loja_nome}
                    </td>
                    <td className="px-5 py-3">
                      <MesGrid loja={loja} />
                    </td>
                    <td className="px-3 py-3 text-center text-slate-500">
                      {loja.total_esperado}
                    </td>
                    <td className="px-3 py-3 text-center font-semibold text-emerald-600">
                      {loja.total_recebido}
                    </td>
                    <td className="px-3 py-3 text-center font-bold text-red-600">
                      {loja.total_faltante}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="space-y-3 p-3 md:hidden">
            {fornecedor.lojas.map((loja) => (
              <div
                key={loja.loja_id}
                className="rounded-xl border border-slate-200 bg-white p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-700">
                    {loja.loja_nome}
                  </p>
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                    {loja.total_faltante} falt.
                  </span>
                </div>
                <div className="mt-2">
                  <MesGrid loja={loja} />
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Esperados {loja.total_esperado} · Recebidos{" "}
                  {loja.total_recebido}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CobrancasPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const {
    isAdmin,
    role,
    loading: accessLoading,
  } = useDocumentsAccess();

  const podeVer = isAdmin || role === "gerente_loja";

  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [busca, setBusca] = useState("");

  const habilitado = Boolean(user) && podeVer && !accessLoading;
  const { data, loading, error, refresh } = useCobrancas(ano, habilitado);

  useEffect(() => {
    if (authLoading || accessLoading) {
      return;
    }
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!podeVer) {
      router.replace("/documentos");
    }
  }, [authLoading, accessLoading, user, podeVer, router]);

  const fornecedoresFiltrados = useMemo(() => {
    if (!data) return [];
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const termo = norm(busca.trim());
    if (!termo) return data.fornecedores;
    return data.fornecedores.filter((f) =>
      norm(f.prestador_nome).includes(termo),
    );
  }, [data, busca]);

  const totais = useMemo(() => {
    if (!data) {
      return { fornecedores: 0, lojas: 0, documentos: 0 };
    }
    const lojas = data.fornecedores.reduce((a, f) => a + f.total_lojas, 0);
    const documentos = data.fornecedores.reduce(
      (a, f) => a + f.total_documentos_faltantes,
      0,
    );
    return {
      fornecedores: data.fornecedores.length,
      lojas,
      documentos,
    };
  }, [data]);

  if (authLoading || accessLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando...
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
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
      {/* Cabeçalho */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Documentação mensal
          </p>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">
            Cobranças de Documentação
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Pendências por fornecedor e loja com histórico de documentação.
            {data?.perfil === "gerente" && " Exibindo apenas o seu escopo."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">
            <span className="sr-only">Ano</span>
            <select
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
            >
              {anosDisponiveis().map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Atualizar
          </button>
        </div>
      </header>

      {/* Cartões de resumo */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-sm shadow-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Fornecedores
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {totais.fornecedores}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm shadow-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Lojas com pendência
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {totais.lojas}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm shadow-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Documentos faltantes
          </p>
          <p className="mt-1 text-2xl font-bold text-red-600">
            {totais.documentos}
          </p>
        </div>
      </section>

      {/* Busca */}
      <section className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
        <label className="text-xs font-semibold text-slate-600">
          <span className="sr-only">Pesquisar fornecedor</span>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Pesquisar fornecedor..."
              className="w-full text-sm text-slate-700 outline-none"
            />
          </div>
        </label>
      </section>

      {error && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-10 text-sm text-slate-500">
          Carregando pendências...
        </div>
      ) : fornecedoresFiltrados.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white py-12 text-center shadow-sm shadow-slate-200">
          <AlertTriangle className="h-8 w-8 text-emerald-500" />
          <p className="text-sm font-semibold text-slate-700">
            Nenhuma pendência encontrada
          </p>
          <p className="text-xs text-slate-500">
            {busca
              ? "Nenhum fornecedor corresponde à busca."
              : `Não há documentação pendente para ${ano}.`}
          </p>
        </div>
      ) : (
        <section className="space-y-3">
          {fornecedoresFiltrados.map((f) => (
            <FornecedorCard key={f.prestador_id} fornecedor={f} />
          ))}
        </section>
      )}
    </div>
  );
}
