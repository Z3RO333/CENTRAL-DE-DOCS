-- Busca semantica (Fase 1): texto extraido dos documentos e trechos vetorizados.
-- Acesso exclusivamente via supabaseAdmin na camada de API (padrao do projeto).

create extension if not exists vector with schema extensions;

create table public.documento_conteudo (
  documento_id uuid primary key references public.formularios(id) on delete cascade,
  texto text not null default '',
  origem text not null check (origem in ('ocr', 'pdf_texto', 'nao_aplicavel')),
  paginas integer,
  arquivo_hash text,
  caracteres integer not null default 0,
  indexado_em timestamptz,
  erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documento_conteudo_indexado_em_idx
  on public.documento_conteudo (indexado_em);

create table public.documento_chunks (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.formularios(id) on delete cascade,
  ordem integer not null,
  pagina integer,
  texto text not null,
  embedding vector(1536),
  -- Colunas desnormalizadas: permitem filtrar no mesmo WHERE da busca vetorial,
  -- sem join com formularios. Reescritas a cada reindexacao do documento.
  loja_id text,
  tipo text,
  competencia text,
  equipamento_id uuid,
  prestador_id uuid,
  documento_created_at timestamptz,
  texto_tsv tsvector generated always as (to_tsvector('portuguese', texto)) stored,
  created_at timestamptz not null default now(),
  unique (documento_id, ordem)
);

-- HNSW nao exige treino previo (funciona com a tabela vazia) e nao precisa ser
-- recriado depois do backfill. Requer pgvector >= 0.5.
create index documento_chunks_embedding_idx
  on public.documento_chunks using hnsw (embedding vector_cosine_ops);

create index documento_chunks_tsv_idx
  on public.documento_chunks using gin (texto_tsv);
create index documento_chunks_documento_idx
  on public.documento_chunks (documento_id);
create index documento_chunks_loja_idx on public.documento_chunks (loja_id);
create index documento_chunks_tipo_idx on public.documento_chunks (tipo);
create index documento_chunks_equipamento_idx
  on public.documento_chunks (equipamento_id);

alter table public.documento_conteudo enable row level security;
alter table public.documento_chunks enable row level security;

revoke all on public.documento_conteudo from public, anon, authenticated;
revoke all on public.documento_chunks from public, anon, authenticated;
