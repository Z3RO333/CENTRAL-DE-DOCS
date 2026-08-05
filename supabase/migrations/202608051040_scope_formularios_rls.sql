-- 202608051040_scope_formularios_rls.sql
drop policy if exists "formularios_select_only_approved" on public.formularios;
drop policy if exists "formularios_update_only_approved" on public.formularios;

create policy "formularios_select_scoped" on public.formularios
for select
to authenticated
using (
  is_documentos_admin()
  or user_id = auth.uid()
  or prestador_id in (
    select p.id from public.prestadores p
    where auth.email() = any(p.usuarios)
  )
  or exists (
    select 1 from public.documentos_acesso da
    where da.scope in ('gerente', 'fornecedor')
      and (da.user_id = auth.uid() or da.email = auth.email())
      and da.loja_id is not null
      and da.loja_id::text = (formularios.dados ->> 'loja_id')
      and (
        da.can_view_all
        or (da.prestador_id is not null and da.prestador_id = formularios.prestador_id)
      )
  )
);

create policy "formularios_update_scoped" on public.formularios
for update
to authenticated
using (
  is_documentos_admin()
  or user_id = auth.uid()
  or prestador_id in (
    select p.id from public.prestadores p
    where auth.email() = any(p.usuarios)
  )
  or exists (
    select 1 from public.documentos_acesso da
    where da.scope in ('gerente', 'fornecedor')
      and (da.user_id = auth.uid() or da.email = auth.email())
      and da.loja_id is not null
      and da.loja_id::text = (formularios.dados ->> 'loja_id')
      and (
        da.can_view_all
        or (da.prestador_id is not null and da.prestador_id = formularios.prestador_id)
      )
  )
)
with check (
  is_documentos_admin()
  or user_id = auth.uid()
  or prestador_id in (
    select p.id from public.prestadores p
    where auth.email() = any(p.usuarios)
  )
  or exists (
    select 1 from public.documentos_acesso da
    where da.scope in ('gerente', 'fornecedor')
      and (da.user_id = auth.uid() or da.email = auth.email())
      and da.loja_id is not null
      and da.loja_id::text = (formularios.dados ->> 'loja_id')
      and (
        da.can_view_all
        or (da.prestador_id is not null and da.prestador_id = formularios.prestador_id)
      )
  )
);

-- Defesa em profundidade: usuarios comuns (nao-admin) so alteram os 3 campos
-- que a tela de assinatura de laudo realmente usa via update direto.
-- supabaseAdmin (service role) nao e afetado por privilegios de coluna.
revoke update on public.formularios from authenticated;
grant update (status, arquivo_assinado_path, assinado_por) on public.formularios to authenticated;
