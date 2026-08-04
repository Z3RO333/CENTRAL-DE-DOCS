"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type EquipamentoPendencia = {
  equipamento_id: string;
  identificacao: string | null;
  frequencia: "mensal" | "semestral" | "anual";
  meses_com_documentos: number[];
  meses_pendentes: number[];
  total_esperado: number;
  total_recebido: number;
  total_faltante: number;
};

export type TipoPendencia = {
  tipo_equipamento: string;
  equipamentos: EquipamentoPendencia[];
};

export type LojaPendenciaEquipamento = {
  loja_id: string;
  loja_nome: string;
  tipos: TipoPendencia[];
};

export type ControleEquipamentosResponse = {
  ano: number;
  perfil: "admin" | "gestor";
  total_equipamentos_pendentes: number;
  total_pendencias: number;
  lojas: LojaPendenciaEquipamento[];
};

type UseControleEquipamentosResult = {
  data: ControleEquipamentosResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useControleEquipamentos(
  ano: number,
  enabled = true,
): UseControleEquipamentosResult {
  const [data, setData] = useState<ControleEquipamentosResponse | null>(null);
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
        const response = await fetch(
          `/api/controle-equipamentos/pendencias?ano=${ano}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal,
          },
        );
        const payload = (await response.json()) as
          | ControleEquipamentosResponse
          | { error?: string };
        if (!response.ok) {
          throw new Error(
            (payload as { error?: string }).error ??
              "Falha ao carregar pendências de equipamentos.",
          );
        }
        if (signal?.aborted) {
          return;
        }
        setData(payload as ControleEquipamentosResponse);
      } catch (err) {
        if (signal?.aborted || (err as Error)?.name === "AbortError") {
          return;
        }
        setData(null);
        setError(
          err instanceof Error
            ? err.message
            : "Falha ao carregar pendências de equipamentos.",
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
