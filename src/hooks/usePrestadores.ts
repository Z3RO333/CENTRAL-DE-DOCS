"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";

export type Prestador = {
  id: string;
  nome: string;
  cnpj: string;
  tipo_servico: string;
  categoria: string;
  usuarios: string[];
  created_at: string;
};

export type CreatePrestadorInput = {
  nome: string;
  cnpj: string;
  tipo_servico: string;
  categoria?: string;
  usuarios: string[];
};

type UsePrestadoresOptions = {
  assignedOnly?: boolean;
  enabled?: boolean;
};

type UsePrestadoresResult = {
  prestadores: Prestador[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createPrestador: (input: CreatePrestadorInput) => Promise<Prestador | null>;
};

export function usePrestadores(
  options: UsePrestadoresOptions = {},
): UsePrestadoresResult {
  const { assignedOnly = false, enabled = true } = options;
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [prestadores, setPrestadores] = useState<Prestador[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getAccessToken = useCallback(async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }
    const token = data.session?.access_token;
    if (!token) {
      throw new Error("Sessao expirada. Faca login novamente.");
    }
    return token;
  }, []);

  const fetchPrestadores = useCallback(async (signal?: AbortSignal) => {
    if (!enabled || !userId) {
      setPrestadores([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const token = await getAccessToken();
      const params = new URLSearchParams();
      if (assignedOnly) {
        params.set("assignedOnly", "true");
      }
      const url =
        params.size > 0 ? `/api/prestadores?${params.toString()}` : "/api/prestadores";
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal,
      });

      const payload = (await response.json()) as {
        prestadores?: Prestador[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error ?? "Nao foi possivel carregar os prestadores.",
        );
      }

      if (signal?.aborted) {
        return;
      }
      setPrestadores(payload.prestadores ?? []);
      setError(null);
    } catch (err) {
      if (signal?.aborted) {
        return;
      }
      console.error("Erro ao carregar prestadores:", err);
      setPrestadores([]);
      setError(
        err instanceof Error
          ? err.message
          : "Nao foi possivel carregar os prestadores.",
      );
    } finally {
      setLoading(false);
    }
  }, [assignedOnly, enabled, getAccessToken, userId]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPrestadores(controller.signal);
    return () => controller.abort();
  }, [fetchPrestadores]);

  const createPrestador = useCallback(
    async (input: CreatePrestadorInput) => {
      if (!enabled) {
        throw new Error("Criacao de prestadores esta desabilitada.");
      }
      if (!userId) {
        throw new Error("Sessao expirada. Faca login novamente.");
      }

      const token = await getAccessToken();
      const response = await fetch("/api/prestadores", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      });

      const payload = (await response.json()) as {
        prestador?: Prestador;
        error?: string;
      };

      const prestador = payload.prestador;
      if (!response.ok || !prestador) {
        throw new Error(
          payload.error ?? "Nao foi possivel cadastrar o prestador.",
        );
      }

      setPrestadores((prev) => [prestador, ...prev]);
      return prestador;
    },
    [enabled, getAccessToken, userId],
  );

  return {
    prestadores,
    loading,
    error,
    refresh: fetchPrestadores,
    createPrestador,
  };
}

