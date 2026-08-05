-- 202608051020_status_constraints_cleanup.sql
alter table public.documentos_analises_ia
  add constraint documentos_analises_ia_status_check
  check (status in ('concluida', 'erro'));

alter table public.formularios
  drop constraint if exists formularios_status_analise_ia_check;

alter table public.formularios
  add constraint formularios_status_analise_ia_check
  check (status_analise_ia in (
    'recebido', 'em_analise', 'concluida', 'necessita_revisao', 'erro', 'duplicado'
  ));
