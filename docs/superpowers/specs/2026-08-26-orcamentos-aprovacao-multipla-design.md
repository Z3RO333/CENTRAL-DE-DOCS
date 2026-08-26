# Aprovação por qualquer gestor + revisão em lote — Orçamentos Internos

## Contexto

Hoje, ao enviar um orçamento interno para aprovação, o solicitante escolhe **um único gestor responsável** (`gestor_email`), e só esse gestor específico pode decidir (aprovar/assinar, rejeitar, pedir ajuste). Isso trava o fluxo quando o gestor escolhido está ausente — outro gestor da mesma lista de aprovadores não consegue agir mesmo estando disponível.

Além disso, o envio em lote de PDFs implementado numa iteração anterior criava e analisava cada rascunho em segundo plano sem mostrar o resultado da IA — o usuário só via os dados extraídos ao reabrir cada rascunho manualmente na lista. O pedido é que cada arquivo do lote mostre sua própria caixa de revisão (dados extraídos pela IA), todas na mesma tela, logo após a análise.

## Objetivo

1. Eliminar a atribuição de um gestor único no envio. Qualquer um dos aprovadores cadastrados em `orcamentos_internos_aprovadores` (hoje 3 pessoas) pode ver e decidir qualquer orçamento pendente — quem agir primeiro "ganha" a decisão.
2. Ao enviar múltiplos PDFs de uma vez, mostrar uma caixa de revisão por arquivo (mesmos campos da revisão de 1 arquivo hoje), empilhadas na mesma tela, permitindo editar e enviar/salvar cada uma individualmente.

## Não-objetivos

- Não mexe no fluxo de aprovação de outros tipos de documento (só `orcamentos_internos`).
- Não adiciona notificação por e-mail/push quando um orçamento é decidido por outro gestor (fora do escopo pedido).
- Não muda a tabela `orcamentos_internos_aprovadores` (continua sendo a fonte da lista de quem pode aprovar).

## Comportamento atual relevante (para quem for implementar)

- `canViewOrcamento` (`src/lib/orcamentosInternos.ts:248`) **já** permite que qualquer aprovador veja qualquer orçamento (`aprovadores.has(actorEmail)`). Não precisa mudar.
- `assertCanDecide` (`src/lib/orcamentosInternos.ts:289`) hoje exige `isAprovador && isGestorAtribuido` — é essa segunda condição que precisa cair.
- O update de decisão (`aprovar_assinar`, `rejeitar`, etc. em `src/app/api/orcamentos-internos/[id]/route.ts`) já faz `.eq("id", id).eq("status", from)` — ou seja, já existe trava otimista contra corrida entre dois gestores. Só falta uma mensagem de erro amigável quando `data` vier vazio por já ter sido decidido.
- `orcamentos_internos.gestor_email` é uma coluna `NOT NULL` (tipo `string`, não `string | null` no código) — hoje sempre populada no envio. Vai continuar existindo, só que fica com string vazia (`""`) enquanto pendente, e passa a ser preenchida **só no momento da decisão**, com quem decidiu.

## Mudanças — Backend

### `src/lib/orcamentosInternos.ts`

- `validateOrcamentoInput` (modo `"submit"`): remover a entrada `[input.gestorEmail, "Selecione o gestor responsável pela aprovação."]` da lista `required`. Gestor deixa de ser exigido no envio.
- `assertCanDecide`: trocar a condição de bloqueio de `(!isAprovador || !isGestorAtribuido)` para `!isAprovador` (mantendo o `!actor.realIsAdmin` que já existe). Ou seja, qualquer aprovador cadastrado — não só o "atribuído" — pode decidir. A variável `isGestorAtribuido` e o cálculo de `gestorEmail`/`row.gestor_email` dentro dessa função deixam de ser necessários e podem ser removidos.

### `src/app/api/orcamentos-internos/route.ts` (POST — criar rascunho/enviar)

- Remover o bloco que valida `gestorEmail` contra `aprovadores.has(gestorEmail)` (linhas ~257-278 e ~318-320 hoje usam/gravam `gestor_email`/`gestor_id`/`gestor_nome` vindos do body). Ao criar (`submit: false` ou `true`), gravar sempre `gestor_id: null, gestor_email: "", gestor_nome: null` — ninguém é atribuído no envio.
- O parâmetro `gestorEmail`/`gestorId`/`gestorNome` no corpo da requisição de criação deixa de ser lido/usado.

