"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

  const normalizedEmail = useMemo(
    () => user?.email?.toLowerCase().trim() ?? null,
    [user?.email],
  );

  const fetchPrestadores = useCallback(async () => {
    if (!enabled) {
      setPrestadores([]);
      setLoading(false);
      setError(null);
      return;
    }

    if (assignedOnly && !normalizedEmail) {
      setPrestadores([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      let query = supabase
        .from("prestadores")
        .select("id,nome,cnpj,tipo_servico,usuarios,created_at")
        .order("created_at", { ascending: false });

      if (assignedOnly && normalizedEmail) {
        query = query.contains("usuarios", [normalizedEmail]);
      }

      const { data, error: queryError } = await query;

      if (queryError) {
        throw queryError;
      }

      setPrestadores(
        data?.map((item) => ({
          id: item.id as string,
          nome: item.nome as string,
          cnpj: item.cnpj as string,
          tipo_servico: item.tipo_servico as string,
          usuarios: (item.usuarios as string[] | null) ?? [],
          created_at: item.created_at as string,
        })) ?? [],
      );
      setError(null);
    } catch (err) {
      console.error("Erro ao carregar prestadores:", err);
      setPrestadores([]);
      setError(
        err instanceof Error
          ? err.message
          : "NÆo foi poss¡vel carregar os prestadores.",
      );
    } finally {
      setLoading(false);
    }
  }, [assignedOnly, enabled, normalizedEmail]);

  useEffect(() => {
    void fetchPrestadores();
  }, [fetchPrestadores]);

  const createPrestador = useCallback(
    async (input: CreatePrestadorInput) => {
      try {
        if (!enabled) {
          throw new Error("Cria‡Æo de prestadores est  desabilitada.");
        }
        const payload = {
          nome: input.nome,
          cnpj: input.cnpj,
          tipo_servico: input.tipo_servico,
          usuarios: input.usuarios.map((email) => email.toLowerCase().trim()),
        };

        const { data, error: insertError } = await supabase
          .from("prestadores")
          .insert(payload)
          .select("id,nome,cnpj,tipo_servico,usuarios,created_at")
          .single();

        if (insertError) {
          throw insertError;
        }

        if (data) {
          const novoPrestador: Prestador = {
            id: data.id as string,
            nome: data.nome as string,
            cnpj: data.cnpj as string,
            tipo_servico: data.tipo_servico as string,
            usuarios: (data.usuarios as string[] | null) ?? [],
            created_at: data.created_at as string,
          };
          setPrestadores((prev) => [novoPrestador, ...prev]);
          return novoPrestador;
        }

        return null;
      } catch (err) {
        console.error("Erro ao criar prestador:", err);
        throw err;
      }
    },
    [enabled],
  );

  return {
    prestadores,
    loading,
    error,
    refresh: fetchPrestadores,
    createPrestador,
  };
}
