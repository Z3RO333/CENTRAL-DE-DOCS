# Auditoria de integridade — sub-projeto 8/8 (Central de Documentos)

## Contexto

Oitavo e último item da reformulação da Central de Documentos (ver
[2026-07-31-analise-ia-automatica-design.md](2026-07-31-analise-ia-automatica-design.md)
para a lista completa). Diferente dos outros 7, este item já nasceu marcado
no spec original como algo que não vira projeto isolado: "Validações de
integridade (tratadas junto de cada subsistema que protegem, não como
projeto isolado)". Boa parte disso já aconteceu organicamente — cada
revisão final de sub-projeto encontrou e corrigiu problemas de integridade
reais (FK com `ON DELETE` errado, RPC sem `REVOKE` vazando via REST,
`frequencia` sem write-path, filtro de mês faltando numa RPC de
pendências, etc.).

Este sub-projeto fecha a lista fazendo uma auditoria final nos 7
sub-projetos já construídos (1-7, todos em produção), procurando o que
ainda passou batido.

## Escopo

Investigação (sem alterar código) nas 4 áreas escolhidas pelo usuário,
cobrindo as tabelas/rotas introduzidas pelos sub-projetos 1-7
(`formularios.status_analise_ia`/`equipamento_id`, `equipamentos`,
`documentos_analises_ia`, `documento_recomendacoes_criticas`, as rotas em
`src/app/api/documentos/**` e `src/app/api/equipamentos/**`,
`src/app/api/controle-equipamentos/**`, e os serviços em
`src/lib/documentAnalysisPipeline.ts`, `src/lib/controleEquipamentosService.ts`,
`src/lib/openAiDocumentAnalysis.ts`):

1. **Constraints e FKs** — toda FK introduzida por esses sub-projetos tem
   `ON DELETE` correto para o relacionamento real (não assumir `CASCADE`
   por padrão); `CHECK` constraints cobrem exatamente os valores que o
   código usa (nem mais, nem menos); colunas que a lógica de negócio trata
   como obrigatórias são `NOT NULL` no banco, não só validadas na aplicação.
2. **Controle de acesso** — todas as tabelas novas têm RLS habilitado sem
   policies (padrão já estabelecido no projeto: controle só na camada de
   API via `supabaseAdmin`); toda função RPC introduzida tem `REVOKE
   EXECUTE FROM PUBLIC, anon, authenticated` quando não deve ser chamável
   direto via PostgREST; toda rota de API que deveria exigir admin/gestor
   realmente checa isso antes de agir, não só de exibir.
3. **Write-paths completos** — todo campo gravado por algum desses
   sub-projetos tem um caminho real na aplicação pra ser escrito
   corretamente (evitar recorrência do caso `equipamentos.frequencia`, que
   tinha migration e leitura mas nenhuma tela pra editar).
4. **Dados órfãos/inconsistentes já existentes** — consultas diretas no
   Supabase de produção (projeto `tqzvgqauvbknwdvbtvfr`) procurando dados
   que já ficaram inconsistentes: `equipamento_id`/`prestador_id`/
   `loja_id` apontando para registros que não existem mais (quando a FK
   permitiria isso, ex. `SET NULL` que nunca rodou por algum motivo),
   `documento_recomendacoes_criticas` órfã de `formularios`, `status_analise_ia`
   preso num estado que não devia ser possível (ex. `em_analise` há muito
   tempo sem nunca ter avançado), etc.

### Fora de escopo

- Qualquer feature nova ou tela nova — isso é auditoria e correção de bugs
  de integridade, não construção. Se a investigação encontrar algo que
  parece uma feature faltando (não um bug), vira uma observação separada
  para decisão futura, não entra no plano de correção deste sub-projeto.
- Sub-projeto 6 (alertas por e-mail) — nunca foi construído (explicitamente
  adiado pelo usuário), então não há nada dele para auditar.
- Tabelas/rotas de fora da Central de Documentos (ex. `orcamentos_internos`,
  `notas_fiscais_conservacao`, frotas/localizador) — fora do perímetro
  desta reformulação.

## Processo

**Fase 1 — Investigação (não altera nada):** um agente de investigação por
área (4 no total), rodando em paralelo, cada um produzindo um relatório de
achados com severidade (Crítico/Importante/Menor) e evidência concreta
(arquivo:linha para código, resultado de query para dados). Nenhum agente
desta fase tem permissão de escrita em código ou banco.

O usuário revisa a lista consolidada de achados reais (falsos positivos e
coisas já corrigidas em revisões anteriores desta sessão são descartados
antes de chegar nele) antes de qualquer correção começar.

**Fase 2 — Plano de correção:** só depois da aprovação da lista de achados,
um plano de implementação é escrito (mesmo formato usado nos sub-projetos
1-7) onde cada task corrige um achado real confirmado — sem tasks de
"confirmar que está tudo bem". Executado via subagent-driven-development,
mesmo padrão já usado nesta sessão.

## Testes necessários

Definidos task a task no plano de correção (Fase 2), já que dependem de
quais achados reais surgirem na Fase 1 — não é possível especificar testes
para bugs que ainda não foram identificados.