### `src/app/api/orcamentos-internos/route.ts` (GET — listar)

- Bloco de visibilidade para quem não é admin nem aprovador (linhas ~83-96): remover as cláusulas `gestor_id.eq.${actor.userId}` e `gestor_email.eq.${actor.email}` do `or(...)` — elas dependiam de atribuição prévia, que não existe mais. Mantém só `solicitante_id.eq.${actor.userId}`.
- Aba `tab === "aprovacao"` (linhas ~104-115): remover o filtro `or(gestor_id.eq / gestor_email.eq)` — a query já está restrita por `status in [...]`; isso já é suficiente porque a visibilidade ampla pra aprovadores é garantida pela ausência do bloco restritivo do passo anterior (linha 83, `!isAprovador` já libera todos os aprovadores). Resultado: qualquer aprovador vendo essa aba enxerga **todos** os pendentes, não só os "seus".
- O filtro `?gestor=email` (linha ~129-131, `query.eq("gestor_email", gestor)`) pode continuar existindo — agora funciona como "filtrar por quem decidiu" em vez de "quem foi atribuído". Não precisa mudar o código, só o rótulo no frontend (ver abaixo).

### `src/app/api/orcamentos-internos/[id]/route.ts` (PATCH)

- `enviar_aprovacao` / `reenviar` (linha ~306+): remover qualquer leitura/validação de `gestorEmail` vinda do body nessa ação (a validação já cai por conta da mudança em `validateOrcamentoInput`; conferir se não há checagem adicional solta no handler).
- `aprovar_assinar` (linha ~569): no objeto passado pro `.update(...)`, adicionar:
  ```ts
  gestor_id: actor.realUserId,
  gestor_email: actor.realEmail ?? "",
  gestor_nome: null,
  ```
  (`Actor`, definido em `src/lib/apiAuth.ts:66`, não tem campo de nome — só `realUserId`/`realEmail`/`realIsAdmin`. `gestor_nome` fica sempre `null` nessas gravações; a UI já cai para `gestor_email` quando `gestor_nome` é vazio, então não há necessidade de buscar o nome em outro lugar.)
  Se `data` vier `null`/erro porque o `.eq("status", from)` não bateu (outro gestor decidiu primeiro), retornar erro amigável: `throw new HttpError(409, "Este orçamento já foi decidido por outro gestor.")` em vez do erro genérico atual.
- `rejeitar` (linha ~511) e `solicitar_ajuste` (linha ~478): mesma lógica — gravar `gestor_id: actor.realUserId, gestor_email: actor.realEmail ?? "", gestor_nome: null` (quem tomou a decisão), e o mesmo tratamento de conflito de concorrência (409 amigável) quando o update não encontrar linha pelo filtro de status.
- `devolver_sem_decisao` (linha ~545): **não** grava gestor — por definição essa ação não é uma decisão.
- **Remover inteiramente a ação `reatribuir_gestor`** (linhas ~618-646) — não faz sentido reatribuir algo que não é mais atribuído previamente. Remover o branch `if (action === "reatribuir_gestor") {...}` e o tipo `"reatribuir_gestor"` de `OrcamentoInternoAction` em `orcamentosInternos.ts`.
- No handler `GET /api/orcamentos-internos/[id]` (detalhe de um orçamento), linhas ~142-174:
  - A variável `isGestor` (linha ~145-147, hoje `orcamento.gestor_id === actor.realUserId || actorRealEmail === gestor_email`) controla duas coisas: (a) se registra o evento `orcamento_visualizado_gestor` ao abrir o detalhe, e (b) o campo `canDecide` retornado ao frontend (linha ~170-174, hoje `actor.realIsAdmin || (actorIsAprovador && isGestor)`).
  - Trocar `isGestor` para simplesmente `actorIsAprovador` (já calculado na linha 143-144) nos dois usos — ou seja, remover a variável `isGestor` e usar `actorIsAprovador` diretamente em ambos os lugares. Isso faz o evento de "visualizado pelo gestor" disparar para qualquer aprovador que abrir o orçamento, e `canDecide` virar `actor.realIsAdmin || actorIsAprovador`.

### Verificar `Actor` (`src/lib/apiAuth.ts`)

- Confirmar se existe um campo de nome do usuário real (ex. `realNome`/`realName`) pra popular `gestor_nome` na decisão. Se não existir, `gestor_nome` fica `null` nesses updates (aceitável — a UI já cai pra `gestor_email` quando `gestor_nome` é vazio, conforme `page.tsx:763` e `:860`).

