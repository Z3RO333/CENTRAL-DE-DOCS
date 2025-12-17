-- Cria a tabela usada pela API de Prestadores.
-- Execute este script no SQL Editor do Supabase (database padrão "postgres").

create extension if not exists "pgcrypto";

create table if not exists public.prestadores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text not null,
  tipo_servico text not null,
  usuarios text[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.prestadores enable row level security;

-- As operações de leitura/escrita são executadas pelo service role através da API,
-- portanto nenhuma policy adicional é necessária para o funcionamento padrão.
