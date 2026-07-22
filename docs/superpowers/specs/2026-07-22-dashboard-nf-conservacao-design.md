# Dashboard de acompanhamento de NF por conservadora — sub-projeto 4/5

## Contexto

Sub-projeto 4 da reformulação do controle de conservadoras. Depende apenas
do sub-projeto 1 (cadastro estruturado) e 2 (selo de prazo), já mesclados em
`master`. O pedido original de dashboard incluía métricas que dependem do
BTracker (quantidade registrada, divergências, tempo médio até o registro),
mas o sub-projeto 3 (verificação com BTracker) ainda não foi implementado —
por decisão do usuário, essas métricas ficam de fora por enquanto e podem
ser adicionadas depois, sem precisar redesenhar nada.

## Fora de escopo

- Qualquer métrica que dependa de BTracker (registrada/não registrada,
  divergências, tempo médio entre recebimento e registro) — aguarda o
  sub-projeto 3.
- Qualquer biblioteca de gráficos nova — este projeto não tem nenhuma
  instalada (`recharts`, `chart.js`, etc. não constam no `package.json`);
  as visualizações seguem o padrão já usado em `/dashboard/analises`:
  barras feitas com `<div>` + Tailwind (largura via `style={{ width: "X%" }}`),
  sem dependência nova.
- Paginação/agregação no servidor — o endpoint `GET /api/notas-fiscais-conservacao`
  já retorna todas as notas sem paginação (decisão aceita no sub-projeto 1);
  os agregados deste dashboard são calculados inteiramente no cliente, sobre
  os dados já retornados por esse mesmo endpoint.

## Arquitetura

Nova página `src/app/documentos/conservacao/dashboard/page.tsx`, com o mesmo
controle de acesso já usado na área de Conservação (`isAdmin ||
isAprovadorInterno`). Busca via `GET /api/notas-fiscais-conservacao` (sem
filtro de status, para pegar todas as notas) e computa os agregados abaixo
em memória, no próprio componente. `ConservacaoSubNav`
(`src/app/documentos/conservacao/_components/ConservacaoSubNav.tsx`) ganha
uma terceira aba, "Dashboard", ao lado de "Documentos" e "Notas Fiscais".

## Métricas

1. **Total de notas**: contagem simples de todas as notas retornadas.
2. **Total por conservadora**: lista agrupada por `prestador_nome`, com
   contagem de notas e soma de `valor` por conservadora.
3. **Distribuição por status**: contagem de `aguardando_verificacao` /
   `concluida` / `rejeitada`, exibida como cards + barra proporcional.
4. **Notas atrasadas**: contagem de notas cujo
   `getSemaforoRecebimentoNota(data_recebimento, status)` (sub-projeto 2)
   retorna `status === "vermelho"` — destacado como card de alerta.
5. **Ranking de conservadoras com mais atrasos**: top prestadores por
   contagem de notas atrasadas (item 4), ordenado decrescente.
6. **Valor total**: soma de `valor` de todas as notas retornadas
   (independente do status).
7. **Evolução mensal de envios**: contagem de notas agrupadas por
   `competencia` (campo já no formato "MM/AAAA"), exibida como barras
   horizontais, uma por mês, ordenadas cronologicamente.

## Testes / verificação

- Com pelo menos duas conservadoras e notas em diferentes status, confirmar
  que o total geral, a distribuição por status e o total por conservadora
  batem com a contagem manual dos dados.
- Criar uma nota com `data_recebimento` de 8+ dias atrás e `status =
  aguardando_verificacao`: confirmar que ela conta no card "Notas atrasadas"
  e aparece no ranking de atrasos para o prestador correspondente.
- Confirmar que a soma de "Valor total" corresponde à soma manual dos
  valores das notas visíveis.
- Confirmar que a aba "Dashboard" aparece na sub-navegação e segue a mesma
  regra de acesso (admin + aprovadores) das demais abas de Conservação.
