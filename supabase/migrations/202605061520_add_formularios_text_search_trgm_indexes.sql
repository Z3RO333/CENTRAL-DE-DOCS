-- Melhora buscas textuais da Central de Documentos.
-- Mantem as queries atuais com ILIKE, mas adiciona indices trigram nos campos
-- mais usados pelos filtros globais.

create extension if not exists pg_trgm;

create index if not exists formularios_empresa_trgm_idx
  on public.formularios using gin ((dados->>'empresa') gin_trgm_ops);

create index if not exists formularios_prestador_trgm_idx
  on public.formularios using gin ((dados->>'prestador') gin_trgm_ops);

create index if not exists formularios_responsavel_trgm_idx
  on public.formularios using gin ((dados->>'responsavel') gin_trgm_ops);

create index if not exists formularios_numero_pedido_trgm_idx
  on public.formularios using gin ((dados->>'numero_pedido') gin_trgm_ops);

create index if not exists formularios_numero_nf_trgm_idx
  on public.formularios using gin ((dados->>'numero_nf') gin_trgm_ops);

create index if not exists formularios_cnpj_trgm_idx
  on public.formularios using gin ((dados->>'cnpj') gin_trgm_ops);

create index if not exists formularios_cnpj_emitente_trgm_idx
  on public.formularios using gin ((dados->>'cnpj_emitente') gin_trgm_ops);

create index if not exists formularios_descricao_trgm_idx
  on public.formularios using gin ((dados->>'descricao') gin_trgm_ops);

create index if not exists formularios_observacoes_trgm_idx
  on public.formularios using gin ((dados->>'observacoes') gin_trgm_ops);

create index if not exists formularios_tipo_laudo_trgm_idx
  on public.formularios using gin ((dados->>'tipo_laudo') gin_trgm_ops);

create index if not exists formularios_loja_nome_trgm_idx
  on public.formularios using gin ((dados->>'loja_nome') gin_trgm_ops);

create index if not exists formularios_primeiro_anexo_nome_trgm_idx
  on public.formularios using gin ((dados #>> '{anexos,0,nome}') gin_trgm_ops);

create index if not exists formularios_arquivo_path_trgm_idx
  on public.formularios using gin (arquivo_path gin_trgm_ops);

create index if not exists formularios_arquivo_assinado_path_trgm_idx
  on public.formularios using gin (arquivo_assinado_path gin_trgm_ops);
