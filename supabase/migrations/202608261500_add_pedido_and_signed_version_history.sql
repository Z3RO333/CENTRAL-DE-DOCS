-- Permite completar o fluxo do orcamento depois da assinatura sem perder
-- rastreabilidade das versoes anteriores.

alter table public.orcamentos_internos
  add column if not exists numero_pedido text null;

alter table public.orcamentos_internos_versoes
  add column if not exists arquivo_assinado_path text null;

-- Associa os PDFs assinados atuais a versao que estava vigente quando a
-- migracao foi aplicada. Os arquivos antigos continuam no Storage.
update public.orcamentos_internos_versoes as versao
set arquivo_assinado_path = orcamento.arquivo_assinado_path
from public.orcamentos_internos as orcamento
where versao.orcamento_id = orcamento.id
  and versao.versao = orcamento.versao_atual
  and versao.principal = true
  and versao.arquivo_assinado_path is null
  and orcamento.arquivo_assinado_path is not null;

