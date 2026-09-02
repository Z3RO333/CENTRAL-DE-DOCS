-- supabase/migrations/202609021300_busca_hibrida_rpc.sql
-- Fase 3: RPC de busca hibrida com fusao RRF (Reciprocal Rank Fusion).
-- Recebe um allowlist de documento_ids ja autorizado pela camada TypeScript
-- (buildDocumentosAccessOr). NAO decide permissao — nao enxerga nada fora do allowlist.

create or replace function public.buscar_chunks_hibrido(
  p_documento_ids uuid[],
  p_embedding extensions.vector(1536),
  p_consulta_texto text,
  p_limite int default 20
) returns table (
  documento_id uuid,
  rrf_score float8,
  melhor_trecho text,
  pagina integer,
  n_trechos_relevantes integer
)
language sql
security definer
set search_path = public, extensions
as $$
  with
    -- Apenas chunks dentro do allowlist com embedding preenchido
    chunks_no_escopo as (
      select
        c.id,
        c.documento_id,
        c.texto,
        c.pagina,
        c.embedding,
        c.texto_tsv
      from public.documento_chunks c
      where c.documento_id = any(p_documento_ids)
        and c.embedding is not null
    ),
    -- Ranking vetorial: todos os chunks, ordenados por distancia de cosseno
    rank_vector as (
      select
        id,
        row_number() over (order by embedding <=> p_embedding) as rank_v
      from chunks_no_escopo
    ),
    -- Ranking textual: apenas chunks que casam com a query FTS
    tsq as (
      select websearch_to_tsquery('portuguese', p_consulta_texto) as q
    ),
    rank_texto as (
      select
        c.id,
        row_number() over (
          order by ts_rank_cd(c.texto_tsv, tsq.q) desc
        ) as rank_t
      from chunks_no_escopo c
      cross join tsq
      where c.texto_tsv @@ tsq.q
    ),
    -- Fusao RRF: score = 1/(60+rank_v) + 1/(60+rank_t)
    -- Chunks sem match FTS recebem rank_t = 1000 (contribuicao quase nula)
    fusao as (
      select
        c.documento_id,
        c.texto,
        c.pagina,
        1.0 / (60.0 + rv.rank_v) +
        1.0 / (60.0 + coalesce(rt.rank_t, 1000)) as rrf_chunk_score
      from chunks_no_escopo c
      join rank_vector rv on rv.id = c.id
      left join rank_texto rt on rt.id = c.id
    ),
    -- Agregacao por documento: melhor trecho + contagem de trechos relevantes
    por_documento as (
      select
        f.documento_id,
        max(f.rrf_chunk_score) as rrf_score,
        (array_agg(f.texto order by f.rrf_chunk_score desc))[1] as melhor_trecho,
        (array_agg(f.pagina order by f.rrf_chunk_score desc))[1] as pagina,
        count(*)::integer as n_trechos_relevantes
      from fusao f
      group by f.documento_id
    )
  select
    pd.documento_id,
    pd.rrf_score,
    pd.melhor_trecho,
    pd.pagina::integer,
    pd.n_trechos_relevantes
  from por_documento pd
  order by pd.rrf_score desc
  limit p_limite;
$$;

-- Bloquear acesso direto — toda chamada passa pelo supabaseAdmin na camada de API
revoke all on function public.buscar_chunks_hibrido(uuid[], extensions.vector, text, int)
  from public, anon, authenticated;
