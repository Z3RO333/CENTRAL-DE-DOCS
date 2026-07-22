-- Adiciona o campo "responsavel", para registrar qual gestor/regional
-- dentro da conservadora (ex.: "Wanderleia" na JanPro) enviou a nota,
-- sem precisar cadastrar cada regional como um prestador separado.

alter table public.notas_fiscais_conservacao
  add column if not exists responsavel text;
