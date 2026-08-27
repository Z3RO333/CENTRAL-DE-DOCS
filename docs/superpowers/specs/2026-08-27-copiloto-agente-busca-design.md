# Copiloto de documentos como agente de busca real

## Contexto

O copiloto atual (`src/lib/documentosCopilot.ts`) faz uma única chamada ao
Azure OpenAI por pergunta: o modelo recebe a mensagem do usuário, a lista
completa de lojas e prestadores conhecidos, e devolve um JSON com filtros
extraídos. Um conjunto de regras determinísticas (`applyDeterministicFilters`,
`resolveEntityFilters`) tenta reforçar/corrigir esses filtros por regex, e
uma única query roda contra o Supabase.

Problemas que motivam a mudança:

- **Sem refinamento**: se o modelo erra a extração, não há segunda chance —
  o usuário precisa reformular a pergunta do zero.
- **Conhecimento de entidades frágil**: lojas/prestadores são resolvidos por
  correspondência exata de string normalizada ou por regex de substring,
  o que falha para apelidos e nomes parciais (ex: "loja avenida" quando o
  nome real é "302 - Avenida Paulista").
- **Uma busca só**: não há como comparar lojas, cruzar critérios, ou fazer
  perguntas de acompanhamento que dependem do resultado anterior.
- **Sem memória**: cada pergunta é isolada; a tela não mantém histórico de
  conversa.

Além disso, já foi corrigido separadamente um bug em que `lojaId`/
`prestadorId` resolvidos pelo copiloto eram computados mas nunca aplicados
como filtro real de query quando o usuário tem acesso total aos documentos
(`canAccess === true`) — esse fix permanece e é a base sobre a qual as
ferramentas de busca abaixo são construídas.

## Objetivo

Transformar o copiloto em um agente de busca real: o modelo recebe
ferramentas (function calling) e decide sozinho quantos passos dar antes de
responder — pode buscar documentos, procurar lojas/prestadores por nome
parcial, refinar a busca e responder perguntas de acompanhamento usando o
histórico da conversa.

Fora de escopo (decidido explicitamente): o agente não executa ações que
alterem estado nem aplica filtros/abre documentos sozinho — ele só busca e
explica; toda ação continua exigindo um clique do usuário, como hoje
("Aplicar na tela de documentos", "Abrir"). Histórico de conversa não é
persistido no banco — vive apenas no estado do componente React enquanto a
tela está aberta.

## Validação de viabilidade

Testado diretamente contra o deployment Azure atual (`gpt-5-chat`,
endpoint/chave já configurados em `.env`): uma chamada com `tools` +
`tool_choice: "auto"` retornou corretamente `finish_reason: "tool_calls"` e
os argumentos estruturados esperados. Tool-calling nativo funciona nesse
deployment sem workaround.

## Arquitetura

### Fluxo por turno

1. O cliente envia o histórico da conversa (últimas ~10 mensagens) + a nova
   pergunta para `POST /api/documentos/copilot`.
2. O servidor monta as mensagens (system prompt + histórico + nova pergunta)
   e entra em um loop de **no máximo 5 iterações**:
   - Chama o Azure OpenAI com as 3 ferramentas disponíveis (`tools`,
     `tool_choice: "auto"`).
   - Se a resposta tiver `tool_calls`: executa cada chamada contra o
     Supabase, anexa o resultado como mensagem `role: "tool"`, volta ao
     passo anterior.
   - Se a resposta não tiver `tool_calls` (texto final): encerra o loop,
     esse é o `reply` final.
   - Se atingir 5 iterações sem resposta final: encerra o loop e usa o texto
     do modelo (ou uma mensagem padrão) mais o resultado do último
     `buscar_documentos` executado, se houver. Nunca falha silenciosamente
     nem trava.
3. A resposta ao cliente carrega `{ reply, filters, results, insights }`
   vindos do **último** `buscar_documentos` chamado no turno (se nenhum foi
   chamado, `results`/`insights` ficam vazios e a resposta é só texto —
   ex: pergunta de clarificação).

### Ferramentas expostas ao modelo

Todas implementadas em `src/lib/documentosCopilot.ts`, reaproveitando o que
já existe:

- **`buscar_documentos(filters)`** — mesma forma de `DocumentoCopilotFilters`
  hoje aceita pelo prompt. Internamente passa pela normalização
  determinística existente (`stripKnownFilters`, `normalizeTipoValue`,
  `normalizeStatusValue`, `normalizeMesValue`) antes de rodar
  `queryDocumentoCandidates` (já com o fix de aplicar `lojaId`/`prestadorId`
  como filtro real de query). Devolve `{ matches, total, insights }`
  truncado para caber no contexto (resumo, não a lista completa de campos).
- **`buscar_lojas(query)`** — nova função. Faz `ilike` em `nome`/`codigo` da
  tabela `lojas` com o termo, limitado a ~15 resultados, devolve
  `{id, nome, codigo}[]`. Substitui o envio da lista completa de lojas no
  prompt e o regex de substring atual (`findLojaMentionInMessage`).
- **`buscar_prestadores(query)`** — mesma ideia para `prestadores`.

Isso elimina a necessidade de mandar as ~2000 lojas/prestadores no prompt em
toda pergunta — o modelo busca sob demanda, sempre com IDs reais vindos do
banco (nunca inventados).

### Regras de comportamento (system prompt)

Mantidas/reforçadas do prompt atual:

- Nunca inventar documentos, IDs ou dados fora do que as ferramentas
  devolveram.
- Nunca aplicar ação (só ler/buscar/explicar).
- Se `buscar_lojas`/`buscar_prestadores` devolver mais de um resultado
  plausível e a pergunta não distinguir entre eles, perguntar qual antes de
  buscar documentos — não chutar o primeiro.
- Responder sempre em português, de forma curta e direta.

### Estado da conversa

- Vive inteiramente no componente `DocumentosCopilot.tsx`, como
  `useState<Mensagem[]>`. Não há tabela nova nem persistência no Supabase.
- Cada mensagem do assistente carrega os campos daquele turno:
  `{ role: "assistant", reply, filters, results, insights }`. Mensagens do
  usuário só têm `{ role: "user", text }`.
- Ao enviar uma nova pergunta, o cliente serializa o histórico (texto de
  cada turno, sem os cards de resultado) e manda pro backend, que
  reconstrói as mensagens do modelo a partir disso.
- Um botão "Nova conversa" zera o array e começa do zero.

## Mudanças na tela

`DocumentosCopilot.tsx` deixa de mostrar só a última resposta e passa a
renderizar a lista de mensagens como uma thread — bolha de pergunta do
usuário, seguida da resposta do assistente com o card de filtros/insights/
resultados daquele turno (reaproveitando o markup atual, só que repetido por
mensagem em vez de uma vez só). O restante da UI (botão enviar, textarea,
"Aplicar na tela de documentos", "Abrir" por documento) continua igual.

## Testes

- Unitário: `buscar_lojas`/`buscar_prestadores` (query parcial → resultados
  esperados, incluindo nenhum e múltiplos matches).
- Unitário: o loop de tool-calling corta em 5 iterações e ainda devolve uma
  resposta utilizável (simulando um mock do Azure OpenAI que sempre pede
  tool_call).
- Integração: pergunta com nome parcial de loja ambíguo → agente pergunta
  qual loja antes de buscar (não devolve tudo).
- Integração: pergunta de acompanhamento ("e da loja X?") depois de uma
  busca anterior → usa o histórico corretamente sem repetir contexto.
- Regressão manual: os cenários do bug já corrigido (loja não filtrada para
  usuário com acesso total) continuam corretos dentro do novo fluxo.
