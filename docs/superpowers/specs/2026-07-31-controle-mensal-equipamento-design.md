# Controle mensal por equipamento — sub-projeto 3/8 (Central de Documentos)

## Contexto

Terceiro subsistema (em ordem de execução — foi construído por último dos
três já feitos, depois do sub-projeto 4, porque dependia do vínculo
documento↔equipamento que só existe desde então) da reformulação da
Central de Documentos. Ver
[2026-07-31-analise-ia-automatica-design.md](2026-07-31-analise-ia-automatica-design.md)
para a lista completa dos 8 subsistemas.

Depende de:
- Sub-projeto 2 (cadastro de equipamentos) — em produção, 139 equipamentos
  importados + 118 pendentes de cadastro manual.
- Sub-projeto 4 (identificação automática de equipamento) — em produção;
  `formularios.equipamento_id` é preenchido automaticamente pela IA (Registro
  e Laudos, Notas Fiscais) ou manualmente pela tela de Documentos.

## Escopo

Um painel que mostra, por equipamento cadastrado, quais meses já têm
documento e quais estão faltando — a mesma ideia do painel de Cobranças
que já existe (por prestador+loja), mas na granularidade de equipamento
individual, respeitando a frequência de cada um.

### Fora de escopo

- Alertas de documento faltante por e-mail — sub-projeto 6, separado.
- Qualquer mudança no sub-projeto 4 (identificação automática) ou 2
  (cadastro) além do campo `frequencia` descrito abaixo.
- Reimplementar os indicadores de qualidade de análise (duplicado, revisão
  humana, etc.) — já existem via `status_analise_ia`; o painel só exibe.

## Frequência por equipamento

Novo campo `equipamentos.frequencia`, texto com CHECK restrito a
`'mensal'`, `'semestral'`, `'anual'`, default `'mensal'` (a maioria dos
equipamentos reais, pela planilha de referência, é mensal — Ar
Condicionado, Gerador, Controle de Pragas; Termografia é semestral;
Combate a Incêndio e Subestação são anuais).

Meses considerados "devidos" no ano, por frequência:
- `mensal`: todo mês, do início da obrigatoriedade (ver abaixo) até o mês
  limite do ano (mesma regra já usada em cobranças —
  `calcularMesLimite`: ano corrente conta até o mês anterior ao atual, anos
  fechados contam os 12 meses, anos futuros não contam nada).
- `semestral`: meses 6 (junho) e 12 (dezembro), filtrados pelo mês limite
  do ano e pelo início da obrigatoriedade.
- `anual`: mês 12 (dezembro), filtrado pelo mês limite do ano e pelo
  início da obrigatoriedade.

## Início da obrigatoriedade (evita pendência retroativa)

Para cada equipamento, a data de início da contagem é, nesta ordem de
prioridade: `data_ativacao` → `data_instalacao` → `created_at`. Meses
anteriores a essa data não geram pendência — importante para os 139
equipamentos já importados, que não têm `data_instalacao`/`data_ativacao`
preenchidas e não devem aparecer com pendência retroativa ao ano inteiro.

## O que conta como "documento recebido" num mês

Qualquer `formulario` cujo `equipamento_id` aponte para aquele equipamento
e cujo `dados->>competencia` bata com o mês/ano em questão (formato
`MM/AAAA`, já usado em todo o sistema) — independente do `tipo` do
documento. O vínculo pode ter vindo tanto da identificação automática
(Registro e Laudos, Notas Fiscais) quanto de correção manual (qualquer
tipo, via a tela de Documentos).

## Arquitetura

Uma função Postgres nova (RPC), no mesmo espírito da que já existe para
cobranças (`levantar_pendencias`), agregando por equipamento em vez de por
prestador+loja. Entrada: ano de referência (opcional, default ano atual
no fuso de Manaus). Saída: uma linha por equipamento ativo, com os meses
com documento e os meses pendentes, já filtrados pela frequência e pelo
início da obrigatoriedade.

Uma função `src/lib/controleEquipamentosService.ts` (mesmo padrão de
`cobrancasService.ts`) chama essa RPC e monta o resultado agrupado por
Loja → Tipo de equipamento → Equipamento.

## Tela

Painel novo (rota própria — a estrutura loja→tipo→equipamento→ano→mês não
se encaixa na tela de Cobranças existente, que é mais rasa). Mostra, por
padrão, só equipamentos com pendência, com filtro por loja/tipo/ano, e
para cada equipamento: meses com documento, meses faltantes, total
esperado/recebido/faltante — mesmos indicadores que o painel de Cobranças
já exibe hoje, só que por equipamento em vez de por prestador.

## Testes necessários

- `calcularMesesDevidos` (nome provisório — função pura equivalente ao
  `calcularMesLimite` de cobranças, mas retornando a LISTA de meses
  devidos, não só um limite): mensal retorna todos os meses até o limite;
  semestral retorna só 6 e 12 dentro do limite; anual retorna só 12 dentro
  do limite; ano futuro retorna lista vazia.
- Início da obrigatoriedade: equipamento com `data_ativacao` no meio do
  ano não gera pendência para os meses anteriores a ela, mesmo que a
  frequência mande considerar aquele mês.
- Equipamento sem `data_instalacao`/`data_ativacao` usa `created_at` como
  início — não pendencia meses anteriores à importação/cadastro.
- Documento com `equipamento_id` de um tipo diferente de Registro e
  Laudos/Notas Fiscais (ex.: vínculo manual numa nota de outro tipo) ainda
  conta como "recebido" para aquele mês.
- Dois equipamentos do mesmo tipo na mesma loja (ex.: Gerador 01 e Gerador
  02) aparecem como pendências independentes — documento de um não cobre
  o outro.
