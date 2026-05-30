-- Correção de fuso (America/Manaus) na RPC + dedup atômico por dia

-- 1) Coluna de dia da cobrança (fuso Manaus) + índice único anti-duplicata
ALTER TABLE public.cobrancas_documentacao_historico
  ADD COLUMN IF NOT EXISTS dia_cobranca date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Manaus')::date;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cobrancas_hist_dia
  ON public.cobrancas_documentacao_historico (prestador_id, loja_id, ano_referencia, dia_cobranca);

-- 2) RPC com correção de fuso horário na extração de mês/ano
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
  base AS (
    SELECT
      f.prestador_id,
      f.dados->>'loja_id'        AS loja_id,
      MAX(f.dados->>'loja_nome') AS loja_nome
    FROM formularios f
    WHERE f.prestador_id IS NOT NULL
      AND f.dados->>'loja_id' IS NOT NULL
      AND f.dados->>'loja_id' <> ''
      AND f.tipo <> 'contratos'
    GROUP BY f.prestador_id, f.dados->>'loja_id'
  ),
  docs_ano AS (
    SELECT
      f.prestador_id,
      f.dados->>'loja_id' AS loja_id,
      EXTRACT(MONTH FROM (f.created_at AT TIME ZONE 'America/Manaus'))::integer AS mes
    FROM formularios f
    WHERE f.prestador_id IS NOT NULL
      AND f.dados->>'loja_id' IS NOT NULL
      AND f.tipo <> 'contratos'
      AND (f.created_at AT TIME ZONE 'America/Manaus') >= make_timestamp(p_ano, 1, 1, 0, 0, 0)
      AND (f.created_at AT TIME ZONE 'America/Manaus') <  make_timestamp(p_ano + 1, 1, 1, 0, 0, 0)
  ),
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
