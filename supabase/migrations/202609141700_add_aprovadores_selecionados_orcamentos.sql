-- Permite direcionar um orcamento a gestores especificos.
-- NULL preserva o comportamento anterior: qualquer gestor cadastrado pode aprovar.
ALTER TABLE public.orcamentos_internos
  ADD COLUMN IF NOT EXISTS aprovadores_emails text[] NULL;

ALTER TABLE public.orcamentos_internos
  DROP CONSTRAINT IF EXISTS orcamentos_internos_aprovadores_emails_not_empty;

ALTER TABLE public.orcamentos_internos
  ADD CONSTRAINT orcamentos_internos_aprovadores_emails_not_empty
  CHECK (aprovadores_emails IS NULL OR cardinality(aprovadores_emails) > 0);

CREATE INDEX IF NOT EXISTS orcamentos_internos_aprovadores_emails_idx
  ON public.orcamentos_internos USING gin (aprovadores_emails);
