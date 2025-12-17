alter table public.formularios
  add column if not exists prestador_id uuid references public.prestadores(id) on delete set null;

create index if not exists formularios_prestador_id_idx
  on public.formularios (prestador_id);
