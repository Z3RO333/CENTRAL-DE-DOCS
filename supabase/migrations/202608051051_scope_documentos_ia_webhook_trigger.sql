-- 202608051051_scope_documentos_ia_webhook_trigger.sql
-- Hardening sugerido na revisao da Task 11: sem esse WHEN, o gatilho
-- disparava uma chamada HTTP + leitura do Vault a cada INSERT em
-- formularios, mesmo para tipos fora do escopo da analise automatica
-- (que ja e filtrado do lado da aplicacao por deveAnalisarAutomaticamente,
-- mas so depois de pagar o custo da chamada). Restringe o disparo aos
-- mesmos 5 tipos ja usados em TIPOS_ANALISE_AUTOMATICA
-- (src/lib/documentAnalysisPipeline.ts) para nao gastar round-trip em
-- orcamentos_internos/notas_fiscais_conservacao/etc.
drop trigger if exists documentos_ia_processar_trigger on public.formularios;
create trigger documentos_ia_processar_trigger
  after insert on public.formularios
  for each row
  when (new.tipo in ('notas_fiscais','registro_laudos','retencao_trabalhista','contratos','orcamentos'))
  execute function public.notificar_documentos_ia_processar();
