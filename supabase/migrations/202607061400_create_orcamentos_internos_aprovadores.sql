-- Aprovadores fixos para orcamentos internos: qualquer um deles pode
-- decidir (aprovar/rejeitar/pedir ajuste) qualquer orcamento pendente,
-- independente de qual gestor foi originalmente atribuido ao registro.

CREATE TABLE IF NOT EXISTS public.orcamentos_internos_aprovadores (
  email text PRIMARY KEY,
  nome text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.orcamentos_internos_aprovadores (email, nome) VALUES
  ('jacenira@bemol.com.br', 'Jacenira Barroso'),
  ('walterrodrigues@bemol.com.br', 'Walter Rodrigues'),
  ('danieldamasceno@bemol.com.br', 'Daniel Damasceno')
ON CONFLICT (email) DO NOTHING;

ALTER TABLE public.orcamentos_internos_aprovadores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orcamentos_internos_aprovadores_select_admin
  ON public.orcamentos_internos_aprovadores;

CREATE POLICY orcamentos_internos_aprovadores_select_admin
  ON public.orcamentos_internos_aprovadores FOR SELECT TO authenticated
  USING (public.is_documentos_admin());

CREATE OR REPLACE FUNCTION public.is_orcamento_interno_aprovador(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orcamentos_internos_aprovadores a
    WHERE lower(a.email) = lower(coalesce(p_email, ''))
  );
$$;

REVOKE ALL ON FUNCTION public.is_orcamento_interno_aprovador(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_orcamento_interno_aprovador(text)
  TO anon, authenticated, service_role;

-- is_orcamento_interno_actor ja e usada pelas policies de SELECT de
-- orcamentos_internos, orcamentos_internos_versoes e formularios;
-- redefini-la basta para propagar a visibilidade aos aprovadores fixos.
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
    OR lower(coalesce(p_gestor_email, '')) = lower(coalesce(auth.email(), ''))
    OR public.is_orcamento_interno_aprovador(auth.email());
$$;

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
    OR public.is_orcamento_interno_aprovador(auth.email())
  )
  WITH CHECK (
    public.is_documentos_admin()
    OR solicitante_id = auth.uid()
    OR gestor_id = auth.uid()
    OR lower(coalesce(gestor_email, '')) = lower(coalesce(auth.email(), ''))
    OR public.is_orcamento_interno_aprovador(auth.email())
  );
