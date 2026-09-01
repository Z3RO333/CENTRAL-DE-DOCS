create table public.assistente_conversas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  mensagens jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now(),
  criado_em timestamptz not null default now()
);

alter table public.assistente_conversas enable row level security;

create policy "usuario le sua conversa"
  on public.assistente_conversas for select
  using (auth.uid() = user_id);

create policy "usuario escreve sua conversa"
  on public.assistente_conversas for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.assistente_conversas from public, anon, authenticated;
