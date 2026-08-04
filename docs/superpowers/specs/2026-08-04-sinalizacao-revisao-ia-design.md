# Sinalização de revisão da IA e achados críticos na lista de Documentos — sub-projeto 7/8 (Central de Documentos)

## Contexto

Sétimo subsistema da reformulação da Central de Documentos (ver
[2026-07-31-analise-ia-automatica-design.md](2026-07-31-analise-ia-automatica-design.md)
para a lista completa dos 8 subsistemas). O pedido original descrevia este
item como "Painel + histórico/auditoria + ciclo de vida da recomendação" —
escopo reduzido em conversa com o usuário para evitar uma aba nova: em vez
de um painel separado, os sinais que uma tela consolidada mostraria
(documentos que precisam de atenção, achados críticos em aberto) aparecem
direto na tela de Documentos já existente.

Depende de:
- Sub-projeto 1 (análise automática por IA) — em produção; introduziu
  `status_analise_ia` em `formularios`.
- Sub-projeto 5 (frases críticas e emergência) — em produção; introduziu a
  tabela `documento_recomendacoes_criticas` com achados por documento,
  classificados por `prioridade` (`emergencial`, `critica`, `alta`,
  `moderada`, `preventiva`, `informativa`).

## O que já existe (achado no código antes do brainstorm)

- `src/app/documentos/page.tsx` já tem um filtro completo por
  `status_analise_ia` (`statusAnaliseIaFilter`, `STATUS_ANALISE_IA_OPTIONS`,
  persistido em `localStorage`, propagado para
  `GET /api/documentos?statusAnaliseIa=...`), mas **nenhum indicador visual
  por linha** — só dá pra saber o status de um documento filtrando por ele,
  não olhando a lista.
- `src/app/api/documentos/route.ts` já seleciona e retorna
  `status_analise_ia` por linha (`FormularioRow`/`DocumentRecord`), só não
  expõe nada sobre achados críticos.
- `StatusBadge` (`src/components/StatusBadge.tsx`) + `getStatusPresentation`
  (`src/lib/uiStatus.ts`) já formam um sistema genérico de badge por status
  (label + tom de cor), reaproveitado hoje só para o campo `status`
  (assinado/pendente/etc.) dos documentos. `uiStatus.ts` já tem entradas
  para `em_analise`, `concluida` e `erro` (usadas para outros campos de
  status no sistema) mas não para os valores específicos de
  `status_analise_ia` que ainda faltam: `recebido`, `necessita_revisao`,
  `duplicado`.
- Achado crítico com `prioridade` `emergencial`/`critica` já força
  `status_analise_ia = 'necessita_revisao'` (sub-projeto 5) — ou seja, todo
  documento com achado crítico em aberto já cai dentro do filtro
  "Necessita revisão" existente. O problema é que esse filtro mistura dois
  motivos bem diferentes: achado crítico real (ação urgente) e metadado
  incompleto/confiança baixa (revisão de dados, não urgência).

## Escopo deste sub-projeto

1. **Badge de `status_analise_ia` visível em cada linha/card** da lista de
   Documentos, ao lado do badge de `status` já existente — reaproveita
   `StatusBadge`/`getStatusPresentation`, só adicionando as entradas que
   faltam em `uiStatus.ts` (`recebido`, `necessita_revisao`, `duplicado`).
   Sem badge quando `status_analise_ia` é `null` (documentos de tipos fora
   do escopo da análise automática, ex.: `orcamentos_internos`,
   `notas_fiscais_conservacao`).
