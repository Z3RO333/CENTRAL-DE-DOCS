ALTER TABLE public.formularios
  ADD COLUMN equipamento_id uuid REFERENCES public.equipamentos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS formularios_equipamento_id_idx
  ON public.formularios (equipamento_id);
