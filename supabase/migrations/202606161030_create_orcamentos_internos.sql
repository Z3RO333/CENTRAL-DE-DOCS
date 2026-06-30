-- Fluxo interno de orcamentos: metadados relacionais, versoes e RLS.
-- O registro principal continua em public.formularios com tipo
-- "orcamentos_internos" para compatibilidade com storage/auditoria.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.orcamentos_internos (
  id uuid PRIMARY KEY REFERENCES public.formularios(id) ON DELETE CASCADE,
  solicitante_id uuid NOT NULL,
  solicitante_email text NULL,
  loja_id uuid NULL REFERENCES public.lojas(id),
  loja_nome text NULL,
  area_solicitante text NOT NULL DEFAULT '',
  prestador_id uuid NULL REFERENCES public.prestadores(id),
  prestador_nome text NOT NULL DEFAULT '',
  numero_orcamento text NOT NULL DEFAULT '',
  descricao text NOT NULL DEFAULT '',
  valor_total numeric(14,2) NULL,
  data_validade date NULL,
  numero_referencia text NULL,
  gestor_id uuid NULL,
  gestor_email text NOT NULL DEFAULT '',
  gestor_nome text NULL,
  observacoes text NULL,
  arquivo_original_path text NOT NULL,
  arquivo_assinado_path text NULL,
  status text NOT NULL DEFAULT 'rascunho',
  versao_atual integer NOT NULL DEFAULT 1,
  enviado_em timestamptz NULL,
  aprovado_em timestamptz NULL,
  rejeitado_em timestamptz NULL,
  cancelado_em timestamptz NULL,
  ultima_justificativa text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orcamentos_internos_status_check CHECK (
    status IN (
      'rascunho',
      'aguardando_aprovacao',
      'em_analise_gestor',
      'ajuste_solicitado',
      'reenviado',
      'aprovado_assinado',
      'rejeitado',
      'cancelado'
    )
  )
);

CREATE TABLE IF NOT EXISTS public.orcamentos_internos_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orcamento_id uuid NOT NULL REFERENCES public.orcamentos_internos(id) ON DELETE CASCADE,
  versao integer NOT NULL,
  arquivo_path text NOT NULL,
  nome_arquivo text NOT NULL,
  mime_type text NULL,
  tamanho_bytes bigint NULL,
  principal boolean NOT NULL DEFAULT false,
  criado_por uuid NULL,
  criado_por_email text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS orcamentos_internos_versoes_unique_idx
  ON public.orcamentos_internos_versoes (orcamento_id, versao, arquivo_path);

CREATE INDEX IF NOT EXISTS orcamentos_internos_status_idx
  ON public.orcamentos_internos (status);

CREATE INDEX IF NOT EXISTS orcamentos_internos_solicitante_idx
  ON public.orcamentos_internos (solicitante_id);

CREATE INDEX IF NOT EXISTS orcamentos_internos_gestor_idx
  ON public.orcamentos_internos (gestor_id, gestor_email);

CREATE INDEX IF NOT EXISTS orcamentos_internos_loja_idx
  ON public.orcamentos_internos (loja_id);

CREATE INDEX IF NOT EXISTS orcamentos_internos_prestador_idx
  ON public.orcamentos_internos (prestador_id);

CREATE OR REPLACE FUNCTION public.touch_orcamentos_internos_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orcamentos_internos_touch_updated_at
  ON public.orcamentos_internos;

CREATE TRIGGER orcamentos_internos_touch_updated_at
  BEFORE UPDATE ON public.orcamentos_internos
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_orcamentos_internos_updated_at();

ALTER TABLE public.orcamentos_internos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamentos_internos_versoes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_orcamento_interno_actor(
  p_solicitante_id uuid,
  p_gestor_id uuid,
  p_gestor_email text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    public.is_documentos_admin()
    OR p_solicitante_id = auth.uid()
    OR p_gestor_id = auth.uid()
    OR lower(coalesce(p_gestor_email, '')) = lower(coalesce(auth.email(), ''));
$$;

REVOKE ALL ON FUNCTION public.is_orcamento_interno_actor(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_orcamento_interno_actor(uuid, uuid, text)
  TO anon, authenticated, service_role;

DROP POLICY IF EXISTS orcamentos_internos_select_actor
  ON public.orcamentos_internos;

CREATE POLICY orcamentos_internos_select_actor
  ON public.orcamentos_internos FOR SELECT TO authenticated
  USING (
    public.is_orcamento_interno_actor(solicitante_id, gestor_id, gestor_email)
  );

DROP POLICY IF EXISTS orcamentos_internos_insert_own
  ON public.orcamentos_internos;

CREATE POLICY orcamentos_internos_insert_own
  ON public.orcamentos_internos FOR INSERT TO authenticated
  WITH CHECK (
    solicitante_id = auth.uid()
    AND status = 'rascunho'
  );

DROP POLICY IF EXISTS orcamentos_internos_update_scoped
  ON public.orcamentos_internos;

CREATE POLICY orcamentos_internos_update_scoped
  ON public.orcamentos_internos FOR UPDATE TO authenticated
  USING (
    public.is_documentos_admin()
    OR (
      solicitante_id = auth.uid()
      AND status IN ('rascunho', 'ajuste_solicitado')
    )
    OR gestor_id = auth.uid()
    OR lower(coalesce(gestor_email, '')) = lower(coalesce(auth.email(), ''))
  )
  WITH CHECK (
    public.is_documentos_admin()
    OR solicitante_id = auth.uid()
    OR gestor_id = auth.uid()
    OR lower(coalesce(gestor_email, '')) = lower(coalesce(auth.email(), ''))
  );

DROP POLICY IF EXISTS orcamentos_internos_versoes_select_actor
  ON public.orcamentos_internos_versoes;

CREATE POLICY orcamentos_internos_versoes_select_actor
  ON public.orcamentos_internos_versoes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orcamentos_internos oi
      WHERE oi.id = orcamentos_internos_versoes.orcamento_id
        AND public.is_orcamento_interno_actor(
          oi.solicitante_id,
          oi.gestor_id,
          oi.gestor_email
        )
    )
  );

DROP POLICY IF EXISTS orcamentos_internos_versoes_insert_author
  ON public.orcamentos_internos_versoes;

CREATE POLICY orcamentos_internos_versoes_insert_author
  ON public.orcamentos_internos_versoes FOR INSERT TO authenticated
  WITH CHECK (
    criado_por = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.orcamentos_internos oi
      WHERE oi.id = orcamentos_internos_versoes.orcamento_id
        AND oi.solicitante_id = auth.uid()
        AND oi.status IN ('rascunho', 'ajuste_solicitado')
    )
  );

-- Torna o tipo visivel apenas para os atores internos quando alguem usa a
-- tabela formularios diretamente pelo cliente Supabase.
DROP POLICY IF EXISTS formularios_select_orcamentos_internos_actor
  ON public.formularios;

CREATE POLICY formularios_select_orcamentos_internos_actor
  ON public.formularios FOR SELECT TO authenticated
  USING (
    tipo = 'orcamentos_internos'
    AND EXISTS (
      SELECT 1
      FROM public.orcamentos_internos oi
      WHERE oi.id = formularios.id
        AND public.is_orcamento_interno_actor(
          oi.solicitante_id,
          oi.gestor_id,
          oi.gestor_email
        )
    )
  );
