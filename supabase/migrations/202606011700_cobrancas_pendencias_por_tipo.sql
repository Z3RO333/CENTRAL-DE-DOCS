-- RPC atualizada: retorna pendências separadas por tipo de documento
-- (registro_laudos e retencao_trabalhista), além da visão combinada.
-- Isso permite que o e-mail mostre "Laudo faltando" vs "Retenção não enviada"
-- por loja, em vez de apenas os meses genéricos.

CREATE OR REPLACE FUNCTION public.cobrancas_pendencias_ano(
  p_ano        integer,
  p_mes_limite integer DEFAULT 12
)
RETURNS TABLE (
  prestador_id             uuid,
  loja_id                  text,
  loja_nome                text,
  meses_com_documentos     integer[],
  meses_pendentes          integer[],
  meses_pendentes_laudos   integer[],
  meses_pendentes_retencao integer[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  base_por_tipo AS (
    SELECT f.prestador_id, f.dados->>'loja_id' AS loja_id,
           MAX(f.dados->>'loja_nome') AS loja_nome, f.tipo
    FROM formularios f
    WHERE f.prestador_id IS NOT NULL AND f.dados->>'loja_id' IS NOT NULL
      AND f.dados->>'loja_id' <> '' AND f.tipo IN ('registro_laudos','retencao_trabalhista')
    GROUP BY f.prestador_id, f.dados->>'loja_id', f.tipo
    HAVING count(*) > 1
  ),
  docs_ano AS (
    SELECT f.prestador_id, f.dados->>'loja_id' AS loja_id, f.tipo,
           EXTRACT(MONTH FROM (f.created_at AT TIME ZONE 'America/Manaus'))::integer AS mes
    FROM formularios f
    WHERE f.prestador_id IS NOT NULL AND f.dados->>'loja_id' IS NOT NULL
      AND f.tipo IN ('registro_laudos','retencao_trabalhista')
      AND (f.created_at AT TIME ZONE 'America/Manaus') >= make_timestamp(p_ano,1,1,0,0,0)
      AND (f.created_at AT TIME ZONE 'America/Manaus') <  make_timestamp(p_ano+1,1,1,0,0,0)
  ),
  meses_por_tipo AS (
    SELECT b.prestador_id, b.loja_id, b.loja_nome, b.tipo,
           COALESCE(array_agg(DISTINCT da.mes ORDER BY da.mes)
             FILTER (WHERE da.mes IS NOT NULL AND da.mes <= p_mes_limite), '{}'::integer[]) AS meses_presentes,
           MIN(da.mes) FILTER (WHERE da.mes IS NOT NULL AND da.mes <= p_mes_limite) AS primeiro_mes
    FROM base_por_tipo b
    LEFT JOIN docs_ano da ON da.prestador_id=b.prestador_id AND da.loja_id=b.loja_id AND da.tipo=b.tipo
    GROUP BY b.prestador_id, b.loja_id, b.loja_nome, b.tipo
  ),
  combined AS (
    SELECT prestador_id, loja_id, MAX(loja_nome) AS loja_nome,
           MAX(primeiro_mes)    FILTER (WHERE tipo='registro_laudos')      AS pm_laudos,
           MAX(meses_presentes) FILTER (WHERE tipo='registro_laudos')      AS mp_laudos,
           MAX(primeiro_mes)    FILTER (WHERE tipo='retencao_trabalhista') AS pm_retencao,
           MAX(meses_presentes) FILTER (WHERE tipo='retencao_trabalhista') AS mp_retencao
    FROM meses_por_tipo GROUP BY prestador_id, loja_id
  ),
  com_pendentes AS (
    SELECT c.prestador_id, c.loja_id, c.loja_nome,
      array(SELECT DISTINCT v FROM unnest(COALESCE(c.mp_laudos,'{}'::integer[])||COALESCE(c.mp_retencao,'{}'::integer[])) v ORDER BY v) AS meses_com_documentos,
      CASE WHEN c.pm_laudos IS NOT NULL THEN
        array(SELECT s FROM generate_series(c.pm_laudos,p_mes_limite) s WHERE NOT (s=ANY(COALESCE(c.mp_laudos,'{}'::integer[]))))
      ELSE '{}'::integer[] END AS meses_pendentes_laudos,
      CASE WHEN c.pm_retencao IS NOT NULL THEN
        array(SELECT s FROM generate_series(c.pm_retencao,p_mes_limite) s WHERE NOT (s=ANY(COALESCE(c.mp_retencao,'{}'::integer[]))))
      ELSE '{}'::integer[] END AS meses_pendentes_retencao
    FROM combined c
  )
  SELECT cp.prestador_id, cp.loja_id, cp.loja_nome, cp.meses_com_documentos,
    array(SELECT DISTINCT v FROM unnest(cp.meses_pendentes_laudos||cp.meses_pendentes_retencao) v ORDER BY v) AS meses_pendentes,
    cp.meses_pendentes_laudos, cp.meses_pendentes_retencao
  FROM com_pendentes cp
  WHERE array_length(cp.meses_pendentes_laudos,1)>0 OR array_length(cp.meses_pendentes_retencao,1)>0;
$$;
