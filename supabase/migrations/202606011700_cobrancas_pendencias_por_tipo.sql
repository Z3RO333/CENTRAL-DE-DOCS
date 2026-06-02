-- DROP necessario porque a assinatura de retorno mudou (novas colunas)
DROP FUNCTION IF EXISTS public.cobrancas_pendencias_ano(integer, integer);

CREATE OR REPLACE FUNCTION public.cobrancas_pendencias_ano(
  p_ano        integer,
  p_mes_limite integer DEFAULT 12
)
RETURNS TABLE (
  prestador_id                    uuid,
  loja_id                         text,
  loja_nome                       text,
  meses_com_documentos            integer[],
  meses_com_documentos_laudos     integer[],
  meses_com_documentos_retencao   integer[],
  meses_pendentes                 integer[],
  meses_pendentes_laudos          integer[],
  meses_pendentes_retencao        integer[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  tipos(tipo) AS (
    VALUES ('registro_laudos'::text), ('retencao_trabalhista'::text)
  ),
  base AS (
    SELECT
      f.prestador_id,
      f.dados->>'loja_id' AS loja_id,
      MAX(f.dados->>'loja_nome') AS loja_nome
    FROM formularios f
    WHERE f.prestador_id IS NOT NULL
      AND f.dados->>'loja_id' IS NOT NULL
      AND f.dados->>'loja_id' <> ''
      AND f.tipo IN ('registro_laudos','retencao_trabalhista')
    GROUP BY f.prestador_id, f.dados->>'loja_id'
    HAVING count(*) > 1
  ),
  docs_ano AS (
    SELECT
      f.prestador_id,
      f.dados->>'loja_id' AS loja_id,
      f.tipo,
      CASE
        WHEN f.dados->>'competencia' ~ '^(0?[1-9]|1[0-2])/[0-9]{4}$'
          THEN split_part(f.dados->>'competencia', '/', 1)::integer
        ELSE EXTRACT(MONTH FROM (f.created_at AT TIME ZONE 'America/Manaus'))::integer
      END AS mes
    FROM formularios f
    WHERE f.prestador_id IS NOT NULL
      AND f.dados->>'loja_id' IS NOT NULL
      AND f.tipo IN ('registro_laudos','retencao_trabalhista')
      AND (
        CASE
          WHEN f.dados->>'competencia' ~ '^(0?[1-9]|1[0-2])/[0-9]{4}$'
            THEN split_part(f.dados->>'competencia', '/', 2)::integer
          ELSE EXTRACT(YEAR FROM (f.created_at AT TIME ZONE 'America/Manaus'))::integer
        END
      ) = p_ano
  ),
  primeiro_envio AS (
    SELECT
      b.prestador_id,
      b.loja_id,
      MIN(da.mes) FILTER (WHERE da.mes IS NOT NULL AND da.mes <= p_mes_limite) AS primeiro_mes
    FROM base b
    LEFT JOIN docs_ano da
      ON da.prestador_id = b.prestador_id
     AND da.loja_id = b.loja_id
    GROUP BY b.prestador_id, b.loja_id
  ),
  meses_por_tipo AS (
    SELECT
      b.prestador_id,
      b.loja_id,
      b.loja_nome,
      t.tipo,
      COALESCE(
        array_agg(DISTINCT da.mes ORDER BY da.mes)
          FILTER (WHERE da.mes IS NOT NULL AND da.mes <= p_mes_limite),
        '{}'::integer[]
      ) AS meses_presentes,
      MIN(da.mes) FILTER (WHERE da.mes IS NOT NULL AND da.mes <= p_mes_limite) AS primeiro_mes
    FROM base b
    CROSS JOIN tipos t
    LEFT JOIN docs_ano da
      ON da.prestador_id = b.prestador_id
     AND da.loja_id = b.loja_id
     AND da.tipo = t.tipo
    GROUP BY b.prestador_id, b.loja_id, b.loja_nome, t.tipo
  ),
  combined AS (
    SELECT
      mpt.prestador_id,
      mpt.loja_id,
      MAX(mpt.loja_nome) AS loja_nome,
      MAX(pe.primeiro_mes) AS primeiro_mes,
      MAX(mpt.primeiro_mes)    FILTER (WHERE mpt.tipo='registro_laudos')      AS pm_laudos,
      MAX(mpt.meses_presentes) FILTER (WHERE mpt.tipo='registro_laudos')      AS mp_laudos,
      MAX(mpt.primeiro_mes)    FILTER (WHERE mpt.tipo='retencao_trabalhista') AS pm_retencao,
      MAX(mpt.meses_presentes) FILTER (WHERE mpt.tipo='retencao_trabalhista') AS mp_retencao
    FROM meses_por_tipo mpt
    JOIN primeiro_envio pe
      ON pe.prestador_id = mpt.prestador_id
     AND pe.loja_id = mpt.loja_id
    GROUP BY mpt.prestador_id, mpt.loja_id
  ),
  com_pendentes AS (
    SELECT
      c.prestador_id,
      c.loja_id,
      c.loja_nome,
      array(
        SELECT DISTINCT v
        FROM unnest(
          COALESCE(c.mp_laudos,'{}'::integer[]) ||
          COALESCE(c.mp_retencao,'{}'::integer[])
        ) v
        ORDER BY v
      ) AS meses_com_documentos,
      COALESCE(c.mp_laudos,'{}'::integer[]) AS meses_com_documentos_laudos,
      COALESCE(c.mp_retencao,'{}'::integer[]) AS meses_com_documentos_retencao,
      CASE WHEN c.primeiro_mes IS NOT NULL THEN
        array(
          SELECT s
          FROM generate_series(c.primeiro_mes, p_mes_limite) s
          WHERE NOT (s = ANY(COALESCE(c.mp_laudos,'{}'::integer[])))
        )
      ELSE '{}'::integer[] END AS meses_pendentes_laudos,
      CASE WHEN c.primeiro_mes IS NOT NULL THEN
        array(
          SELECT s
          FROM generate_series(c.primeiro_mes, p_mes_limite) s
          WHERE NOT (s = ANY(COALESCE(c.mp_retencao,'{}'::integer[])))
        )
      ELSE '{}'::integer[] END AS meses_pendentes_retencao
    FROM combined c
  )
  SELECT
    cp.prestador_id,
    cp.loja_id,
    cp.loja_nome,
    cp.meses_com_documentos,
    cp.meses_com_documentos_laudos,
    cp.meses_com_documentos_retencao,
    array(
      SELECT DISTINCT v
      FROM unnest(cp.meses_pendentes_laudos || cp.meses_pendentes_retencao) v
      ORDER BY v
    ) AS meses_pendentes,
    cp.meses_pendentes_laudos,
    cp.meses_pendentes_retencao
  FROM com_pendentes cp
  WHERE array_length(cp.meses_pendentes_laudos,1) > 0
     OR array_length(cp.meses_pendentes_retencao,1) > 0;
$$;
