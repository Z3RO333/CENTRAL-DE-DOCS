"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { supabase } from "@/lib/supabaseClient";

type Sugestao = {
  id: string;
  variacao: string;
  termo_sugerido: string | null;
  documento_id: string | null;
  trecho: string | null;
  ocorrencias: number;
  created_at: string;
};

type Termo = {
  id: string;
  termo: string;
  categoria: string;
  tipo: "assunto" | "equipamento";
};

export default function TaxonomiaPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();

  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [termos, setTermos] = useState<Termo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processandoId, setProcessandoId] = useState<string | null>(null);
  const [selecaoTermo, setSelecaoTermo] = useState<Record<string, string>>({});
  const [novoTermoAberto, setNovoTermoAberto] = useState<Record<string, boolean>>({});
  const [novoTermoTexto, setNovoTermoTexto] = useState<Record<string, string>>({});
  const [novoTermoCategoria, setNovoTermoCategoria] = useState<Record<string, string>>({});
  const [novoTermoTipo, setNovoTermoTipo] = useState<Record<string, "assunto" | "equipamento">>(
    {},
  );

  useEffect(() => {
    if (authLoading || accessLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!isAdmin) {
      router.replace("/dashboard");
    }
  }, [authLoading, accessLoading, user, isAdmin, router]);

  const getAccessToken = async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const token = data.session?.access_token;
    if (!token) throw new Error("Sessao expirada. Faca login novamente.");
    return token;
  };

  const carregar = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [resSugestoes, resTermos] = await Promise.all([
        fetch("/api/taxonomia/sugestoes", { headers }),
        fetch("/api/taxonomia/termos", { headers }),
      ]);
      const payloadSugestoes = (await resSugestoes.json()) as {
        sugestoes?: Sugestao[];
        error?: string;
      };
      const payloadTermos = (await resTermos.json()) as { termos?: Termo[]; error?: string };
      if (!resSugestoes.ok) throw new Error(payloadSugestoes.error ?? "Falha ao carregar sugestoes.");
      if (!resTermos.ok) throw new Error(payloadTermos.error ?? "Falha ao carregar termos.");
      setSugestoes(payloadSugestoes.sugestoes ?? []);
      setTermos(payloadTermos.termos ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar a taxonomia.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !accessLoading && user && isAdmin) {
      void carregar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, accessLoading, user, isAdmin]);

  const decidir = async (id: string, body: Record<string, unknown>) => {
    setProcessandoId(id);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/taxonomia/sugestoes/${id}/decidir`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Nao foi possivel processar a decisao.");
      setSugestoes((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nao foi possivel processar a decisao.");
    } finally {
      setProcessandoId(null);
    }
  };

  if (authLoading || accessLoading || !user || !isAdmin) {
    return <div className="p-6 text-sm text-slate-500">Carregando...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Taxonomia — sugestões pendentes</h1>
        <p className="text-sm text-slate-500">
          Termos identificados pela IA que ainda não existem na taxonomia de busca. Aprove como
          sinônimo de um termo existente ou crie um termo novo.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando...</p>
      ) : sugestoes.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhuma sugestão pendente.</p>
      ) : (
        <div className="space-y-4">
          {sugestoes.map((sugestao) => (
            <div key={sugestao.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {sugestao.termo_sugerido ?? sugestao.variacao}
                  </p>
                  <p className="text-xs text-slate-500">
                    {sugestao.ocorrencias} ocorrência(s) — visto em{" "}
                    {new Date(sugestao.created_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={processandoId === sugestao.id}
                  onClick={() => void decidir(sugestao.id, { decisao: "rejeitar" })}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                >
                  Rejeitar
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={selecaoTermo[sugestao.id] ?? ""}
                  onChange={(event) =>
                    setSelecaoTermo((prev) => ({ ...prev, [sugestao.id]: event.target.value }))
                  }
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
                >
                  <option value="">Vincular a um termo existente…</option>
                  {termos.map((termo) => (
                    <option key={termo.id} value={termo.id}>
                      {termo.categoria} — {termo.termo}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!selecaoTermo[sugestao.id] || processandoId === sugestao.id}
                  onClick={() =>
                    void decidir(sugestao.id, {
                      decisao: "aprovar_existente",
                      termoId: selecaoTermo[sugestao.id],
                    })
                  }
                  className="rounded-full bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
                >
                  Aprovar como sinônimo
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setNovoTermoAberto((prev) => ({ ...prev, [sugestao.id]: !prev[sugestao.id] }))
                  }
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  {novoTermoAberto[sugestao.id] ? "Cancelar novo termo" : "Criar termo novo"}
                </button>
              </div>

              {novoTermoAberto[sugestao.id] && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
                  <input
                    placeholder="Termo canônico (ex.: gerador)"
                    value={novoTermoTexto[sugestao.id] ?? sugestao.termo_sugerido ?? ""}
                    onChange={(event) =>
                      setNovoTermoTexto((prev) => ({ ...prev, [sugestao.id]: event.target.value }))
                    }
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
                  />
                  <input
                    placeholder="Categoria (ex.: Gerador / nobreak)"
                    value={novoTermoCategoria[sugestao.id] ?? ""}
                    onChange={(event) =>
                      setNovoTermoCategoria((prev) => ({
                        ...prev,
                        [sugestao.id]: event.target.value,
                      }))
                    }
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
                  />
                  <select
                    value={novoTermoTipo[sugestao.id] ?? "equipamento"}
                    onChange={(event) =>
                      setNovoTermoTipo((prev) => ({
                        ...prev,
                        [sugestao.id]: event.target.value as "assunto" | "equipamento",
                      }))
                    }
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
                  >
                    <option value="equipamento">Equipamento</option>
                    <option value="assunto">Assunto</option>
                  </select>
                  <button
                    type="button"
                    disabled={processandoId === sugestao.id}
                    onClick={() =>
                      void decidir(sugestao.id, {
                        decisao: "aprovar_novo",
                        termo: novoTermoTexto[sugestao.id] ?? sugestao.termo_sugerido ?? "",
                        categoria: novoTermoCategoria[sugestao.id] ?? "",
                        tipo: novoTermoTipo[sugestao.id] ?? "equipamento",
                      })
                    }
                    className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    Criar e aprovar
                  </button>
                </div>
              )}

              {sugestao.trecho && (
                <p className="mt-3 rounded-xl bg-slate-50 p-2 text-xs text-slate-500">
                  &quot;{sugestao.trecho}&quot;
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
