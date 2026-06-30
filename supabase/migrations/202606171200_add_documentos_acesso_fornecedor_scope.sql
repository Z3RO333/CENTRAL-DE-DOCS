-- Adiciona o scope 'fornecedor': usuario independente de prestador, com acesso
-- de visualizacao total aos documentos de lojas/locais especificos atribuidos
-- (ex: ver apenas documentos do CD). Reaproveita as mesmas colunas usadas por
-- 'gerente' (loja_id, prestador_id, can_view_all), sempre com can_view_all=true.
do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'documentos_acesso'
      and constraint_name = 'documentos_acesso_scope_check'
  ) then
    alter table public.documentos_acesso
      drop constraint documentos_acesso_scope_check;
  end if;

  alter table public.documentos_acesso
    add constraint documentos_acesso_scope_check
    check (scope in ('admin', 'gerente', 'fornecedor'));
end $$;
