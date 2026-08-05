alter table public.documento_recomendacoes_criticas
  add constraint documento_recomendacoes_criticas_loja_id_fkey
  foreign key (loja_id) references public.lojas (id) on delete set null;
