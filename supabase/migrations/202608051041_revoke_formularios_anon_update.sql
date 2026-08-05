-- 202608051041_revoke_formularios_anon_update.sql
-- Defesa em profundidade descoberta na verificacao da Task 10 (RLS de
-- formularios): anon mantinha grant de UPDATE em todas as colunas mesmo
-- apos a migracao anterior, embora nenhuma policy de UPDATE alcance anon
-- (RLS ja bloqueava). Fecha o grant supérfluo por consistencia com o
-- padrao ja usado nas tasks 3 e 10 para authenticated.
revoke update on public.formularios from anon;
