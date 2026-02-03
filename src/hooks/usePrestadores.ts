"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";

export type Prestador = {
  id: string;
  nome: string;
  cnpj: string;
  tipo_servico: string;
  usuarios: string[];
  created_at: string;
};

export type CreatePrestadorInput = {
  nome: string;
  cnpj: string;
  tipo_servico: string;
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
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    return token;
  }, []);

  const fetchPrestadores = useCallback(async (signal?: AbortSignal) => {
    if (!enabled || !user) {
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
          payload.error ?? "Não foi possível carregar os prestadores.",
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
          : "Não foi possível carregar os prestadores.",
      );
    } finally {
      setLoading(false);
    }
  }, [assignedOnly, enabled, getAccessToken, user]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPrestadores(controller.signal);
    return () => controller.abort();
  }, [fetchPrestadores]);

  const createPrestador = useCallback(
    async (input: CreatePrestadorInput) => {
      if (!enabled) {
        throw new Error("Criação de prestadores está desabilitada.");
      }
      if (!user) {
        throw new Error("Sessão expirada. Faça login novamente.");
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
          payload.error ?? "Não foi possível cadastrar o prestador.",
        );
      }

      setPrestadores((prev) => [prestador, ...prev]);
      return prestador;
    },
    [enabled, getAccessToken, user],
  );

  return {
    prestadores,
    loading,
    error,
    refresh: fetchPrestadores,
    createPrestador,
  };
}
