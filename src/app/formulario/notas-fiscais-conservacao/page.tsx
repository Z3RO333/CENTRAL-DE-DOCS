"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { usePrestadores } from "@/hooks/usePrestadores";
import { useLojas } from "@/hooks/useLojas";
import { parseCompetencia } from "@/lib/competencia";
import PrestadorCombobox from "../[slug]/_components/PrestadorCombobox";
import LojaCombobox from "../[slug]/_components/LojaCombobox";

export default function NotasFiscaisConservacaoPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { isAdmin } = useDocumentsAccess();
  const { prestadores, loading: prestadoresLoading } = usePrestadores({
    assignedOnly: !isAdmin,
  });
  const { lojas, loading: lojasLoading } = useLojas();

  const prestadoresConservacao = useMemo(
    () => prestadores.filter((item) => item.categoria === "conservacao"),
    [prestadores],
  );

  const [prestadorId, setPrestadorId] = useState("");
  const [lojaId, setLojaId] = useState("");
  const [numeroNf, setNumeroNf] = useState("");
  const [numeroPedido, setNumeroPedido] = useState("");
  const [valor, setValor] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [dataRecebimento, setDataRecebimento] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const getAccessToken = async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const token = data.session?.access_token;
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");
    return token;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!user) {
      setError("Sessão expirada. Faça login novamente.");
      router.push("/login");
      return;
    }
    if (!prestadorId || !lojaId || !numeroNf.trim() || !dataRecebimento) {
      setError("Preencha prestador, loja, número da NF e data de recebimento.");
      return;
    }
    if (!file) {
      setError("Anexe o PDF da nota fiscal.");
      return;
    }
    if (competencia.trim() && !parseCompetencia(competencia.trim())) {
      setError("Competência inválida. Use o formato MM/AAAA.");
      return;
    }

    setSubmitting(true);
    try {
      const ext = file.name.split(".").pop() ?? "pdf";
      const path = `${user.id}/notas_fiscais_conservacao/${Date.now()}.${ext}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("formularios")
        .upload(path, file);
      if (uploadError || !uploadData) {
        throw uploadError ?? new Error("Erro ao enviar o PDF.");
      }

      const token = await getAccessToken();
      const response = await fetch("/api/notas-fiscais-conservacao", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prestadorId,
          lojaId,
          numeroNf: numeroNf.trim(),
          numeroPedido: numeroPedido.trim() || undefined,
          valor: valor.trim() || undefined,
          competencia: competencia.trim() || undefined,
          dataRecebimento,
          observacoes: observacoes.trim() || undefined,
          arquivo: {
            path: uploadData.path ?? path,
            name: file.name,
            type: file.type,
            size: file.size,
          },
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível cadastrar a nota fiscal.");
      }

      setSuccess("Nota fiscal cadastrada com sucesso.");
      setPrestadorId("");
      setLojaId("");
      setNumeroNf("");
      setNumeroPedido("");
      setValor("");
      setCompetencia("");
      setDataRecebimento("");
      setObservacoes("");
      setFile(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível cadastrar a nota fiscal.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <header>
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-2 text-xs text-slate-500 hover:text-sky-600"
        >
          Voltar
        </button>
        <div className="flex items-center gap-2">
          <FilePlus2 className="h-5 w-5 text-slate-700" />
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Nota Fiscal — Conservação
          </h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Cadastre a nota fiscal de uma empresa conservadora para controle e auditoria.
        </p>
      </header>

      {error && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="max-w-2xl space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Prestador (conservadora)
          <div className="mt-1 font-normal normal-case tracking-normal">
            <PrestadorCombobox
              prestadores={prestadoresConservacao}
              value={prestadorId}
              onChange={setPrestadorId}
              loading={prestadoresLoading}
              required
            />
          </div>
        </label>

        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Loja
          <div className="mt-1 font-normal normal-case tracking-normal">
            <LojaCombobox
              lojas={lojas}
              value={lojaId}
              onChange={setLojaId}
              loading={lojasLoading}
              required
            />
          </div>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Número da NF
            <input
              type="text"
              value={numeroNf}
              onChange={(event) => setNumeroNf(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
              required
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Número do pedido
            <input
              type="text"
              value={numeroPedido}
              onChange={(event) => setNumeroPedido(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Valor
            <input
              type="number"
              step="0.01"
              value={valor}
              onChange={(event) => setValor(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Competência
            <input
              type="text"
              placeholder="MM/AAAA"
              value={competencia}
              onChange={(event) => setCompetencia(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Data de recebimento
            <input
              type="date"
              value={dataRecebimento}
              onChange={(event) => setDataRecebimento(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
              required
            />
          </label>
        </div>

        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Observações
          <textarea
            value={observacoes}
            onChange={(event) => setObservacoes(event.target.value)}
            className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>

        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          PDF da nota fiscal
          <input
            type="file"
            accept="application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="mt-2 block w-full cursor-pointer text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-sky-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
          />
          {file && <p className="mt-1 text-xs text-slate-500">{file.name}</p>}
        </label>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {submitting ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
