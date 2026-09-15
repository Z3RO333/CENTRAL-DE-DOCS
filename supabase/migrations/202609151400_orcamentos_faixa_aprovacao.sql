-- Estrategia de liberacao por faixa de valor:
-- ate R$ 15.000,00: aprovado diretamente por Walter ou Luciana (grupo "padrao").
-- a partir de R$ 15.000,01: Walter/Luciana so pre-aprovam; a decisao final
-- fica com Daniel ou Flavio (grupo "alta").

ALTER TABLE public.orcamentos_internos_aprovadores
  ADD COLUMN IF NOT EXISTS grupo text NOT NULL DEFAULT 'padrao';

ALTER TABLE public.orcamentos_internos_aprovadores
  DROP CONSTRAINT IF EXISTS orcamentos_internos_aprovadores_grupo_check;

ALTER TABLE public.orcamentos_internos_aprovadores
  ADD CONSTRAINT orcamentos_internos_aprovadores_grupo_check
  CHECK (grupo IN ('padrao', 'alta'));

DELETE FROM public.orcamentos_internos_aprovadores
  WHERE email IN ('jacenira@bemol.com.br', 'gustavoandrade@bemol.com.br');

INSERT INTO public.orcamentos_internos_aprovadores (email, nome, grupo) VALUES
  ('walterrodrigues@bemol.com.br', 'Walter Rodrigues', 'padrao'),
  ('lucianaoliveira@bemol.com.br', 'Luciana Oliveira', 'padrao'),
  ('danieldamasceno@bemol.com.br', 'Daniel Damasceno', 'alta'),
  ('flavioqueiroz@bemol.com.br', 'Flávio Queiroz', 'alta')
ON CONFLICT (email) DO UPDATE
  SET grupo = EXCLUDED.grupo, nome = EXCLUDED.nome;

ALTER TABLE public.orcamentos_internos
  ADD COLUMN IF NOT EXISTS pre_aprovado_por uuid NULL,
  ADD COLUMN IF NOT EXISTS pre_aprovado_email text NULL,
  ADD COLUMN IF NOT EXISTS pre_aprovado_nome text NULL,
  ADD COLUMN IF NOT EXISTS pre_aprovado_em timestamptz NULL;
