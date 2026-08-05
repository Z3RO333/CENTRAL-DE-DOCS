create index if not exists equipamentos_prestador_id_idx
  on public.equipamentos (prestador_id);

create index if not exists documento_recomendacoes_criticas_prioridade_idx
  on public.documento_recomendacoes_criticas (prioridade)
  where prioridade in ('emergencial', 'critica');
