-- Guarda o CNPJ identificado no PDF do orçamento para facilitar a
-- conferência e o vínculo automático com o cadastro de prestadores.

alter table public.orcamentos_internos
  add column if not exists fornecedor_cnpj text null;

create index if not exists orcamentos_internos_fornecedor_cnpj_idx
  on public.orcamentos_internos (fornecedor_cnpj);
