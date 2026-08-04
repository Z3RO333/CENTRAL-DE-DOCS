"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type Equipamento = {
  id: string;
  loja_id: string;
  tipo_equipamento: string;
  identificacao: string | null;
  marca: string | null;
  modelo: string | null;
  numero_serie: string | null;
  potencia: string | null;
  localizacao: string | null;
  prestador_id: string | null;
  documento_tipo_obrigatorio: string | null;
  data_instalacao: string | null;
  data_ativacao: string | null;
  data_desativacao: string | null;
  status: "ativo" | "inativo";
  atributos: Record<string, unknown>;
  origem_importacao: string | null;
  created_at: string;
  updated_at: string;
};

type UseEquipamentosOptions = {
  lojaId?: string;
  enabled?: boolean;
};

type EquipamentoInput = Partial<
  Omit<Equipamento, "id" | "created_at" | "updated_at" | "origem_importacao">
> & { loja_id: string; tipo_equipamento: string };

type EquipamentoUpdateInput = Partial<
  Omit<Equipamento, "id" | "created_at" | "updated_at" | "origem_importacao">
> & { id: string };

type UseEquipamentosResult = {
  equipamentos: Equipamento[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createEquipamento: (input: EquipamentoInput) => Promise<Equipamento | null>;
  updateEquipamento: (input: EquipamentoUpdateInput) => Promise<Equipamento | null>;
};

export function useEquipamentos(
  options: UseEquipamentosOptions = {},
): UseEquipamentosResult {
  const { lojaId, enabled = true } = options;
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([]);
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
      throw new Error("Sessao expirada. Faca login novamente.");
    }
    return token;
  }, []);

  const fetchEquipamentos = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) {
        setEquipamentos([]);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const url = lojaId
          ? `/api/equipamentos?lojaId=${encodeURIComponent(lojaId)}`
          : "/api/equipamentos";
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });
        const payload = (await response.json()) as {
          equipamentos?: Equipamento[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Falha ao carregar equipamentos.");
        }
        if (signal?.aborted) {
          return;
        }
        setEquipamentos(payload.equipamentos ?? []);
      } catch (err) {
        if (signal?.aborted) {
          return;
        }
        setEquipamentos([]);
        setError(
          err instanceof Error ? err.message : "Falha ao carregar equipamentos.",
        );
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [enabled, lojaId, getAccessToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchEquipamentos(controller.signal);
    return () => controller.abort();
  }, [fetchEquipamentos]);

  const createEquipamento = useCallback(
    async (input: EquipamentoInput) => {
      const token = await getAccessToken();
      const response = await fetch("/api/equipamentos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as {
        equipamento?: Equipamento;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao criar equipamento.");
      }
      if (payload.equipamento) {
        setEquipamentos((prev) => [payload.equipamento!, ...prev]);
      }
      return payload.equipamento ?? null;
    },
    [getAccessToken],
  );

  const updateEquipamento = useCallback(
    async (input: EquipamentoUpdateInput) => {
      const token = await getAccessToken();
      const response = await fetch("/api/equipamentos", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as {
        equipamento?: Equipamento;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao atualizar equipamento.");
      }
      if (payload.equipamento) {
        setEquipamentos((prev) =>
          prev.map((item) =>
            item.id === payload.equipamento!.id ? payload.equipamento! : item,
          ),
        );
      }
      return payload.equipamento ?? null;
    },
    [getAccessToken],
  );

  return {
    equipamentos,
    loading,
    error,
    refresh: fetchEquipamentos,
    createEquipamento,
    updateEquipamento,
  };
}
