-- Agregacoes usadas pelas APIs de documentos.
-- Reduz leitura paginada de formularios nas funcoes da Vercel.

create index if not exists formularios_created_at_idx
  on public.formularios (created_at desc);

create index if not exists formularios_status_idx
  on public.formularios (status);

create index if not exists formularios_tipo_idx
  on public.formularios (tipo);

create index if not exists formularios_user_id_idx
  on public.formularios (user_id);

create index if not exists formularios_loja_id_expr_idx
  on public.formularios ((dados->>'loja_id'));

create index if not exists formularios_tipo_laudo_expr_idx
  on public.formularios ((dados->>'tipo_laudo'));

create or replace function public.documentos_filter_options_agg(
  p_user_id text default null,
  p_prestador_ids uuid[] default null,
  p_loja_ids text[] default null
)
returns table (
  anos int[],
  status text[],
  tipo_laudo text[]
)
language sql
stable
as $$
  with filtered as (
    select
      extract(year from f.created_at)::int as ano,
      f.status,
      nullif(btrim(f.dados->>'tipo_laudo'), '') as tipo_laudo
    from public.formularios f
    where (p_user_id is null or f.user_id::text = p_user_id)
      and (
        p_prestador_ids is null
        or cardinality(p_prestador_ids) = 0
        or f.prestador_id = any(p_prestador_ids)
      )
      and (
        p_loja_ids is null
        or cardinality(p_loja_ids) = 0
        or f.dados->>'loja_id' = any(p_loja_ids)
      )
  )
  select
    coalesce(
      array(select distinct ano from filtered where ano is not null order by ano desc),
      '{}'::int[]
    ) as anos,
    coalesce(
      array(select distinct status from filtered where status is not null order by status),
      '{}'::text[]
    ) as status,
    coalesce(
      array(select distinct tipo_laudo from filtered where tipo_laudo is not null order by tipo_laudo),
      '{}'::text[]
    ) as tipo_laudo;
$$;

create or replace function public.documentos_lojas_agg(
  p_user_id text default null,
  p_prestador_ids uuid[] default null,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null
)
returns table (
  loja_id text,
  total_documentos bigint,
  ultimo_envio_at timestamptz
)
language sql
stable
as $$
  select
    f.dados->>'loja_id' as loja_id,
    count(*) as total_documentos,
    max(f.created_at) as ultimo_envio_at
  from public.formularios f
  where nullif(btrim(f.dados->>'loja_id'), '') is not null
    and (p_user_id is null or f.user_id::text = p_user_id)
    and (
      p_prestador_ids is null
      or cardinality(p_prestador_ids) = 0
      or f.prestador_id = any(p_prestador_ids)
    )
    and (p_start_at is null or f.created_at >= p_start_at)
    and (p_end_at is null or f.created_at < p_end_at)
  group by f.dados->>'loja_id';
$$;

create or replace function public.documentos_subpastas_agg(
  p_loja_id text,
  p_user_id text default null,
  p_prestador_ids uuid[] default null,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null
)
returns table (
  tipo text,
  tipo_laudo text,
  total_documentos bigint,
  ultimo_envio_at timestamptz
)
language sql
stable
as $$
  select
    f.tipo,
    nullif(btrim(f.dados->>'tipo_laudo'), '') as tipo_laudo,
    count(*) as total_documentos,
    max(f.created_at) as ultimo_envio_at
  from public.formularios f
  where f.dados->>'loja_id' = p_loja_id
    and (p_user_id is null or f.user_id::text = p_user_id)
    and (
      p_prestador_ids is null
      or cardinality(p_prestador_ids) = 0
      or f.prestador_id = any(p_prestador_ids)
    )
    and (p_start_at is null or f.created_at >= p_start_at)
    and (p_end_at is null or f.created_at < p_end_at)
  group by f.tipo, nullif(btrim(f.dados->>'tipo_laudo'), '');
$$;
