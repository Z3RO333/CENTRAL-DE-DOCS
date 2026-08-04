-- 202607311600_create_documento_recomendacoes_criticas.sql
create table public.documento_recomendacoes_criticas (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.formularios(id) on delete cascade,
  equipamento_id uuid references public.equipamentos(id) on delete set null,
  loja_id uuid,
  tipo_documento text not null,
  competencia text,
  trecho text not null,
  pagina integer,
  problema text not null,
  componente text,
  recomendacao_tecnica text not null,
  impacto text,
  acao_necessaria text not null,
  prioridade text not null check (
    prioridade in ('emergencial', 'critica', 'alta', 'moderada', 'preventiva', 'informativa')
  ),
  prazo_dias integer,
  desligar_equipamento boolean not null default false,
  substituir_peca boolean not null default false,
  precisa_inspecao_presencial boolean not null default false,
  abrir_ordem_corretiva boolean not null default false,
  riscos text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index documento_recomendacoes_criticas_documento_id_idx
  on public.documento_recomendacoes_criticas(documento_id);

create index documento_recomendacoes_criticas_equipamento_id_idx
  on public.documento_recomendacoes_criticas(equipamento_id)
  where equipamento_id is not null;

alter table public.documento_recomendacoes_criticas enable row level security;
-- Sem policies: controle de acesso inteiramente na camada da API (mesmo padrao
-- de formularios/equipamentos/documentos_analises_ia), acessado so via
-- supabaseAdmin (service role) no servidor.

revoke all on public.documento_recomendacoes_criticas from public, anon, authenticated;
