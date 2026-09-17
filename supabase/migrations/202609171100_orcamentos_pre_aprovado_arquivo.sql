-- Guarda o PDF ja carimbado com a pre-aprovacao, para servir de base ao
-- carimbo final (assim os dois carimbos aparecem no PDF assinado, sem
-- se sobrepor).
ALTER TABLE public.orcamentos_internos
  ADD COLUMN IF NOT EXISTS pre_aprovado_arquivo_path text NULL;
