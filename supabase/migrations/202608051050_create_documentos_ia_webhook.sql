-- 202608051050_create_documentos_ia_webhook.sql
create extension if not exists pg_net with schema extensions;

create or replace function public.notificar_documentos_ia_processar()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'documentos_ia_webhook_secret'
  limit 1;

  if webhook_secret is null then
    raise warning 'documentos_ia_webhook_secret nao configurado no Vault; pulando notificacao.';
    return new;
  end if;

  perform net.http_post(
    url := 'https://formscentral-frbnd8hxhkhjh5hn.brazilsouth-01.azurewebsites.net/api/documentos/ia/processar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || webhook_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'formularios',
      'record', jsonb_build_object('id', new.id)
    )
  );

  return new;
end;
$$;

revoke all on function public.notificar_documentos_ia_processar() from public, anon, authenticated;

drop trigger if exists documentos_ia_processar_trigger on public.formularios;
create trigger documentos_ia_processar_trigger
  after insert on public.formularios
  for each row
  execute function public.notificar_documentos_ia_processar();
