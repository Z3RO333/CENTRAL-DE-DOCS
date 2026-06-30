"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, Loader2, X, UserCog } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useSimulacao, type Simulacao } from "@/components/SimulacaoProvider";

type Identidade = {
  email: string;
  label: string;
  role: "gerente_loja" | "fornecedor" | "prestador" | "colaborador";
  detalhe?: string;
};

const ROLE_LABEL: Record<string, string> = {
  gerente_loja: "Gerente",
  fornecedor: "Fornecedor",
  prestador: "Prestador",
  colaborador: "Colaborador",
};

export function SimulacaoControl({ canStart }: { canStart: boolean }) {
  const { simulacao, iniciar, encerrar } = useSimulacao();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identidades, setIdentidades] = useState<Identidade[]>([]);
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/admin/simular-identidades", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = (await res.json()) as { identidades?: Identidade[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Status ${res.status}`);
      setIdentidades(json.identidades ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar identidades");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void carregar();
  }, [open, carregar]);

  function aplicar(i: Identidade) {
    const s: Simulacao = { email: i.email, label: i.label, role: i.role, detalhe: i.detalhe };
    iniciar(s);
    setOpen(false);
    // recarrega para todas as telas/dados refletirem a identidade simulada
    window.location.reload();
  }

  function sair() {
    encerrar();
    window.location.reload();
  }

  if (!canStart && !simulacao) return null;

  const filtradas = identidades.filter(
    (i) =>
      !busca ||
      i.label.toLowerCase().includes(busca.toLowerCase()) ||
      i.email.toLowerCase().includes(busca.toLowerCase()),
  );
  const gerentes = filtradas.filter((i) => i.role === "gerente_loja");
  const fornecedores = filtradas.filter((i) => i.role === "fornecedor");
  const prestadores = filtradas.filter((i) => i.role === "prestador");

  return (
    <>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
      >
        <UserCog className="h-4 w-4" />
        Simular visão
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="relative flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">Simular visão</p>
                <p className="text-xs text-slate-500">
                  Veja o sistema como um gerente ou prestador (dados filtrados)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-slate-100 px-5 py-2">
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou e-mail…"
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-sky-400 focus:outline-none"
              />
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
                </div>
              ) : error ? (
                <p className="px-2 py-6 text-center text-xs text-red-600">{error}</p>
              ) : (
                <>
                  {simulacao && (
                    <button
                      type="button"
                      onClick={sair}
                      className="mb-2 w-full rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-left text-xs font-semibold text-sky-700 hover:bg-sky-100"
                    >
                      ↩ Voltar à minha visão (administrador)
                    </button>
                  )}
                  {gerentes.length > 0 && (
                    <Grupo titulo="Gerentes" itens={gerentes} onPick={aplicar} atual={simulacao?.email} />
                  )}
                  {fornecedores.length > 0 && (
                    <Grupo titulo="Fornecedores" itens={fornecedores} onPick={aplicar} atual={simulacao?.email} />
                  )}
                  {prestadores.length > 0 && (
                    <Grupo titulo="Prestadores" itens={prestadores} onPick={aplicar} atual={simulacao?.email} />
                  )}
                  {gerentes.length === 0 &&
                    fornecedores.length === 0 &&
                    prestadores.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-slate-400">
                      Nenhuma identidade encontrada.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Barra fixa no topo do conteúdo enquanto há simulação ativa. */
export function SimulacaoBanner() {
  const { simulacao, encerrar } = useSimulacao();
  if (!simulacao) return null;
  return (
    <div className="flex items-center justify-between gap-2 bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white">
      <span className="flex items-center gap-1.5">
        <Eye className="h-3.5 w-3.5" />
        Simulando: {simulacao.label}
        <span className="rounded-full bg-amber-600/60 px-2 py-0.5 text-[10px]">
          {ROLE_LABEL[simulacao.role] ?? simulacao.role}
        </span>
      </span>
      <button
        type="button"
        onClick={() => {
          encerrar();
          window.location.reload();
        }}
        className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold hover:bg-white/30"
      >
        Sair da simulação
      </button>
    </div>
  );
}

function Grupo({
  titulo,
  itens,
  onPick,
  atual,
}: {
  titulo: string;
  itens: Identidade[];
  onPick: (i: Identidade) => void;
  atual?: string;
}) {
  return (
    <div className="mb-3">
      <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {titulo}
      </p>
      <div className="space-y-1">
        {itens.map((i) => (
          <button
            key={i.email}
            type="button"
            onClick={() => onPick(i)}
            className={`flex w-full flex-col rounded-lg px-3 py-2 text-left transition hover:bg-slate-50 ${
              atual === i.email ? "bg-amber-50 ring-1 ring-amber-200" : ""
            }`}
          >
            <span className="text-xs font-semibold text-slate-800">{i.label}</span>
            <span className="text-[10px] text-slate-500">
              {i.email}
              {i.detalhe ? ` · ${i.detalhe}` : ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
