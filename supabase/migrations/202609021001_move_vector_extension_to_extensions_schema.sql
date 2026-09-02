-- A extensao vector caiu no schema public por omissao na migracao anterior.
-- Supabase recomenda extensoes fora de public; movida para extensions (0 linhas
-- nas tabelas afetadas no momento, sem impacto em dados).
alter extension vector set schema extensions;
