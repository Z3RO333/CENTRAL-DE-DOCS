-- Adiciona categoria estruturada ao prestador, para separar empresas
-- conservadoras (ex.: JanPro) dos demais fornecedores sem depender do
-- texto livre em tipo_servico.
alter table public.prestadores
  add column if not exists categoria text not null default 'outro';

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'prestadores'
      and constraint_name = 'prestadores_categoria_check'
  ) then
    alter table public.prestadores drop constraint prestadores_categoria_check;
  end if;

  alter table public.prestadores
    add constraint prestadores_categoria_check
    check (categoria in ('conservacao', 'outro'));
end $$;
