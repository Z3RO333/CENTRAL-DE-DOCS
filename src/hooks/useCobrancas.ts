"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type LojaPendencia = {
  loja_id: string;
  loja_nome: string;
  meses_com_documentos: number[];
  meses_com_documentos_laudos: number[];
  meses_com_documentos_retencao: number[];
  meses_pendentes: number[];
  meses_pendentes_laudos: number[];
  meses_pendentes_retencao: number[];
  total_esperado: number;
  total_recebido: number;
  total_faltante: number;
};

export type FornecedorPendencia = {
  prestador_id: string;
  prestador_nome: string;
  emails_contato: string[];
  ano_referencia: number;
  total_lojas: number;
  total_documentos_faltantes: number;
  lojas: LojaPendencia[];
};

export type PendenciasResponse = {
  ano: number;
  perfil: "admin" | "gerente";
  total_fornecedores: number;
  total_pendencias: number;
  fornecedores: FornecedorPendencia[];
};

type UseCobrancasResult = {
  data: PendenciasResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useCobrancas(ano: number, enabled = true): UseCobrancasResult {
  const [data, setData] = useState<PendenciasResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getAccessToken = useCallback(async () => {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }
    const token = sessionData.session?.access_token;
    if (!token) {
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    return token;
  }, []);

  const fetchPendencias = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) {
        setData(null);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const response = await fetch(`/api/cobrancas/pendencias?ano=${ano}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });
        const payload = (await response.json()) as
          | PendenciasResponse
          | { error?: string };
        if (!response.ok) {
          throw new Error(
            (payload as { error?: string }).error ??
              "Falha ao carregar pendências.",
          );
        }
        if (signal?.aborted) {
          return;
        }
        setData(payload as PendenciasResponse);
      } catch (err) {
        if (signal?.aborted || (err as Error)?.name === "AbortError") {
          return;
        }
        setData(null);
        setError(
          err instanceof Error ? err.message : "Falha ao carregar pendências.",
        );
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [ano, enabled, getAccessToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchPendencias(controller.signal);
    return () => controller.abort();
  }, [fetchPendencias]);

  const refresh = useCallback(() => {
    void fetchPendencias();
  }, [fetchPendencias]);

  return { data, loading, error, refresh };
}
