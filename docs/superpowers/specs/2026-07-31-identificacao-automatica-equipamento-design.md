# Identificação automática do equipamento no documento — sub-projeto 4/8 (Central de Documentos)

## Contexto

Quarto subsistema da reformulação da Central de Documentos (ver
[2026-07-31-analise-ia-automatica-design.md](2026-07-31-analise-ia-automatica-design.md)
para a lista completa dos 8 subsistemas). Originalmente o sub-projeto 3
(controle mensal por equipamento) viria antes deste, mas o usuário decidiu
inverter a ordem: o controle mensal depende de documentos já estarem
vinculados a um equipamento, e hoje **nenhum documento tem esse vínculo**
— então faz mais sentido construir a identificação automática primeiro, e
o painel de controle mensal por cima dela depois.

Depende de:
- Sub-projeto 1 (análise automática por IA) — já implementado e em
  produção. Este spec estende o pipeline existente
  (`src/lib/documentAnalysisPipeline.ts`, `src/lib/openAiDocumentAnalysis.ts`),
  não cria um novo.
- Sub-projeto 2 (cadastro de equipamentos) — já implementado e em
  produção, com 139 equipamentos importados e mais 118 pendentes de
  cadastro manual (ver
  [2026-07-31-cadastro-equipamentos-conferencia.md](2026-07-31-cadastro-equipamentos-conferencia.md)).

## Escopo

A IA, ao analisar automaticamente um documento (fluxo já existente do
sub-projeto 1), passa a também tentar identificar **a qual equipamento
cadastrado da loja** o documento se refere, e vincular
`formularios.equipamento_id` quando o match for confiável.

**Só roda para os tipos `registro_laudos` e `notas_fiscais`** — decisão
explícita do usuário: laudos técnicos e notas fiscais de manutenção
costumam citar o equipamento no corpo do documento; contratos, retenção
trabalhista e orçamentos externos raramente citam, e tentar extrair ali só
geraria ruído.

### Fora de escopo

- Painel de controle mensal por equipamento (documentos esperados x
  recebidos x faltantes) — sub-projeto 3, decidido para depois deste.
- Alertas de documento faltante por equipamento — sub-projeto 6, depende
  do 3.
- Detecção de frases críticas / classificação de emergência — sub-projeto
  5, trabalho independente sobre o mesmo pipeline.
- Qualquer nova tela dedicada a "fila de revisão" — reaproveita a lista de
  Documentos já existente (ver seção "Fila de revisão" abaixo).

## Extração pela IA

`src/lib/openAiDocumentAnalysis.ts`: `DocumentoAnaliseIa` e `ANALISE_SCHEMA`
ganham 3 campos novos, todos opcionais (`string | null`):

- `equipamento_tipo` — o tipo de equipamento mencionado (ex.: "Gerador",
  "Ar Condicionado"), em texto livre, mesma filosofia de
  `equipamentos.tipo_equipamento` (sem enum fixo).
- `equipamento_identificacao` — identificação textual do equipamento
  citada no documento (ex.: "Gerador 01", "Unidade 2").
- `equipamento_numero_serie` — número de série do equipamento, quando
  citado.

O prompt do sistema (mesma função `analisarDocumentoComOpenAi`) ganha uma
instrução adicional, condicionada a `tipoDocumento` ser `registro_laudos`
ou `notas_fiscais`: extrair esses 3 campos do texto/imagem quando
presentes; caso contrário, retornar `null` nos três — não inventar.

## Matching contra o cadastro de equipamentos

Nova função em `src/lib/documentAnalysisPipeline.ts`:

```
encontrarEquipamentoCorrespondente(
  supabaseAdmin,
  lojaId: string,
  resultado: DocumentoAnaliseIa,
): Promise<{ id: string } | null>
```

Regras, nesta ordem:
1. Busca todos os equipamentos `status = 'ativo'` da `lojaId`.
2. Se `equipamento_numero_serie` foi extraído e bate exatamente (case
   insensitive) com o `numero_serie` de exatamente um equipamento ativo da
   loja → retorna esse equipamento. Match por número de série é o mais
   confiável, então tem prioridade e não precisa checar mais nada.
3. Senão, se `equipamento_tipo` foi extraído: filtra os equipamentos ativos
   da loja cujo `tipo_equipamento` bate com o tipo extraído, comparando
   por uma normalização simples (maiúsculas + sem acento, via
   `String.normalize("NFD")` — mesma técnica de
   `normalizarNomeUnidade` em `equipamentosImport.ts`, mas **sem** a
   remoção de prefixo "Farma"/"Bemol Farma", que é específica de nome de
   loja e não se aplica a tipo de equipamento). Essa comparação é nova e
   pequena o suficiente para viver como uma função própria — não
   reaproveita `normalizarNomeUnidade` diretamente, só a mesma técnica.
   - Se sobrar exatamente 1 candidato → retorna ele.
   - Se sobrar mais de 1 e `equipamento_identificacao` foi extraído:
     tenta desempatar comparando `identificacao` normalizada; se um único
     equipamento bater, retorna ele.
   - Em qualquer outro caso (0 candidatos, ou mais de 1 sem desempate
     possível) → retorna `null`. Nunca chuta.

