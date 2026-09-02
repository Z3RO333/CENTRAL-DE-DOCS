-- Busca semantica (Fase 2): taxonomia de assuntos/equipamentos, com fila de
-- sugestoes para aprovacao antes de qualquer termo novo valer para busca.
-- Acesso exclusivamente via supabaseAdmin na camada de API (padrao do projeto).

create table public.taxonomia_termos (
  id uuid primary key default gen_random_uuid(),
  termo text not null unique,
  categoria text not null,
  tipo text not null check (tipo in ('assunto', 'equipamento')),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.taxonomia_sinonimos (
  id uuid primary key default gen_random_uuid(),
  termo_id uuid not null references public.taxonomia_termos(id) on delete cascade,
  variacao text not null,
  origem text not null check (origem in ('semente', 'aprovado')),
  created_at timestamptz not null default now(),
  unique (variacao)
);

create index taxonomia_sinonimos_termo_id_idx
  on public.taxonomia_sinonimos (termo_id);

create table public.taxonomia_sugestoes (
  id uuid primary key default gen_random_uuid(),
  variacao text not null,
  termo_sugerido text,
  categoria_sugerida text,
  documento_id uuid references public.formularios(id) on delete set null,
  trecho text,
  ocorrencias integer not null default 1,
  status text not null default 'pendente'
    check (status in ('pendente', 'aprovada', 'rejeitada')),
  revisado_por uuid references auth.users(id) on delete set null,
  revisado_em timestamptz,
  created_at timestamptz not null default now(),
  unique (variacao)
);

create index taxonomia_sugestoes_status_idx
  on public.taxonomia_sugestoes (status);

alter table public.documento_conteudo
  add column termos text[] not null default '{}'::text[];
alter table public.documento_conteudo
  add column termos_classificado_em timestamptz;

create index documento_conteudo_termos_idx
  on public.documento_conteudo using gin (termos);
create index documento_conteudo_termos_classificado_em_idx
  on public.documento_conteudo (termos_classificado_em);

alter table public.taxonomia_termos enable row level security;
alter table public.taxonomia_sinonimos enable row level security;
alter table public.taxonomia_sugestoes enable row level security;

revoke all on public.taxonomia_termos from public, anon, authenticated;
revoke all on public.taxonomia_sinonimos from public, anon, authenticated;
revoke all on public.taxonomia_sugestoes from public, anon, authenticated;
