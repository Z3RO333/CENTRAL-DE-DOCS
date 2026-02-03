"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type Loja = {
  id: string;
  nome: string;
  codigo: string | null;
  usuarios: string[];
  created_at: string;
};

type UseLojasOptions = {
  enabled?: boolean;
};

type UseLojasResult = {
  lojas: Loja[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createLoja: (input: {
    nome: string;
    codigo?: string | null;
    usuarios?: string[];
  }) => Promise<Loja | null>;
  updateLoja: (input: {
    id: string;
    nome?: string;
    codigo?: string | null;
    usuarios?: string[];
  }) => Promise<Loja | null>;
  removeLoja: (id: string) => Promise<void>;
};

export function useLojas(options: UseLojasOptions = {}): UseLojasResult {
  const { enabled = true } = options;
  const [lojas, setLojas] = useState<Loja[]>([]);
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

  const fetchLojas = useCallback(async (signal?: AbortSignal) => {
    if (!enabled) {
      setLojas([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/lojas", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal,
      });
      const payload = (await response.json()) as {
        lojas?: Loja[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao carregar lojas.");
      }
      if (signal?.aborted) {
        return;
      }
      setLojas(payload.lojas ?? []);
    } catch (err) {
      if (signal?.aborted) {
        return;
      }
      setLojas([]);
      setError(err instanceof Error ? err.message : "Falha ao carregar lojas.");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [enabled, getAccessToken]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchLojas(controller.signal);
    return () => controller.abort();
  }, [fetchLojas]);

  const createLoja = useCallback(
    async (input: {
      nome: string;
      codigo?: string | null;
      usuarios?: string[];
    }) => {
      const token = await getAccessToken();
      const response = await fetch("/api/lojas", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as { loja?: Loja; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao criar loja.");
      }
      if (payload.loja) {
        setLojas((prev) => [payload.loja!, ...prev]);
      }
      return payload.loja ?? null;
    },
    [getAccessToken],
  );

  const updateLoja = useCallback(
    async (input: {
      id: string;
      nome?: string;
      codigo?: string | null;
      usuarios?: string[];
    }) => {
      const token = await getAccessToken();
      const response = await fetch("/api/lojas", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as { loja?: Loja; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao atualizar loja.");
      }
      if (payload.loja) {
        setLojas((prev) =>
          prev.map((item) => (item.id === payload.loja!.id ? payload.loja! : item)),
        );
      }
      return payload.loja ?? null;
    },
    [getAccessToken],
  );

  const removeLoja = useCallback(
    async (id: string) => {
      const token = await getAccessToken();
      const response = await fetch(`/api/lojas?id=${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao remover loja.");
      }
      setLojas((prev) => prev.filter((item) => item.id !== id));
    },
    [getAccessToken],
  );

  return {
    lojas,
    loading,
    error,
    refresh: fetchLojas,
    createLoja,
    updateLoja,
    removeLoja,
  };
}
