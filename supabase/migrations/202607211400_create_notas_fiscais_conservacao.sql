-- Cadastro estruturado de notas fiscais de empresas conservadoras,
-- substituindo o controle manual em planilha. Segue o mesmo padrao de
-- duas camadas usado em orcamentos_internos: o id desta tabela e o
-- mesmo id do registro espelho em public.formularios (tipo
-- 'notas_fiscais_conservacao'), reaproveitando storage/signed-urls.

create table if not exists public.notas_fiscais_conservacao (
  id uuid primary key references public.formularios(id) on delete cascade,
  prestador_id uuid not null references public.prestadores(id),
  loja_id uuid not null references public.lojas(id),
  numero_nf text not null,
  numero_pedido text,
  valor numeric,
  competencia text,
  data_recebimento date not null,
  observacoes text,
  status text not null default 'aguardando_verificacao'
    check (status in ('aguardando_verificacao', 'concluida', 'rejeitada')),
  motivo_status text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prestador_id, numero_nf)
);

create index if not exists notas_fiscais_conservacao_prestador_idx
  on public.notas_fiscais_conservacao (prestador_id);

create index if not exists notas_fiscais_conservacao_loja_idx
  on public.notas_fiscais_conservacao (loja_id);

create index if not exists notas_fiscais_conservacao_status_idx
  on public.notas_fiscais_conservacao (status);

create or replace function public.touch_notas_fiscais_conservacao_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notas_fiscais_conservacao_touch_updated_at
  on public.notas_fiscais_conservacao;

create trigger notas_fiscais_conservacao_touch_updated_at
  before update on public.notas_fiscais_conservacao
  for each row
  execute function public.touch_notas_fiscais_conservacao_updated_at();

alter table public.notas_fiscais_conservacao enable row level security;

-- As operacoes de leitura/escrita sao executadas pelo service role atraves
-- da API (/api/notas-fiscais-conservacao), portanto nenhuma policy adicional
-- e necessaria, seguindo o mesmo padrao de public.prestadores.