## Mudanças — Frontend

### `src/app/documentos/orcamentos-internos/_components/OrcamentoIntakeForm.tsx`

**Remover o campo de gestor:**
- Tirar `gestorEmail` de `FormValues`/`EMPTY_VALUES`.
- Remover o `<label>`/`<select>` "Gestor responsável *" do JSX de revisão.
- Remover o parâmetro `gestores: GestorOption[]` da prop `Props` (não é mais usado pra escolher — mas cuidado: `page.tsx` ainda usa `gestores` pra outras coisas como o filtro da lista e o antigo painel de reatribuição, que também está sendo removido; ver seção da listagem abaixo antes de decidir se o fetch de `gestores` na página continua necessário).
- Em `persistDraft`, remover a checagem `if (submit && !values.gestorEmail)` e o envio de `gestorId`/`gestorEmail`/`gestorNome` no body do PATCH.
- No botão "Enviar para aprovação", remover `!values.gestorEmail` da condição `disabled`.

**Extrair a caixa de revisão num subcomponente `OrcamentoReviewCard`:**

Criar `src/app/documentos/orcamentos-internos/_components/OrcamentoReviewCard.tsx`, um componente controlado (sem chamadas de rede própria) que recebe:

```ts
type OrcamentoReviewCardProps = {
  fileName: string;
  values: ReviewValues; // FormValues sem solicitanteId/gestorEmail: prestadorId, prestadorNome, fornecedorCnpj, numeroOrcamento, valorTotal, dataValidade, descricao, observacoes
  onChange: (values: ReviewValues) => void;
  confidence: number | null;
  alerts: string[];
  onReanalyze?: () => void; // opcional; não existe no card de lote se não fizer sentido reanalisar em lote, mas existe no fluxo de 1 arquivo
  onSaveDraft: () => void;
  onSubmit: () => void;
  busy: "saving" | "submitting" | "analyzing" | null;
  error: string | null;
  success: string | null;
};
```

Esse componente contém exatamente o bloco de JSX que hoje vive dentro do `{draftId ? (...) : null}` do `OrcamentoIntakeForm` (linhas ~402-553 antes da mudança): nome do arquivo + botão reanalisar, confiança/alertas, os campos (fornecedor, CNPJ, número, valor, validade, descrição, observações) e os botões "Salvar rascunho"/"Enviar para aprovação" — **sem** o campo de gestor.

`OrcamentoIntakeForm` passa a usar esse subcomponente pro fluxo de 1 arquivo (estado único que já existe: `values`, `draftId`, `confidence`, `alerts`, `working`, `error`, `success`), mantendo o comportamento visual idêntico ao de hoje (menos o campo de gestor).

**Fluxo de lote (2+ arquivos selecionados):**

Novo estado:
```ts
type BulkDraft = {
  orcamentoId: string;
  fileName: string;
  values: ReviewValues;
  confidence: number | null;
  alerts: string[];
  busy: "analyzing" | "saving" | "submitting" | null;
  error: string | null;
  success: string | null;
};
const [bulkDrafts, setBulkDrafts] = useState<BulkDraft[]>([]);
```

Ao clicar em enviar com múltiplos arquivos selecionados (`files.length > 1`):
1. Para cada arquivo, sequencialmente: sobe o PDF, `POST /api/orcamentos-internos` (`submit:false`, sem `gestorEmail`), adiciona uma entrada em `bulkDrafts` com `busy: "analyzing"` e chama `onUpsert` (aparece na lista "Meus orçamentos" na hora).
2. Roda `POST /api/orcamentos-internos/{id}/analisar`, preenche `values`/`confidence`/`alerts` daquela entrada com a sugestão da IA, `busy: null`. **Não** faz mais o auto-persist via PATCH que eu tinha adicionado numa iteração anterior — agora quem persiste é o próprio usuário revisando a caixa (clicando "Salvar rascunho" ou "Enviar para aprovação"), então esse hack de auto-save deixa de ser necessário e deve ser removido.
3. Renderiza uma `OrcamentoReviewCard` por entrada de `bulkDrafts`, empilhadas, assim que cada uma estiver pronta (não precisa esperar todas — ir aparecendo conforme cada análise termina).
4. Cada card tem seus próprios botões "Salvar rascunho"/"Enviar para aprovação", operando só sobre aquele `orcamentoId` (reusa a mesma lógica de `persistDraft`, parametrizada por id e pelo `values` daquela entrada específica, atualizando só aquele item do array `bulkDrafts` e chamando `onUpsert`).
5. Sem campo de "enviar em nome de" por card — a escolha de `solicitanteId` continua sendo feita uma vez, no topo, antes do envio do lote (comportamento já existente, não muda).
6. Falha em upload/criação de um arquivo específico: registra erro nesse item (ou não cria entrada em `bulkDrafts`, mostra na lista de erros da tela) e segue pros próximos arquivos — não trava o lote inteiro (mesma tolerância a falha parcial da versão anterior).

