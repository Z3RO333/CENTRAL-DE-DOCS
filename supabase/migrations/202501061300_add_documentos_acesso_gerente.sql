alter table public.documentos_acesso
  add column if not exists scope text not null default 'admin',
  add column if not exists loja_id uuid,
  add column if not exists prestador_id uuid,
  add column if not exists can_view_all boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'documentos_acesso'
      and constraint_name = 'documentos_acesso_scope_check'
  ) then
    alter table public.documentos_acesso
      add constraint documentos_acesso_scope_check
      check (scope in ('admin', 'gerente'));
  end if;
end $$;

alter table public.documentos_acesso
  add constraint if not exists documentos_acesso_loja_id_fkey
  foreign key (loja_id) references public.lojas (id) on delete cascade;

alter table public.documentos_acesso
  add constraint if not exists documentos_acesso_prestador_id_fkey
  foreign key (prestador_id) references public.prestadores (id) on delete cascade;

create index if not exists documentos_acesso_scope_idx
  on public.documentos_acesso (scope);

create index if not exists documentos_acesso_loja_idx
  on public.documentos_acesso (loja_id);

create index if not exists documentos_acesso_prestador_idx
  on public.documentos_acesso (prestador_id);

create index if not exists documentos_acesso_user_scope_idx
  on public.documentos_acesso (user_id, scope);

create index if not exists documentos_acesso_email_scope_idx
  on public.documentos_acesso (email, scope);
