-- Auditoria operacional dos documentos.
-- A tabela e os triggers registram eventos futuros sem alterar os fluxos
-- atuais de upload, assinatura e edicao.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.documentos_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid NOT NULL REFERENCES public.formularios(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid NULL,
  actor_email text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documentos_auditoria_documento_created_idx
  ON public.documentos_auditoria (documento_id, created_at DESC);

CREATE INDEX IF NOT EXISTS documentos_auditoria_event_type_idx
  ON public.documentos_auditoria (event_type);

ALTER TABLE public.documentos_auditoria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documentos_auditoria_select_visible
  ON public.documentos_auditoria;

CREATE POLICY documentos_auditoria_select_visible
  ON public.documentos_auditoria FOR SELECT TO authenticated
  USING (
    public.is_documentos_admin()
    OR EXISTS (
      SELECT 1
      FROM public.formularios f
      WHERE f.id = documentos_auditoria.documento_id
        AND f.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.log_documentos_auditoria_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_email text := auth.email();
  v_old_loja text := NULL;
  v_new_loja text := NULL;
  v_old_prestador text := NULL;
  v_new_prestador text := NULL;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.documentos_auditoria (
      documento_id,
      event_type,
      actor_id,
      actor_email,
      metadata
    )
    VALUES (
      NEW.id,
      'documento_criado',
      COALESCE(v_actor_id, NEW.user_id),
      v_actor_email,
      jsonb_build_object(
        'tipo', NEW.tipo,
        'status', NEW.status,
        'arquivo_path', NEW.arquivo_path
      )
    );

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_loja := NULLIF(BTRIM(COALESCE(OLD.dados->>'loja_id', '')), '');
    v_new_loja := NULLIF(BTRIM(COALESCE(NEW.dados->>'loja_id', '')), '');
    v_old_prestador := COALESCE(OLD.prestador_id::text, '');
    v_new_prestador := COALESCE(NEW.prestador_id::text, '');

    IF OLD.dados IS DISTINCT FROM NEW.dados THEN
      INSERT INTO public.documentos_auditoria (
        documento_id,
        event_type,
        actor_id,
        actor_email,
        metadata
      )
      VALUES (
        NEW.id,
        'documento_editado',
        COALESCE(v_actor_id, NEW.user_id),
        v_actor_email,
        jsonb_build_object('changed', true)
      );
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO public.documentos_auditoria (
        documento_id,
        event_type,
        actor_id,
        actor_email,
        metadata
      )
      VALUES (
        NEW.id,
        'status_alterado',
        COALESCE(v_actor_id, NEW.user_id),
        v_actor_email,
        jsonb_build_object('from', OLD.status, 'to', NEW.status)
      );
    END IF;

    IF v_old_loja IS DISTINCT FROM v_new_loja THEN
      INSERT INTO public.documentos_auditoria (
        documento_id,
        event_type,
        actor_id,
        actor_email,
        metadata
      )
      VALUES (
        NEW.id,
        'loja_alterada',
        COALESCE(v_actor_id, NEW.user_id),
        v_actor_email,
        jsonb_build_object('from', v_old_loja, 'to', v_new_loja)
      );
    END IF;

    IF v_old_prestador IS DISTINCT FROM v_new_prestador THEN
      INSERT INTO public.documentos_auditoria (
        documento_id,
        event_type,
        actor_id,
        actor_email,
        metadata
      )
      VALUES (
        NEW.id,
        'prestador_alterado',
        COALESCE(v_actor_id, NEW.user_id),
        v_actor_email,
        jsonb_build_object(
          'from', NULLIF(v_old_prestador, ''),
          'to', NULLIF(v_new_prestador, '')
        )
      );
    END IF;

    IF (
      OLD.status IS DISTINCT FROM NEW.status
      AND NEW.status = 'assinado'
    )
    OR (
      OLD.arquivo_assinado_path IS NULL
      AND NEW.arquivo_assinado_path IS NOT NULL
    ) THEN
      INSERT INTO public.documentos_auditoria (
        documento_id,
        event_type,
        actor_id,
        actor_email,
        metadata
      )
      VALUES (
        NEW.id,
        'assinado',
        COALESCE(v_actor_id, NEW.user_id),
        COALESCE(v_actor_email, NEW.assinado_por),
        jsonb_build_object('arquivo_assinado_path', NEW.arquivo_assinado_path)
      );
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documentos_auditoria_insert_trigger
  ON public.formularios;

CREATE TRIGGER documentos_auditoria_insert_trigger
  AFTER INSERT ON public.formularios
  FOR EACH ROW
  EXECUTE FUNCTION public.log_documentos_auditoria_trigger();

DROP TRIGGER IF EXISTS documentos_auditoria_update_trigger
  ON public.formularios;

CREATE TRIGGER documentos_auditoria_update_trigger
  AFTER UPDATE ON public.formularios
  FOR EACH ROW
  EXECUTE FUNCTION public.log_documentos_auditoria_trigger();
