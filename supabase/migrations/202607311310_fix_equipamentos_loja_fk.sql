-- Corrige a FK equipamentos.loja_id: estava com ON DELETE CASCADE, permitindo que a
-- exclusao de uma loja (via DELETE /api/lojas) apagasse silenciosamente todos os
-- equipamentos vinculados, incluindo os ~139 registros ja importados da planilha.
-- Troca para ON DELETE RESTRICT: exclusao de loja com equipamentos vinculados passa
-- a ser bloqueada pelo banco, evitando perda de dados irrecuperavel.
alter table public.equipamentos
  drop constraint equipamentos_loja_id_fkey,
  add constraint equipamentos_loja_id_fkey
    foreign key (loja_id) references public.lojas (id) on delete restrict;
