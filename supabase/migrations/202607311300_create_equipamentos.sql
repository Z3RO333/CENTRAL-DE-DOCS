create table if not exists public.equipamentos (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas (id) on delete cascade,
  tipo_equipamento text not null,
  identificacao text,
  marca text,
  modelo text,
  numero_serie text,
  potencia text,
  localizacao text,
  prestador_id uuid references public.prestadores (id) on delete set null,
  documento_tipo_obrigatorio text,
  data_instalacao date,
  data_ativacao date,
  data_desativacao date,
  status text not null default 'ativo' check (status in ('ativo', 'inativo')),
  atributos jsonb not null default '{}'::jsonb,
  origem_importacao text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists equipamentos_loja_id_idx on public.equipamentos (loja_id);
create index if not exists equipamentos_status_idx on public.equipamentos (status);
create index if not exists equipamentos_tipo_equipamento_idx on public.equipamentos (tipo_equipamento);

alter table public.equipamentos enable row level security;
-- Mesmo padrão de public.prestadores: acesso só via service role pela API,
-- nenhuma policy adicional é necessária para o funcionamento padrão.

create or replace function public.touch_equipamentos_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists equipamentos_touch_updated_at on public.equipamentos;
create trigger equipamentos_touch_updated_at
  before update on public.equipamentos
  for each row
  execute function public.touch_equipamentos_updated_at();