## Onde isso entra no pipeline existente

Em `processarDocumentoComIa` (orquestrador do sub-projeto 1), depois que a
loja já foi identificada e antes da gravação do status final:

- Se `row.tipo` for `registro_laudos` ou `notas_fiscais` **e** a loja
  identificada tiver pelo menos 1 equipamento `ativo` cadastrado:
  chama `encontrarEquipamentoCorrespondente`. Se retornar um equipamento,
  grava `equipamento_id` no `formularios` junto com a atualização de
  status já existente.
- Se não encontrar (função retornou `null`) **e** a loja tem equipamentos
  cadastrados daquele tipo — isso conta como sinal de baixa confiança:
  `determinarStatusFinal` passa a considerar também "tipo em escopo de
  equipamento, sem `equipamento_id` resolvido, loja tem equipamentos
  cadastrados" como motivo para `necessita_revisao`, junto dos critérios
  que já existem (confiança geral, loja/competência ausentes).
- **Se a loja não tem nenhum equipamento cadastrado ainda**, não tenta
  match nenhum e não penaliza o status por isso — evita gerar
  "necessita revisão" artificial para lojas que ainda não passaram pelo
  sub-projeto 2 manualmente (ver
  [conferência pendente](2026-07-31-cadastro-equipamentos-conferencia.md)).
- Documentos de outros tipos (`retencao_trabalhista`, `contratos`,
  `orcamentos`) e `orcamentos_internos`/`notas_fiscais_conservacao`
  (já fora do escopo do pipeline automático) não são afetados por nada
  disto.

## Fila de revisão

Não cria tela nova. A lista de Documentos (`src/app/documentos/page.tsx`)
já tem um mecanismo de filtro (`statusFilter`, parâmetro `status` na URL,
persistido) usado hoje para `formularios.status`. Adiciona
`status_analise_ia` como uma segunda dimensão de filtro nesse mesmo
mecanismo, permitindo filtrar por `necessita_revisao` (e os demais valores
já existentes: `em_analise`, `erro`, `duplicado`, etc.) — a "fila de
revisão" nada mais é do que essa lista filtrada.

## Atribuição / correção manual do equipamento

`PATCH /api/documentos` (`src/app/api/documentos/route.ts`) já edita
`loja_id` e `prestador_id` de um documento existente, com o mesmo padrão
de `hasOwnProperty`-based partial update. Ganha um terceiro campo opcional,
`equipamentoId`:
- Quando presente e não vazio: valida que o equipamento existe e pertence
  à loja atual do documento (`loja_id` do equipamento bate com a loja
  resolvida do documento — se `hasLojaUpdate` também estiver no mesmo
  payload, valida contra a loja nova); grava `equipamento_id`.
- Quando presente e vazio/null: desvincula (`equipamento_id = null`).

`DocumentDetailsDrawer.tsx` ganha um campo "Equipamento" (select),
ao lado dos campos de loja/prestador já editáveis ali, populado via
`useEquipamentos({ lojaId: <loja do documento> })` — só lista equipamentos
ativos daquela loja. Mudar a loja do documento deve limpar a seleção de
equipamento (evita manter um `equipamento_id` de uma loja diferente).

## Modelo de dados

`ALTER TABLE public.formularios ADD COLUMN equipamento_id uuid REFERENCES public.equipamentos(id) ON DELETE SET NULL;`

`ON DELETE SET NULL` (não `CASCADE`) — desativar/remover um equipamento
não deve apagar o histórico de documentos já vinculados a ele, só
desvincular.

## Testes necessários

- `encontrarEquipamentoCorrespondente`: match por número de série exato
  (prioridade sobre tipo); match por tipo único; desempate por
  identificação quando há mais de um equipamento do mesmo tipo; retorna
  `null` quando não há candidato; retorna `null` quando há mais de um
  candidato e a identificação não desempata.
- Orquestrador: tipo fora de escopo (`contratos`, `retencao_trabalhista`,
  `orcamentos`) nunca tenta match de equipamento, mesmo que a loja tenha
  equipamentos cadastrados.
- Orquestrador: loja sem nenhum equipamento cadastrado não gera
  `necessita_revisao` por falta de match de equipamento (só pelos
  critérios que já existiam antes deste sub-projeto).
- Orquestrador: loja com equipamentos cadastrados do tipo certo, mas sem
  match confiável → `necessita_revisao`.
- `PATCH /api/documentos` com `equipamentoId` de um equipamento que
  pertence a outra loja (não a loja atual/nova do documento) → erro,
  não vincula.
- `PATCH /api/documentos` com `equipamentoId` vazio → desvincula
  (`equipamento_id = null`).
