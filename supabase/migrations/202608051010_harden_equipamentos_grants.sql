-- 202608051010_harden_equipamentos_grants.sql
revoke all on public.equipamentos from anon, authenticated;

create or replace function public.touch_equipamentos_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
