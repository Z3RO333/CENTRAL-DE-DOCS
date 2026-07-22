# Selo de prazo (7 dias) para NF de conservadora — sub-projeto 2/5

## Contexto

Sub-projeto 2 da reformulação do controle de conservadoras (sub-projeto 1,
cadastro estruturado, já implementado e mesclado em `master`). O pedido
original previa alerta por e-mail/Teams, mas foi simplificado durante o
brainstorming: **sem envio de e-mail** — apenas um selo visual (semáforo) na
própria nota, dentro da tabela de gestão já existente.

## Fora de escopo

- Envio de e-mail, Teams, ou qualquer notificação — decisão explícita do
  usuário: "não é pra mandar nada por e-mail, é só pra avisar na nota mesmo".
- Qualquer cron job, agendador, ou rota `disparar` — não é necessário, já que
  o cálculo é derivado em tempo real a partir de dados já existentes.
- Verificação com BTracker — sub-projeto 3, separado.
- Dashboard de acompanhamento — sub-projeto 4, separado.

## Regra do prazo

- Só se aplica a notas com `status = 'aguardando_verificacao'` — notas
  `concluida`/`rejeitada` já foram resolvidas e não mostram selo de prazo.
- Contagem de dias corridos desde `data_recebimento` até hoje.
- Classificação:
  - 0–3 dias: **verde**, "Dentro do prazo".
  - 4–6 dias: **amarelo**, "Atenção".
  - 7 dias ou mais: **vermelho**, "Atrasada".

## Arquitetura

Nenhuma mudança de banco de dados ou de API. `data_recebimento` e `status`
já são retornados por `GET /api/notas-fiscais-conservacao` (sub-projeto 1).
O cálculo é feito inteiramente no cliente, seguindo o mesmo padrão já usado
para o semáforo de vencimento de Contratos (`getSemaforoVencimento` /
`SEMAFORO_BADGE` em `src/app/documentos/_lib/documentosShared.ts`).

## Implementação

- Novo helper `getSemaforoRecebimentoNota(dataRecebimento, status)` em
  `src/app/documentos/_lib/documentosShared.ts`, reaproveitando o tipo
  `SemaforoStatus` e o mapa `SEMAFORO_BADGE` já existentes:
  - Retorna `null` quando `status !== "aguardando_verificacao"`.
  - Caso contrário, retorna `{ status: SemaforoStatus; label: string }`
    conforme a regra de dias acima (rótulos: "Dentro do prazo", "Atenção",
    "Atrasada").
- Nova coluna "Prazo" na tabela de
  `src/app/documentos/conservacao/notas-fiscais/page.tsx`, mostrando o selo
  (ou "-" quando `getSemaforoRecebimentoNota` retorna `null`).

## Testes / verificação

- Nota com `data_recebimento` de hoje e `status = aguardando_verificacao`:
  selo verde "Dentro do prazo".
- Nota com `data_recebimento` de 5 dias atrás: selo amarelo "Atenção".
- Nota com `data_recebimento` de 8 dias atrás: selo vermelho "Atrasada".
- Nota com `status = concluida` (independente da data): sem selo, célula
  mostra "-".