2. **Indicador de achado crítico** — um badge/ícone adicional (vermelho,
   distinto do badge de status) só nas linhas cujo documento tem pelo menos
   um achado em `documento_recomendacoes_criticas` com `prioridade` em
   (`emergencial`, `critica`). Tooltip/título mostra o `problema` do achado
   de maior prioridade (emergencial antes de crítica) daquele documento. Se
   houver mais de um achado crítico, o tooltip indica a contagem (ex.: "2
   achados críticos — Vazamento no compressor...").
3. **`GET /api/documentos` passa a expor esse sinal por linha** — um campo
   novo no retorno (`achado_critico: { problema: string; prioridade:
   "emergencial" | "critica"; total: number } | null`), calculado com uma
   query adicional em `documento_recomendacoes_criticas` filtrada pelos
   `documento_id`s da página atual (não uma segunda chamada do cliente).
4. **Novo valor no filtro de status da IA**: "Achado crítico" — ao ser
   selecionado, filtra documentos que têm pelo menos um achado
   `emergencial`/`critica` em aberto (via `EXISTS` contra
   `documento_recomendacoes_criticas`), diferenciando de "Necessita revisão"
   que hoje mistura esse caso com outros motivos.

### Fora de escopo (decisão explícita do usuário)

- Nenhuma tela, rota ou aba nova — tudo dentro de `/documentos` já
  existente.
- Nenhuma ação de "marcar achado como resolvido"/ciclo de vida do achado —
  o achado continua existindo em `documento_recomendacoes_criticas`
  indefinidamente (mesmo comportamento de hoje); este sub-projeto só torna
  achados existentes visíveis na lista.
- Pendências de documento faltante por equipamento (painel de Controle por
  equipamento, sub-projeto 3) — continuam só naquela tela, não entram aqui.
- Histórico/auditoria de quem tratou o quê — não faz parte deste recorte
  reduzido.

## Arquitetura

Sem tabela nova, sem serviço novo dedicado. Extensão pontual de dois
arquivos já existentes:

- `src/app/api/documentos/route.ts`: depois de montar a página de
  `registros` (já pagina em `PAGE_SIZE` blocos e filtra em memória por
  período), roda uma query extra em `documento_recomendacoes_criticas`
  (`select documento_id, problema, prioridade` `where documento_id in
  (...ids da página atual) and prioridade in ('emergencial','critica')`),
  agrupa por `documento_id` (mantendo o achado de maior prioridade — 
  emergencial > critica — e a contagem total) e anexa esse resumo a cada
  `DocumentRecord` antes de retornar. Quando o filtro `statusAnaliseIa` for
  `achado_critico`, a query principal em `formularios` ganha um filtro
  adicional (`EXISTS` contra `documento_recomendacoes_criticas` com a mesma
  condição de prioridade) em vez de filtrar por `status_analise_ia`
  diretamente (já que o valor `achado_critico` não é um valor real da
  coluna, é um filtro derivado).
- `src/app/documentos/page.tsx`: acrescenta o badge de `status_analise_ia`
  (via `StatusBadge`) e o indicador de achado crítico nas duas visões já
  existentes (tabela desktop e cards mobile), ao lado de onde
  `<StatusBadge status={registro.status} />` já aparece hoje (duas
  ocorrências no arquivo). Acrescenta a opção "Achado crítico" em
  `STATUS_ANALISE_IA_OPTIONS`.
- `src/lib/uiStatus.ts`: acrescenta as 3 entradas que faltam
  (`recebido`, `necessita_revisao`, `duplicado`) ao mapa `STATUS`.

## Testes necessários

- `getStatusPresentation` retorna label/tom corretos para os 3 novos
  valores (`recebido`, `necessita_revisao`, `duplicado`), e continua
  funcionando para os valores já existentes (sem regressão).
- A função que agrupa achados críticos por documento (extraída como função
  pura testável, ex. `resumirAchadosCriticosPorDocumento`) retorna o achado
  de maior prioridade quando há mais de um, e a contagem total correta;
  retorna `null`/ausente para documentos sem achado crítico; ordena
  `emergencial` acima de `critica` quando ambos existem no mesmo documento.
- `GET /api/documentos` com `statusAnaliseIa=achado_critico` retorna só
  documentos com pelo menos um achado `emergencial`/`critica` em aberto,
  sem alterar o comportamento dos outros valores de filtro já existentes.
- `GET /api/documentos` sem esse filtro continua retornando o campo
  `achado_critico` corretamente preenchido (ou `null`) por linha, sem
  quebrar a paginação/contagem total já existente.
