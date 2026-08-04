"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RefreshCcw,
  Search,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { useIsAprovadorInterno } from "@/hooks/useIsAprovadorInterno";
import {
  useControleEquipamentos,
  type EquipamentoPendencia,
  type LojaPendenciaEquipamento,
  type TipoPendencia,
} from "@/hooks/useControleEquipamentos";

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

function MesGrid({ equipamento }: { equipamento: EquipamentoPendencia }) {
  const presentes = new Set(equipamento.meses_com_documentos);
  const pendentes = new Set(equipamento.meses_pendentes);
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

function TipoSection({ tipo }: { tipo: TipoPendencia }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {tipo.tipo_equipamento}
      </p>
      {/* Desktop */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-100 md:block">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">
            Pendências de documentação por equipamento
          </caption>
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Equipamento</th>
              <th className="px-4 py-2 text-left">Meses</th>
              <th className="px-3 py-2 text-center">Esper.</th>
              <th className="px-3 py-2 text-center">Receb.</th>
              <th className="px-3 py-2 text-center">Falt.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tipo.equipamentos.map((equipamento) => (
              <tr key={equipamento.equipamento_id}>
                <td className="px-4 py-2 font-medium text-slate-700">
                  {equipamento.identificacao ?? "—"}
                </td>
                <td className="px-4 py-2">
                  <MesGrid equipamento={equipamento} />
                </td>
                <td className="px-3 py-2 text-center text-slate-500">
                  {equipamento.total_esperado}
                </td>
                <td className="px-3 py-2 text-center font-semibold text-emerald-600">
                  {equipamento.total_recebido}
                </td>
                <td className="px-3 py-2 text-center font-bold text-red-600">
                  {equipamento.total_faltante}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="space-y-2 md:hidden">
        {tipo.equipamentos.map((equipamento) => (
          <div
            key={equipamento.equipamento_id}
            className="rounded-xl border border-slate-200 bg-white p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-700">
                {equipamento.identificacao ?? "—"}
              </p>
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                {equipamento.total_faltante} falt.
              </span>
            </div>
            <div className="mt-2">
              <MesGrid equipamento={equipamento} />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Esperados {equipamento.total_esperado} · Recebidos{" "}
              {equipamento.total_recebido}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LojaCard({ loja }: { loja: LojaPendenciaEquipamento }) {
  const [aberto, setAberto] = useState(false);
  const totalFaltante = loja.tipos.reduce(
    (acc, tipo) =>
      acc +
      tipo.equipamentos.reduce((a, e) => a + e.total_faltante, 0),
    0,
  );

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
            {loja.loja_nome}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Wrench className="h-3 w-3" />
              {loja.tipos.length} tipo{loja.tipos.length > 1 ? "s" : ""} de
              equipamento
            </span>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
          {totalFaltante} faltando
        </span>
      </button>

      {aberto && (
        <div className="border-t border-slate-100 p-4">
          {loja.tipos.map((tipo) => (
            <TipoSection key={tipo.tipo_equipamento} tipo={tipo} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ControleEquipamentosPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();
  const { isAprovadorInterno, loading: aprovadorLoading } =
    useIsAprovadorInterno();

  const podeVer = isAdmin || isAprovadorInterno;
  const carregando = authLoading || accessLoading || aprovadorLoading;

  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [busca, setBusca] = useState("");
  const [lojaFilter, setLojaFilter] = useState("todas");
  const [tipoFilter, setTipoFilter] = useState("todos");

  const habilitado = Boolean(user) && podeVer && !carregando;
  const { data, loading, error, refresh } = useControleEquipamentos(
    ano,
    habilitado,
  );

  useEffect(() => {
    if (carregando) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!podeVer) {
      router.replace("/documentos");
    }
  }, [carregando, user, podeVer, router]);

  const tiposDisponiveis = useMemo(() => {
    if (!data) return [];
    const tipos = new Set<string>();
    data.lojas.forEach((loja) =>
      loja.tipos.forEach((t) => tipos.add(t.tipo_equipamento)),
    );
    return Array.from(tipos).sort();
  }, [data]);

  const lojasFiltradas = useMemo(() => {
    if (!data) return [];
    const norm = (s: string) =>
      s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const termo = norm(busca.trim());
    return data.lojas
      .filter((loja) => lojaFilter === "todas" || loja.loja_id === lojaFilter)
      .filter((loja) => !termo || norm(loja.loja_nome).includes(termo))
      .map((loja) => ({
        ...loja,
        tipos: loja.tipos.filter(
          (tipo) =>
            tipoFilter === "todos" || tipo.tipo_equipamento === tipoFilter,
        ),
      }))
      .filter((loja) => loja.tipos.length > 0);
  }, [data, busca, lojaFilter, tipoFilter]);

  const totais = useMemo(() => {
    if (!data) {
      return { lojas: 0, equipamentos: 0, documentos: 0 };
    }
    let equipamentos = 0;
    let documentos = 0;
    data.lojas.forEach((loja) =>
      loja.tipos.forEach((tipo) =>
        tipo.equipamentos.forEach((equipamento) => {
          equipamentos += 1;
          documentos += equipamento.total_faltante;
        }),
      ),
    );
    return {
      lojas: data.lojas.length,
      equipamentos,
      documentos,
    };
  }, [data]);

  if (carregando) {
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

  if (!podeVer) {
    return null;
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
            Controle mensal por equipamento
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Pendências por loja, tipo de equipamento e equipamento.
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
            Lojas com pendência
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {totais.lojas}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm shadow-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Equipamentos com pendência
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {totais.equipamentos}
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

      {/* Busca e filtros */}
      <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm shadow-slate-200 sm:flex-row sm:items-center">
        <label className="flex-1 text-xs font-semibold text-slate-600">
          <span className="sr-only">Pesquisar loja</span>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Pesquisar loja..."
              className="w-full text-sm text-slate-700 outline-none"
            />
          </div>
        </label>
        <select
          value={lojaFilter}
          onChange={(e) => setLojaFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
        >
          <option value="todas">Todas as lojas</option>
          {data?.lojas.map((loja) => (
            <option key={loja.loja_id} value={loja.loja_id}>
              {loja.loja_nome}
            </option>
          ))}
        </select>
        <select
          value={tipoFilter}
          onChange={(e) => setTipoFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
        >
          <option value="todos">Todos os tipos</option>
          {tiposDisponiveis.map((tipo) => (
            <option key={tipo} value={tipo}>
              {tipo}
            </option>
          ))}
        </select>
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
      ) : lojasFiltradas.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white py-12 text-center shadow-sm shadow-slate-200">
          <AlertTriangle className="h-8 w-8 text-emerald-500" />
          <p className="text-sm font-semibold text-slate-700">
            Nenhuma pendência encontrada
          </p>
          <p className="text-xs text-slate-500">
            {busca
              ? "Nenhuma loja corresponde à busca."
              : `Não há documentação pendente para ${ano}.`}
          </p>
        </div>
      ) : (
        <section className="space-y-3">
          {lojasFiltradas.map((loja) => (
            <LojaCard key={loja.loja_id} loja={loja} />
          ))}
        </section>
      )}
    </div>
  );
}
