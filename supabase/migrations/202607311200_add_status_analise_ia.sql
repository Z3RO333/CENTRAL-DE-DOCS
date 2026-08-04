ALTER TABLE public.formularios
  ADD COLUMN status_analise_ia text NOT NULL DEFAULT 'recebido'
  CHECK (status_analise_ia IN (
    'recebido',
    'aguardando_analise',
    'em_analise',
    'concluida',
    'necessita_revisao',
    'erro',
    'duplicado'
  ));

CREATE INDEX IF NOT EXISTS formularios_status_analise_ia_idx
  ON public.formularios (status_analise_ia);