Fluxo de 1 arquivo (`files.length === 1`) continua exatamente como hoje: entra no estado único `draftId`, sem passar pelo array `bulkDrafts`.

### `src/app/documentos/orcamentos-internos/page.tsx`

- Remover o painel "Reatribuir gestor" (bloco `isAdmin` por volta da linha 976-1015) e o estado/handler associado (`reassignEmail`, chamada com `action: "reatribuir_gestor"`).
- Coluna "Gestor" na tabela (linha ~725/~763) e no painel de detalhe (linha ~860): mantém o mesmo código (`gestor_nome || gestor_email || "--"`), só que agora reflete "quem decidiu" — sem mudança de código, só de significado. Opcional: renomear o cabeçalho de "Gestor" para "Decidido por" pra deixar claro (recomendo fazer, é uma troca de string só).
- Filtro "Gestor" no topo da lista (linha ~643-652): mantém, mas também renomear o rótulo pra refletir que filtra por quem decidiu (ex. "Decidido por"), já que a lista de `gestores` usada ali vem do endpoint `/api/orcamentos-internos/gestores` (lista de aprovadores cadastrados) — continua fazendo sentido como filtro.
- Conferir se `gestores` (estado buscado via `/api/orcamentos-internos/gestores`) ainda é necessário como prop pro `OrcamentoIntakeForm` — não é mais (não há mais seletor de gestor no envio) — remover essa prop da chamada do componente, mas manter o fetch de `gestores` na página pro filtro e pra exibição.

## Testes

### `src/lib/orcamentosInternos.test.ts`

- `"exige fornecedor e gestor ao enviar para aprovação"`: atualizar — não deve mais exigir gestor. Renomear pra `"exige fornecedor ao enviar para aprovação"` e remover a asserção sobre gestor obrigatório (manter a de fornecedor).
- `"impede que outro aprovador decida o orçamento"`: **remover este teste** — o comportamento que ele verifica deixa de existir por design (qualquer aprovador pode decidir agora).
- `"permite decisão do aprovador atribuído"`: renomear pra algo como `"permite decisão de qualquer aprovador cadastrado"` e adicionar um caso extra comprovando que um aprovador **diferente** do que estava em `gestor_email` também consegue decidir (`assertCanDecide` não deve lançar).
- `"impede decisão em orçamento já encerrado"`: mantém, sem mudança.
- Adicionar um teste novo: aprovador que não está no `Set` de aprovadores (nem admin) continua bloqueado por `assertCanDecide` (garante que não abrimos demais — qualquer um só se estiver na lista de aprovadores).

### Testes manuais (via Playwright, como já vem sendo feito nesta sessão)

1. Criar um orçamento, enviar pra aprovação, confirmar que não há mais campo de gestor no formulário.
2. Logar como um aprovador diferente do que "seria o de sempre" (não existe mais atribuição, então qualquer um dos 3 configurados em `orcamentos_internos_aprovadores`) e confirmar que consegue ver e aprovar/rejeitar/pedir ajuste normalmente.
3. Subir 3 PDFs de uma vez e confirmar que aparecem 3 caixas de revisão na mesma tela, cada uma editável e enviável independentemente.
4. Confirmar que a coluna "Gestor"/"Decidido por" fica "--" enquanto pendente e mostra o nome de quem decidiu depois de aprovado/rejeitado.

## Migração de dados

Não precisa de migração de schema (colunas continuam as mesmas, só muda quando são preenchidas). Orçamentos já pendentes no banco no momento do deploy têm `gestor_email` populado com o gestor "atribuído" antigo — isso é inofensivo: com `assertCanDecide` mudado, qualquer aprovador já passa a poder decidi-los mesmo com esse valor antigo ainda no campo (ele é sobrescrito na decisão). Não requer backfill.
