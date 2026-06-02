CREATE TABLE IF NOT EXISTS public.documentos_analises_ia (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid        NOT NULL REFERENCES public.formularios(id) ON DELETE CASCADE,
  provider      text        NOT NULL DEFAULT 'openai',
  model         text        NOT NULL,
  status        text        NOT NULL DEFAULT 'concluida',
  resultado     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  erro          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documentos_analises_ia_documento_created_idx
  ON public.documentos_analises_ia (documento_id, created_at DESC);

ALTER TABLE public.documentos_analises_ia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documentos_analises_ia_select_visible
  ON public.documentos_analises_ia;

CREATE POLICY documentos_analises_ia_select_visible
  ON public.documentos_analises_ia FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.formularios f
      WHERE f.id = documentos_analises_ia.documento_id
        AND (
          f.user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.documentos_acesso da
            WHERE da.user_id = auth.uid()
              AND da.modulo = 'documentos'
          )
        )
    )
  );
