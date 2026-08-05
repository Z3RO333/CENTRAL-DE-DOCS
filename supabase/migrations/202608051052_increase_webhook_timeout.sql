-- 202608051052_increase_webhook_timeout.sql
-- Achado na verificacao ao vivo da Task 11: net.http_post usa 5000ms de
-- timeout por padrao, mas a analise (OCR + Azure OpenAI) pode levar bem
-- mais que isso. O processamento server-side completa normalmente mesmo
-- apos o timeout do lado do Postgres (o Next.js nao aborta a requisicao
-- so porque o cliente parou de esperar), mas cada disparo real do webhook
-- fica registrado como erro de timeout em net._http_response, o que
-- polui logs e dificulta diagnostico de falhas reais. Aumenta o timeout
-- para 30s, alinhado ao tempo esperado de OCR ja documentado no spec
-- original do sub-projeto 1.
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
    ),
    timeout_milliseconds := 30000
  );

  return new;
end;
$$;
