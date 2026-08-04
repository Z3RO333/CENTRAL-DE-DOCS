ALTER TABLE public.equipamentos
  ADD COLUMN frequencia text NOT NULL DEFAULT 'mensal'
  CHECK (frequencia IN ('mensal', 'semestral', 'anual'));

CREATE OR REPLACE FUNCTION public.equipamentos_pendencias_ano(
  p_ano        integer,
  p_mes_limite integer DEFAULT 12
)
RETURNS TABLE (
  equipamento_id       uuid,
  loja_id              uuid,
  loja_nome            text,
  tipo_equipamento     text,
  identificacao        text,
  frequencia           text,
  meses_com_documentos integer[],
  meses_pendentes      integer[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH equip AS (
    SELECT
      e.id AS equipamento_id,
      e.loja_id,
      l.nome AS loja_nome,
      e.tipo_equipamento,
      e.identificacao,
      e.frequencia,
      COALESCE(e.data_ativacao, e.data_instalacao, e.created_at::date) AS inicio
    FROM public.equipamentos e
    JOIN public.lojas l ON l.id = e.loja_id
    WHERE e.status = 'ativo'
  ),
  meses_devidos AS (
    SELECT eq.equipamento_id, s.mes
    FROM equip eq
    CROSS JOIN generate_series(1, p_mes_limite) AS s(mes)
    WHERE
      (eq.frequencia = 'mensal'
       OR (eq.frequencia = 'semestral' AND s.mes IN (6, 12))
       OR (eq.frequencia = 'anual' AND s.mes = 12))
      AND make_date(p_ano, s.mes, 1) >= date_trunc('month', eq.inicio)::date
  ),
  docs_ano AS (
    SELECT
      f.equipamento_id,
      split_part(f.dados->>'competencia', '/', 1)::integer AS mes
    FROM public.formularios f
    WHERE f.equipamento_id IS NOT NULL
      AND f.dados->>'competencia' ~ '^(0?[1-9]|1[0-2])/[0-9]{4}$'
      AND split_part(f.dados->>'competencia', '/', 2)::integer = p_ano
  )
  SELECT
    eq.equipamento_id,
    eq.loja_id,
    eq.loja_nome,
    eq.tipo_equipamento,
    eq.identificacao,
    eq.frequencia,
    COALESCE(
      array(
        SELECT DISTINCT da.mes
        FROM docs_ano da
        WHERE da.equipamento_id = eq.equipamento_id
        ORDER BY da.mes
      ),
      '{}'::integer[]
    ) AS meses_com_documentos,
    COALESCE(
      array(
        SELECT DISTINCT md.mes
        FROM meses_devidos md
        WHERE md.equipamento_id = eq.equipamento_id
          AND NOT EXISTS (
            SELECT 1 FROM docs_ano da2
            WHERE da2.equipamento_id = eq.equipamento_id AND da2.mes = md.mes
          )
        ORDER BY md.mes
      ),
      '{}'::integer[]
    ) AS meses_pendentes
  FROM equip eq
  WHERE EXISTS (
    SELECT 1
    FROM meses_devidos md
    WHERE md.equipamento_id = eq.equipamento_id
      AND NOT EXISTS (
        SELECT 1 FROM docs_ano da3
        WHERE da3.equipamento_id = eq.equipamento_id AND da3.mes = md.mes
      )
  );
$$;
