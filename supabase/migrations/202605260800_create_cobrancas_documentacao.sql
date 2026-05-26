-- Histórico de cobranças de documentação enviadas
CREATE TABLE IF NOT EXISTS public.cobrancas_documentacao_historico (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prestador_id         uuid        NOT NULL REFERENCES public.prestadores(id) ON DELETE CASCADE,
  loja_id              text        NOT NULL,
  ano_referencia       integer     NOT NULL,
  meses_pendentes      integer[]   NOT NULL,
  emails_destinatarios text[]      NOT NULL,
  enviado_em           timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cobrancas_hist_lookup
  ON public.cobrancas_documentacao_historico (prestador_id, loja_id, ano_referencia, enviado_em DESC);

-- RLS: somente service_role acessa diretamente
ALTER TABLE public.cobrancas_documentacao_historico ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON public.cobrancas_documentacao_historico
  USING (auth.role() = 'service_role');

-- ============================================================
-- RPC: retorna pendências por fornecedor+loja para um ano
-- p_ano         : ano de referência (ex: 2025)
-- p_mes_limite  : último mês a verificar (ex: 4 verifica jan–abr)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cobrancas_pendencias_ano(
  p_ano        integer,
  p_mes_limite integer DEFAULT 12
)
RETURNS TABLE (
  prestador_id           uuid,
  loja_id                text,
  loja_nome              text,
  meses_com_documentos   integer[],
  meses_pendentes        integer[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  -- Passo 1: base de responsabilidade – pares únicos (prestador, loja) com qualquer documento
  base AS (
    SELECT
      f.prestador_id,
      f.dados->>'loja_id'   AS loja_id,
      MAX(f.dados->>'loja_nome') AS loja_nome
    FROM formularios f
    WHERE f.prestador_id IS NOT NULL
      AND f.dados->>'loja_id' IS NOT NULL
      AND f.dados->>'loja_id' <> ''
    GROUP BY f.prestador_id, f.dados->>'loja_id'
  ),
  -- Passo 2: documentos do ano de referência, com mês extraído
  docs_ano AS (
    SELECT
      f.prestador_id,
      f.dados->>'loja_id'                      AS loja_id,
      EXTRACT(MONTH FROM f.created_at)::integer AS mes
    FROM formularios f
    WHERE f.prestador_id IS NOT NULL
      AND f.dados->>'loja_id' IS NOT NULL
      AND f.created_at >= make_date(p_ano, 1, 1)::timestamptz
      AND f.created_at <  make_date(p_ano + 1, 1, 1)::timestamptz
  ),
  -- Passo 3: para cada par da base, quais meses têm documentos no ano
  meses_presentes AS (
    SELECT
      b.prestador_id,
      b.loja_id,
      b.loja_nome,
      COALESCE(
        array_agg(DISTINCT da.mes ORDER BY da.mes)
          FILTER (WHERE da.mes IS NOT NULL AND da.mes <= p_mes_limite),
        '{}'::integer[]
      ) AS meses_com_documentos
    FROM base b
    LEFT JOIN docs_ano da
      ON da.prestador_id = b.prestador_id
     AND da.loja_id      = b.loja_id
    GROUP BY b.prestador_id, b.loja_id, b.loja_nome
  )
  -- Passo 4: calcular meses pendentes e filtrar apenas quem tem pendência
  SELECT
    mp.prestador_id,
    mp.loja_id,
    mp.loja_nome,
    mp.meses_com_documentos,
    array(
      SELECT s
      FROM generate_series(1, p_mes_limite) s
      WHERE NOT (s = ANY(mp.meses_com_documentos))
    ) AS meses_pendentes
  FROM meses_presentes mp
  WHERE array_length(
    array(
      SELECT s
      FROM generate_series(1, p_mes_limite) s
      WHERE NOT (s = ANY(mp.meses_com_documentos))
    ),
    1
  ) > 0;
$$;
