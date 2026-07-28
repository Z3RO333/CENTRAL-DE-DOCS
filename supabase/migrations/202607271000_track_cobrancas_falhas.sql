-- Registra o resultado da última tentativa de cobrança por prestador/loja/dia.
-- Uma nova tentativa bem-sucedida sobrescreve a falha do mesmo dia.
ALTER TABLE public.cobrancas_documentacao_historico
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'enviado'
    CHECK (status IN ('enviado', 'falha')),
  ADD COLUMN IF NOT EXISTS erro text;

CREATE INDEX IF NOT EXISTS idx_cobrancas_hist_falhas
  ON public.cobrancas_documentacao_historico (status, enviado_em DESC)
  WHERE status = 'falha';

