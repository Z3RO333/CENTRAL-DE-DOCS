-- Diagnóstico de documentos (formularios)
-- Execute no SQL Editor do Supabase

-- Visão geral do volume e intervalo de datas
select
  count(*) as total,
  min(created_at) as mais_antigo,
  max(created_at) as mais_recente
from public.formularios;

-- Exemplo: documentos em Fevereiro/2026
select
  count(*) as total_fev_2026
from public.formularios
where created_at >= '2026-02-01'::timestamptz
  and created_at <  '2026-03-01'::timestamptz;

-- Opcional: agrupar por mês (últimos 12 meses)
select
  date_trunc('month', created_at) as mes,
  count(*) as total
from public.formularios
where created_at >= (now() - interval '12 months')
group by 1
order by 1 desc;

-- Opcional: tipos mais comuns
select
  tipo,
  count(*) as total
from public.formularios
group by 1
order by 2 desc;
