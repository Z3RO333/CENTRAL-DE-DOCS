# Aprovação por qualquer gestor + revisão em lote — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que qualquer gestor cadastrado (não só um "atribuído") decida orçamentos internos pendentes, e mostrar uma caixa de revisão da IA por arquivo quando vários PDFs são enviados de uma vez.

**Architecture:** Muda a autorização de decisão em `src/lib/orcamentosInternos.ts` e nas rotas de API de `orcamentos-internos` pra não depender mais de um gestor atribuído no envio; as colunas `gestor_id/gestor_email/gestor_nome` passam a ser preenchidas só no momento da decisão (quem decidiu). No frontend, extrai a caixa de revisão do orçamento num componente `OrcamentoReviewCard` reutilizável, usado tanto no envio de 1 arquivo quanto em uma lista de caixas quando vários arquivos são enviados de uma vez.

**Tech Stack:** Next.js App Router (TypeScript), Supabase (Postgres), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-orcamentos-aprovacao-multipla-design.md`

## Global Constraints

- Não pode haver migração de schema — as colunas `gestor_id/gestor_email/gestor_nome` continuam existindo, só muda quando/quem as preenche.
- `gestor_email` na tabela `orcamentos_internos` é `NOT NULL` — sempre gravar `""` quando não houver decisor ainda, nunca `null`.
- `Actor` (`src/lib/apiAuth.ts`) não tem campo de nome — `gestor_nome` gravado nas ações de decisão é sempre `null`.
- Toda mudança de código deve manter `npx tsc --noEmit` limpo e `npm test` passando (126 testes hoje, mais os que este plano adiciona/edita) antes de cada commit.
- Mensagens de erro e rótulos de UI em português, seguindo o padrão já usado no arquivo.

---

### Task 1: Autorização — qualquer aprovador pode decidir

**Files:**
- Modify: `src/lib/orcamentosInternos.ts:164-196` (`validateOrcamentoInput`), `src/lib/orcamentosInternos.ts:20-30` (`OrcamentoInternoAction`), `src/lib/orcamentosInternos.ts:289-312` (`assertCanDecide`)
- Test: `src/lib/orcamentosInternos.test.ts` (reescrita completa)

**Interfaces:**
- Consumes: nada de tarefas anteriores (primeira tarefa do plano).
- Produces: `assertCanDecide(row, actor, aprovadores)` continua com a mesma assinatura, mas não exige mais que `actor` seja o "gestor atribuído" do `row` — só que esteja no `Set<string>` de aprovadores (ou seja admin). `validateOrcamentoInput` não exige mais `gestorEmail` no modo `"submit"`. `OrcamentoInternoAction` não inclui mais `"reatribuir_gestor"`. Tarefas seguintes (2 e 3) dependem desse comportamento.

- [ ] **Step 1: Reescrever os testes pra refletir o novo comportamento (vão falhar contra o código atual)**

Substituir o conteúdo inteiro de `src/lib/orcamentosInternos.test.ts` por:

```ts
import { describe, expect, it } from "vitest";
import {
  assertCanDecide,
  validateOrcamentoInput,
  type OrcamentoInternoRow,
} from "@/lib/orcamentosInternos";
import type { Actor } from "@/lib/apiAuth";

const arquivo = {
  path: "usuario/orcamentos_internos/originais/orcamento.pdf",
  name: "orcamento.pdf",
  type: "application/pdf",
  principal: true,
};

const baseRow: OrcamentoInternoRow = {
  id: "orcamento-1",
  solicitante_id: "solicitante-1",
  solicitante_email: "solicitante@bemol.com.br",
  loja_id: null,
  loja_nome: null,
  area_solicitante: "",
  prestador_id: null,
  prestador_nome: "Fornecedor Teste",
  fornecedor_cnpj: "00.000.000/0001-00",
  numero_orcamento: "ORC-10",
  descricao: "Serviço de teste",
  valor_total: 100,
  data_validade: null,
  numero_referencia: null,
  gestor_id: null,
  gestor_email: "",
  gestor_nome: null,
  observacoes: null,
  arquivo_original_path: arquivo.path,
  arquivo_assinado_path: null,
  status: "aguardando_aprovacao",
  versao_atual: 1,
  enviado_em: null,
  aprovado_em: null,
  rejeitado_em: null,
  cancelado_em: null,
  ultima_justificativa: null,
  created_at: "2026-07-23T00:00:00.000Z",
  updated_at: "2026-07-23T00:00:00.000Z",
};

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: "aprovador-1",
    email: "aprovador1@bemol.com.br",
    isAdmin: false,
    realUserId: "aprovador-1",
    realEmail: "aprovador1@bemol.com.br",
    realIsAdmin: false,
    isSimulating: false,
    ...overrides,
  };
}

describe("fluxo de orçamentos internos", () => {
  it("exige fornecedor ao enviar para aprovação", () => {
    expect(() =>
      validateOrcamentoInput({ arquivos: [arquivo] }, "submit"),
    ).toThrow("Confirme o fornecedor");

    expect(() =>
      validateOrcamentoInput(
        { arquivos: [arquivo], prestadorNome: "Fornecedor Teste" },
        "submit",
      ),
    ).not.toThrow();
  });

  it("aceita rascunho contendo somente o PDF", () => {
    expect(() =>
      validateOrcamentoInput({ arquivos: [arquivo] }, "draft"),
    ).not.toThrow();
  });

  it("permite decisão de qualquer aprovador cadastrado", () => {
    const aprovadores = new Set([
      "aprovador1@bemol.com.br",
      "aprovador2@bemol.com.br",
    ]);
    expect(() => assertCanDecide(baseRow, actor(), aprovadores)).not.toThrow();
    expect(() =>
      assertCanDecide(
        baseRow,
        actor({
          userId: "aprovador-2",
          email: "aprovador2@bemol.com.br",
          realUserId: "aprovador-2",
          realEmail: "aprovador2@bemol.com.br",
        }),
        aprovadores,
      ),
    ).not.toThrow();
  });

  it("impede decisão de quem não está na lista de aprovadores", () => {
    expect(() =>
      assertCanDecide(
        baseRow,
        actor({
          userId: "estranho-1",
          email: "naoaprovador@bemol.com.br",
          realUserId: "estranho-1",
          realEmail: "naoaprovador@bemol.com.br",
        }),
        new Set(["aprovador1@bemol.com.br", "aprovador2@bemol.com.br"]),
      ),
    ).toThrow("Somente um aprovador");
  });

  it("impede decisão em orçamento já encerrado", () => {
    expect(() =>
      assertCanDecide(
        { ...baseRow, status: "aprovado_assinado" },
        actor(),
        new Set(["aprovador1@bemol.com.br"]),
      ),
    ).toThrow("não está aguardando decisão");
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- --run src/lib/orcamentosInternos.test.ts`
Expected: FAIL — "exige fornecedor ao enviar para aprovação" e "permite decisão de qualquer aprovador cadastrado" devem falhar contra o código atual (o primeiro porque `validateOrcamentoInput` ainda lança erro de gestor mesmo sem esperar isso na segunda asserção do teste; o segundo porque `assertCanDecide` ainda exige o gestor atribuído específico).

- [ ] **Step 3: Remover a exigência de gestor em `validateOrcamentoInput`**

Em `src/lib/orcamentosInternos.ts`, dentro de `validateOrcamentoInput` (linha ~178-182), remover a linha do gestor da lista `required`:

```ts
  const required: Array<[unknown, string]> = [
    [principal?.path, "Anexe o orçamento principal em PDF."],
    [input.prestadorNome, "Confirme o fornecedor identificado no orçamento."],
  ];
```

(a entrada `[input.gestorEmail, "Selecione o gestor responsável pela aprovação."]` é removida)

- [ ] **Step 4: Liberar `assertCanDecide` pra qualquer aprovador cadastrado**

Substituir a função inteira (linhas ~289-312) por:

```ts
export function assertCanDecide(
  row: OrcamentoInternoRow,
  actor: Actor,
  aprovadores: Set<string>,
) {
  const actorEmail = normalizeEmail(actor.realEmail);
  const isAprovador = actorEmail !== null && aprovadores.has(actorEmail);
  if (!actor.realIsAdmin && !isAprovador) {
    throw new HttpError(
      403,
      "Somente um aprovador ou administrador pode decidir este orçamento.",
    );
  }
  if (!DECISAO_STATUS.has(row.status)) {
    throw new HttpError(400, "Este orçamento não está aguardando decisão.");
  }
}
```

- [ ] **Step 5: Remover `"reatribuir_gestor"` do tipo de ação**

Em `src/lib/orcamentosInternos.ts`, no tipo `OrcamentoInternoAction` (linhas ~20-30), remover a linha `| "reatribuir_gestor"`:

```ts
export type OrcamentoInternoAction =
  | "salvar_rascunho"
  | "enviar_aprovacao"
  | "solicitar_ajuste"
  | "reenviar"
  | "aprovar_assinar"
  | "rejeitar"
  | "devolver_sem_decisao"
  | "cancelar"
  | "corrigir_metadados";
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: PASS — tsc limpo, todos os testes (incluindo os 126 já existentes) passando.

- [ ] **Step 7: Commit**

```bash
git add src/lib/orcamentosInternos.ts src/lib/orcamentosInternos.test.ts
git commit -m "feat(orcamentos-internos): libera decisao para qualquer aprovador cadastrado"
```

---

### Task 2: Rotas de listagem e criação — sem atribuição de gestor no envio

**Files:**
- Modify: `src/app/api/orcamentos-internos/route.ts` (GET linhas 83-96 e 104-118; POST linhas 257-264, 267-280, 301-327)

**Interfaces:**
- Consumes: `assertCanDecide`/`validateOrcamentoInput` da Task 1 (indiretamente — esta rota chama `validateOrcamentoInput` no modo `"draft"`, que já não muda; o modo `"submit"` só é usado no PATCH, tarefa 3).
- Produces: `POST /api/orcamentos-internos` deixa de exigir/ler `gestorEmail`/`gestorId`/`gestorNome` do corpo da requisição, sempre grava `gestor_id: null, gestor_email: "", gestor_nome: null`. `GET /api/orcamentos-internos?tab=aprovacao` retorna todos os orçamentos pendentes pra qualquer aprovador, não só os "atribuídos" a ele. Tarefa 4 (frontend) depende de o `POST` não exigir mais gestor no corpo.

- [ ] **Step 1: Remover o filtro de gestor na visibilidade de quem não é admin nem aprovador (GET)**

Em `src/app/api/orcamentos-internos/route.ts`, substituir o bloco (linhas ~83-96):

```ts
    if (!actor.isAdmin && !isAprovador) {
      const ors: string[] = [];
      if (actor.userId) {
        ors.push(`solicitante_id.eq.${actor.userId}`);
        ors.push(`gestor_id.eq.${actor.userId}`);
      }
      if (actor.email) {
        ors.push(`gestor_email.eq.${actor.email}`);
      }
      if (ors.length === 0) {
        throw new HttpError(403, "Você não possui acesso aos orçamentos internos.");
      }
      query = query.or(ors.join(","));
    }
```

por:

```ts
    if (!actor.isAdmin && !isAprovador) {
      if (!actor.userId) {
        throw new HttpError(403, "Você não possui acesso aos orçamentos internos.");
      }
      query = query.eq("solicitante_id", actor.userId);
    }
```

- [ ] **Step 2: Simplificar a aba "aprovacao" pra mostrar todos os pendentes**

Substituir o bloco (linhas ~104-115):

```ts
    } else if (tab === "aprovacao") {
      query = query.in("status", [
        "aguardando_aprovacao",
        "em_analise_gestor",
        "reenviado",
      ]);
      const ors: string[] = [];
      if (actor.realUserId) ors.push(`gestor_id.eq.${actor.realUserId}`);
      if (actor.realEmail) ors.push(`gestor_email.eq.${actor.realEmail}`);
      query = query.or(
        ors.length > 0 ? ors.join(",") : "id.eq.00000000-0000-0000-0000-000000000000",
      );
    } else if (tab === "todos" && !actor.isAdmin && !isAprovador) {
```

por:

```ts
    } else if (tab === "aprovacao") {
      query = query.in("status", [
        "aguardando_aprovacao",
        "em_analise_gestor",
        "reenviado",
      ]);
    } else if (tab === "todos" && !actor.isAdmin && !isAprovador) {
```

(a visibilidade ampla pra qualquer aprovador já vem do Step 1 — o bloco restritivo é pulado inteiramente quando `isAprovador` é verdadeiro, então a aba "aprovacao" já enxerga todos os pendentes sem precisar filtrar por gestor)

- [ ] **Step 3: Remover a validação de gestor na criação (POST)**

Remover o bloco (linhas ~257-264):

```ts
    const gestorEmail = normalizeEmail(body.gestorEmail);
    const gestorId = normalizeText(body.gestorId) || null;
    if (submit) {
      const aprovadores = await getAprovadorEmails(supabaseAdmin);
      if (!gestorEmail || !aprovadores.has(gestorEmail)) {
        throw new HttpError(400, "Selecione um gestor aprovador válido.");
      }
    }
```

inteiramente (sem substituição).

- [ ] **Step 4: Remover gestor de `dados` (o JSON espelhado em `formularios`)**

Em `dados` (linhas ~267-280), remover as duas linhas de gestor:

```ts
    const dados = {
      tipo_interno: true,
      loja_id: lojaId,
      loja_nome: lojaNome,
      prestador: prestadorNome,
      fornecedor_cnpj: normalizeText(body.fornecedorCnpj) || null,
      numero_orcamento: normalizeText(body.numeroOrcamento),
      descricao: normalizeText(body.descricao),
      valor: parseValorTotal(body.valorTotal),
      data_validade: normalizeText(body.dataValidade),
      anexos: normalizeArquivos(body.arquivos ?? [], principal.path),
    };
```

- [ ] **Step 5: Gravar gestor vazio no insert (não vem mais do body)**

No insert em `orcamentos_internos` (linhas ~301-327), trocar:

```ts
        gestor_id: gestorId,
        gestor_email: gestorEmail ?? "",
        gestor_nome: normalizeText(body.gestorNome) || null,
```

por:

```ts
        gestor_id: null,
        gestor_email: "",
        gestor_nome: null,
```

- [ ] **Step 6: Verificar tipos e testes**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/orcamentos-internos/route.ts
git commit -m "feat(orcamentos-internos): remove atribuicao de gestor na criacao e listagem"
```

---

### Task 3: Rota de decisão — grava quem decidiu, remove reatribuição

**Files:**
- Modify: `src/app/api/orcamentos-internos/[id]/route.ts` (GET linhas 142-174; PATCH `enviar_aprovacao`/`reenviar` linhas 306-475; `solicitar_ajuste` linhas 478-509; `rejeitar` linhas 511-543; `aprovar_assinar` linhas 569-616; remover `reatribuir_gestor` linhas 618-646)

**Interfaces:**
- Consumes: `assertCanDecide` da Task 1 (já libera qualquer aprovador). Depende da Task 1 estar aplicada (senão o bloqueio antigo ainda vale e as novas chamadas de decisão de "outro aprovador" seriam rejeitadas pela função antiga).
- Produces: `PATCH /api/orcamentos-internos/[id]` com `action` em `solicitar_ajuste`/`rejeitar`/`aprovar_assinar` grava `gestor_id`/`gestor_email` de quem decidiu, e retorna HTTP 409 com mensagem amigável quando dois gestores tentam decidir ao mesmo tempo. `GET /api/orcamentos-internos/[id]` retorna `canDecide: true` pra qualquer aprovador (não só o atribuído). A ação `"reatribuir_gestor"` deixa de existir (a Task 5 remove o botão que a chamava no frontend).

- [ ] **Step 1: `GET` — trocar `isGestor` por `actorIsAprovador`**

Em `src/app/api/orcamentos-internos/[id]/route.ts`, substituir o bloco (linhas ~142-174):

```ts
    const actorRealEmail = normalizeEmail(actor.realEmail);
    const actorIsAprovador =
      actorRealEmail !== null && aprovadores.has(actorRealEmail);
    const isGestor =
      orcamento.gestor_id === actor.realUserId ||
      (actorRealEmail !== null && actorRealEmail === normalizeEmail(orcamento.gestor_email));
    if (isGestor) {
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "orcamento_visualizado_gestor",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        metadata: { status: orcamento.status },
      });
    }

    return NextResponse.json({
      orcamento: mapOrcamento(orcamento),
      versoes: ((versoesResult.data as OrcamentoInternoVersaoRow[] | null) ?? []),
      timeline:
        ((timelineResult.data as DocumentoAuditEvent[] | null) ?? []).map(
          (event) => ({
            ...event,
            metadata: event.metadata ?? {},
          }),
        ),
      isAdmin: actor.isAdmin,
      canDecide:
        ["aguardando_aprovacao", "em_analise_gestor", "reenviado"].includes(
          orcamento.status,
        ) &&
        (actor.realIsAdmin || (actorIsAprovador && isGestor)),
    });
```

por:

```ts
    const actorRealEmail = normalizeEmail(actor.realEmail);
    const actorIsAprovador =
      actorRealEmail !== null && aprovadores.has(actorRealEmail);
    if (actorIsAprovador) {
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "orcamento_visualizado_gestor",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        metadata: { status: orcamento.status },
      });
    }

    return NextResponse.json({
      orcamento: mapOrcamento(orcamento),
      versoes: ((versoesResult.data as OrcamentoInternoVersaoRow[] | null) ?? []),
      timeline:
        ((timelineResult.data as DocumentoAuditEvent[] | null) ?? []).map(
          (event) => ({
            ...event,
            metadata: event.metadata ?? {},
          }),
        ),
      isAdmin: actor.isAdmin,
      canDecide:
        ["aguardando_aprovacao", "em_analise_gestor", "reenviado"].includes(
          orcamento.status,
        ) &&
        (actor.realIsAdmin || actorIsAprovador),
    });
```

- [ ] **Step 2: `enviar_aprovacao`/`reenviar` — remover validação e gravação de gestor**

Substituir o bloco inteiro do `if (action === "enviar_aprovacao" || action === "reenviar") { ... }` (linhas ~306-475) por:

```ts
    if (action === "enviar_aprovacao" || action === "reenviar") {
      assertCanEditAsSolicitante(current, actor);
      validateOrcamentoInput(
        {
          ...body,
          lojaId: body.lojaId ?? current.loja_id,
          areaSolicitante: body.areaSolicitante ?? current.area_solicitante,
          prestadorId: body.prestadorId ?? current.prestador_id,
          prestadorNome: body.prestadorNome ?? current.prestador_nome,
          fornecedorCnpj: body.fornecedorCnpj ?? current.fornecedor_cnpj,
          numeroOrcamento: body.numeroOrcamento ?? current.numero_orcamento,
          descricao: body.descricao ?? current.descricao,
          valorTotal: body.valorTotal ?? current.valor_total,
          dataValidade: body.dataValidade ?? current.data_validade,
          arquivos:
            body.arquivos && body.arquivos.length > 0
              ? body.arquivos
              : [
                  {
                    path: current.arquivo_original_path,
                    name: current.arquivo_original_path.split("/").pop(),
                    type: "application/pdf",
                    principal: true,
                  },
                ],
        },
        "submit",
      );

      const principal =
        body.arquivos && body.arquivos.length > 0
          ? getArquivoPrincipal(body.arquivos)
          : {
              path: current.arquivo_original_path,
              name: current.arquivo_original_path.split("/").pop(),
              type: "application/pdf",
              principal: true,
            };
      if (!principal?.path) {
        throw new HttpError(400, "Arquivo principal não informado.");
      }

      const lojaId = normalizeText(body.lojaId) || current.loja_id;
      const prestadorId =
        Object.prototype.hasOwnProperty.call(body, "prestadorId")
          ? normalizeText(body.prestadorId) || null
          : current.prestador_id;
      const [lojaNome, prestadorNome] = await Promise.all([
        resolveLojaNome(lojaId, supabaseAdmin),
        resolvePrestadorNome(
          {
            prestadorId,
            prestadorNome: body.prestadorNome ?? current.prestador_nome,
          },
          supabaseAdmin,
        ),
      ]);

      const nextStatus: OrcamentoInternoStatus =
        action === "reenviar" ? "reenviado" : "aguardando_aprovacao";
      const nextVersion =
        body.arquivos && body.arquivos.length > 0
          ? current.versao_atual + 1
          : current.versao_atual;
      const updates = {
        loja_id: lojaId,
        loja_nome: lojaNome,
        area_solicitante:
          normalizeText(body.areaSolicitante) || current.area_solicitante,
        prestador_id: prestadorId,
        prestador_nome: prestadorNome,
        fornecedor_cnpj: Object.prototype.hasOwnProperty.call(body, "fornecedorCnpj")
          ? normalizeText(body.fornecedorCnpj) || null
          : current.fornecedor_cnpj,
        numero_orcamento: Object.prototype.hasOwnProperty.call(body, "numeroOrcamento")
          ? normalizeText(body.numeroOrcamento)
          : current.numero_orcamento,
        descricao: Object.prototype.hasOwnProperty.call(body, "descricao")
          ? normalizeText(body.descricao)
          : current.descricao,
        valor_total: Object.prototype.hasOwnProperty.call(body, "valorTotal")
          ? parseValorTotal(body.valorTotal)
          : current.valor_total,
        data_validade: Object.prototype.hasOwnProperty.call(body, "dataValidade")
          ? normalizeText(body.dataValidade) || null
          : current.data_validade,
        numero_referencia:
          normalizeText(body.numeroReferencia) || current.numero_referencia,
        observacoes: normalizeText(body.observacoes) || current.observacoes,
        arquivo_original_path: principal.path.trim(),
        status: nextStatus,
        versao_atual: nextVersion,
        enviado_em: new Date().toISOString(),
        ultima_justificativa: null,
      };
      const { data, error } = await supabaseAdmin
        .from("orcamentos_internos")
        .update(updates)
        .eq("id", id)
        .select("*")
        .single();
      if (error || !data) throw error ?? new Error("Falha ao reenviar.");

      if (body.arquivos && body.arquivos.length > 0) {
        const arquivos = normalizeArquivos(body.arquivos, principal.path);
        const { error: versoesError } = await supabaseAdmin
          .from("orcamentos_internos_versoes")
          .insert(
            arquivos.map((arquivo) => ({
              orcamento_id: id,
              versao: nextVersion,
              arquivo_path: arquivo.path,
              nome_arquivo: arquivo.name,
              mime_type: arquivo.type,
              tamanho_bytes: arquivo.size,
              principal: arquivo.principal,
              criado_por: actor.realUserId,
              criado_por_email: actor.realEmail,
            })),
          );
        if (versoesError) throw versoesError;
      }

      await updateFormularioStatus({
        supabaseAdmin,
        id,
        status: nextStatus,
        arquivoOriginalPath: principal.path.trim(),
        dadosUpdates: {
          loja_id: updates.loja_id,
          loja_nome: updates.loja_nome,
          prestador: updates.prestador_nome,
          fornecedor_cnpj: updates.fornecedor_cnpj,
          numero_orcamento: updates.numero_orcamento,
          descricao: updates.descricao,
          valor: updates.valor_total,
          data_validade: updates.data_validade,
        },
      });
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType:
          action === "reenviar"
            ? "orcamento_reenviado"
            : "orcamento_enviado_aprovacao",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        from,
        to: nextStatus,
        metadata: { notification: "aprovadores" },
      });
      return NextResponse.json({ orcamento: mapOrcamento(data as OrcamentoInternoRow) });
    }
```

- [ ] **Step 3: `solicitar_ajuste` — gravar decisor e erro de concorrência amigável**

Substituir o bloco (linhas ~478-509) por:

```ts
    if (action === "solicitar_ajuste") {
      assertCanDecide(current, actor, aprovadores);
      const justificativa = normalizeText(body.justificativa);
      if (!justificativa) {
        throw new HttpError(400, "Informe a justificativa do ajuste.");
      }
      const nextStatus: OrcamentoInternoStatus = "ajuste_solicitado";
      const { data, error } = await supabaseAdmin
        .from("orcamentos_internos")
        .update({
          status: nextStatus,
          ultima_justificativa: justificativa,
          gestor_id: actor.realUserId,
          gestor_email: actor.realEmail ?? "",
          gestor_nome: null,
        })
        .eq("id", id)
        .eq("status", from)
        .select("*")
        .single();
      if (error) throw error;
      if (!data) {
        throw new HttpError(409, "Este orçamento já foi decidido por outro gestor.");
      }
      await updateFormularioStatus({ supabaseAdmin, id, status: nextStatus });
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "ajuste_solicitado",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        from,
        to: nextStatus,
        justificativa,
        metadata: { notification: "solicitante" },
      });
      return NextResponse.json({ orcamento: mapOrcamento(data as OrcamentoInternoRow) });
    }
```

- [ ] **Step 4: `rejeitar` — gravar decisor e erro de concorrência amigável**

Substituir o bloco (linhas ~511-543) por:

```ts
    if (action === "rejeitar") {
      assertCanDecide(current, actor, aprovadores);
      const justificativa = normalizeText(body.justificativa);
      if (!justificativa) {
        throw new HttpError(400, "Informe a justificativa da rejeição.");
      }
      const nextStatus: OrcamentoInternoStatus = "rejeitado";
      const { data, error } = await supabaseAdmin
        .from("orcamentos_internos")
        .update({
          status: nextStatus,
          rejeitado_em: new Date().toISOString(),
          ultima_justificativa: justificativa,
          gestor_id: actor.realUserId,
          gestor_email: actor.realEmail ?? "",
          gestor_nome: null,
        })
        .eq("id", id)
        .eq("status", from)
        .select("*")
        .single();
      if (error) throw error;
      if (!data) {
        throw new HttpError(409, "Este orçamento já foi decidido por outro gestor.");
      }
      await updateFormularioStatus({ supabaseAdmin, id, status: nextStatus });
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "orcamento_rejeitado",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        from,
        to: nextStatus,
        justificativa,
        metadata: { notification: "solicitante" },
      });
      return NextResponse.json({ orcamento: mapOrcamento(data as OrcamentoInternoRow) });
    }
```

- [ ] **Step 5: `aprovar_assinar` — gravar decisor e erro de concorrência amigável**

Substituir o bloco (linhas ~569-616) por:

```ts
    if (action === "aprovar_assinar") {
      assertCanDecide(current, actor, aprovadores);
      const signedPath = normalizeText(body.signedFile?.path);
      if (!signedPath) {
        throw new HttpError(400, "Informe o arquivo assinado.");
      }
      const nextStatus: OrcamentoInternoStatus = "aprovado_assinado";
      const now = new Date().toISOString();
      const { data, error } = await supabaseAdmin
        .from("orcamentos_internos")
        .update({
          status: nextStatus,
          arquivo_assinado_path: signedPath,
          aprovado_em: now,
          ultima_justificativa: null,
          gestor_id: actor.realUserId,
          gestor_email: actor.realEmail ?? "",
          gestor_nome: null,
        })
        .eq("id", id)
        .eq("status", from)
        .select("*")
        .single();
      if (error) throw error;
      if (!data) {
        throw new HttpError(409, "Este orçamento já foi decidido por outro gestor.");
      }
      await updateFormularioStatus({
        supabaseAdmin,
        id,
        status: nextStatus,
        arquivoAssinadoPath: signedPath,
        assinadoPor: actor.realEmail,
      });
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "orcamento_aprovado",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        from,
        to: nextStatus,
        metadata: { approved_at: now, notification: "solicitante" },
      });
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "orcamento_assinado",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        metadata: { arquivo_assinado_path: signedPath },
      });
      return NextResponse.json({ orcamento: mapOrcamento(data as OrcamentoInternoRow) });
    }
```

- [ ] **Step 6: Remover a ação `reatribuir_gestor`**

Remover inteiramente o bloco (linhas ~618-646):

```ts
    if (action === "reatribuir_gestor") {
      if (!actor.realIsAdmin) {
        throw new HttpError(403, "Somente administradores podem reatribuir gestor.");
      }
      const gestorEmail = normalizeEmail(body.gestorEmail);
      if (!gestorEmail && !body.gestorId) {
        throw new HttpError(400, "Informe o novo gestor.");
      }
      const { data, error } = await supabaseAdmin
        .from("orcamentos_internos")
        .update({
          gestor_id: normalizeText(body.gestorId) || null,
          gestor_email: gestorEmail ?? "",
          gestor_nome: normalizeText(body.gestorNome) || null,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error || !data) throw error ?? new Error("Falha ao reatribuir.");
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "aprovador_alterado",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        metadata: { gestor_email: gestorEmail, gestor_id: body.gestorId },
      });
      return NextResponse.json({ orcamento: mapOrcamento(data as OrcamentoInternoRow) });
    }
```

(sem substituição — o próximo `if` do arquivo, `if (action === "cancelar")`, passa a vir logo depois de `enviar_aprovacao`/`reenviar`/`solicitar_ajuste`/`rejeitar`/`aprovar_assinar`)

- [ ] **Step 7: Verificar tipos e testes**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "src/app/api/orcamentos-internos/[id]/route.ts"
git commit -m "feat(orcamentos-internos): grava quem decidiu e libera decisao a qualquer aprovador"
```

---

### Task 4: Frontend — remover campo de gestor e mostrar uma caixa de revisão por arquivo no lote

**Files:**
- Create: `src/app/documentos/orcamentos-internos/_components/OrcamentoReviewCard.tsx`
- Modify: `src/app/documentos/orcamentos-internos/_components/OrcamentoIntakeForm.tsx` (reescrita completa)

**Interfaces:**
- Consumes: `POST /api/orcamentos-internos` sem exigir gestor (Task 2), `PATCH /api/orcamentos-internos/[id]` com `action: "salvar_rascunho" | "enviar_aprovacao"` sem gestor (Task 3 não mudou `salvar_rascunho`, e a Task 3 Step 2 já tira a exigência de gestor de `enviar_aprovacao`).
- Produces: `OrcamentoReviewCard` exporta `ReviewValues`, `EMPTY_REVIEW_VALUES`, `OrcamentoReviewCardBusy` e o componente `OrcamentoReviewCard`, usados pela Task 5 indiretamente (via `OrcamentoIntakeForm`, que a Task 5 invoca sem a prop `gestores`).

- [ ] **Step 1: Criar `OrcamentoReviewCard.tsx`**

```tsx
"use client";

import { FileSearch, LoaderCircle, Save, Send, Sparkles } from "lucide-react";

export type ReviewValues = {
  prestadorId: string;
  prestadorNome: string;
  fornecedorCnpj: string;
  numeroOrcamento: string;
  valorTotal: string;
  dataValidade: string;
  descricao: string;
  observacoes: string;
};

export const EMPTY_REVIEW_VALUES: ReviewValues = {
  prestadorId: "",
  prestadorNome: "",
  fornecedorCnpj: "",
  numeroOrcamento: "",
  valorTotal: "",
  dataValidade: "",
  descricao: "",
  observacoes: "",
};

export type OrcamentoReviewCardBusy =
  | "uploading"
  | "analyzing"
  | "saving"
  | "submitting"
  | null;

type Props = {
  fileName: string;
  values: ReviewValues;
  onChange: (values: ReviewValues) => void;
  confidence: number | null;
  alerts: string[];
  onReanalyze: (() => void) | null;
  onSaveDraft: () => void;
  onSubmit: () => void;
  busy: OrcamentoReviewCardBusy;
  error: string | null;
  success: string | null;
};

export function OrcamentoReviewCard({
  fileName,
  values,
  onChange,
  confidence,
  alerts,
  onReanalyze,
  onSaveDraft,
  onSubmit,
  busy,
  error,
  success,
}: Props) {
  const busyState = busy !== null;
  const update = (name: keyof ReviewValues, value: string) => {
    onChange({ ...values, [name]: value });
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
        <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-slate-700">
          <FileSearch className="h-4 w-4 shrink-0" />
          <span className="truncate">{fileName}</span>
        </span>
        {onReanalyze ? (
          <button
            type="button"
            onClick={onReanalyze}
            disabled={busyState}
            className="inline-flex items-center gap-1 font-semibold text-sky-700 disabled:opacity-50"
          >
            {busy === "analyzing" ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Analisar novamente
          </button>
        ) : null}
      </div>

      {(error || success) && (
        <div
          className={`mt-3 rounded-xl px-3 py-2 text-xs ${
            error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {error ?? success}
        </div>
      )}

      {confidence !== null ? (
        <p className="mt-3 text-[11px] text-slate-500">
          Confiança geral da leitura: {Math.round(confidence * 100)}%. Sempre confira os
          dados antes do envio.
        </p>
      ) : null}
      {alerts.length > 0 ? (
        <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {alerts.join(" ")}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Fornecedor identificado *
          <input
            value={values.prestadorNome}
            onChange={(event) =>
              onChange({ ...values, prestadorId: "", prestadorNome: event.target.value })
            }
            placeholder="Razão social ou nome da empresa"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          CNPJ
          <input
            value={values.fornecedorCnpj}
            onChange={(event) =>
              onChange({ ...values, prestadorId: "", fornecedorCnpj: event.target.value })
            }
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Número do orçamento
          <input
            value={values.numeroOrcamento}
            onChange={(event) => update("numeroOrcamento", event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Valor total
          <input
            type="number"
            min="0"
            step="0.01"
            value={values.valorTotal}
            onChange={(event) => update("valorTotal", event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Validade
          <input
            type="date"
            value={values.dataValidade}
            onChange={(event) => update("dataValidade", event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Descrição
          <textarea
            value={values.descricao}
            onChange={(event) => update("descricao", event.target.value)}
            className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Observações internas
          <textarea
            value={values.observacoes}
            onChange={(event) => update("observacoes", event.target.value)}
            className="mt-1 min-h-16 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={busyState}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {busy === "saving" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Salvar rascunho
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busyState || !values.prestadorNome.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
        >
          {busy === "submitting" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Enviar para aprovação
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar que o novo arquivo compila**

Run: `npx tsc --noEmit`
Expected: PASS (nenhum outro arquivo ainda importa `OrcamentoReviewCard`, então isso só confirma que o arquivo novo é válido isoladamente).

- [ ] **Step 3: Reescrever `OrcamentoIntakeForm.tsx` por completo**

Substituir o conteúdo inteiro do arquivo por:

```tsx
"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import type { ColaboradorOption, OrcamentoInterno } from "../_lib/orcamentosTypes";
import { uploadDocumentFile } from "@/lib/documentUpload";
import {
  EMPTY_REVIEW_VALUES,
  OrcamentoReviewCard,
  type ReviewValues,
} from "./OrcamentoReviewCard";

type AnalisePayload = {
  sugestao?: {
    prestadorId: string | null;
    prestadorNome: string;
    fornecedorCnpj: string;
    numeroOrcamento: string;
    valorTotal: number | null;
    dataValidade: string | null;
    descricao: string;
    confianca: number;
    alertas: string[];
  };
  error?: string;
};

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

type Props = {
  colaboradores: ColaboradorOption[];
  draftToResume: OrcamentoInterno | null;
  onUpsert: (orcamento: OrcamentoInterno) => void;
  onSubmitted: (orcamento: OrcamentoInterno) => void;
  onResumeHandled: () => void;
};

async function getToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Faça login novamente.");
  return token;
}

function sugestaoToValues(
  sugestao: NonNullable<AnalisePayload["sugestao"]>,
  current: ReviewValues,
): ReviewValues {
  return {
    ...current,
    prestadorId: sugestao.prestadorId ?? "",
    prestadorNome: sugestao.prestadorNome || current.prestadorNome,
    fornecedorCnpj: sugestao.fornecedorCnpj || current.fornecedorCnpj,
    numeroOrcamento: sugestao.numeroOrcamento || current.numeroOrcamento,
    valorTotal:
      sugestao.valorTotal === null ? current.valorTotal : String(sugestao.valorTotal),
    dataValidade: sugestao.dataValidade ?? current.dataValidade,
    descricao: sugestao.descricao || current.descricao,
  };
}

export function OrcamentoIntakeForm({
  colaboradores,
  draftToResume,
  onUpsert,
  onSubmitted,
  onResumeHandled,
}: Props) {
  const { user } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [solicitanteId, setSolicitanteId] = useState("");

  const [draftId, setDraftId] = useState<string | null>(null);
  const [attachedFileName, setAttachedFileName] = useState("");
  const [values, setValues] = useState<ReviewValues>(EMPTY_REVIEW_VALUES);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [working, setWorking] = useState<
    "uploading" | "analyzing" | "saving" | "submitting" | null
  >(null);

  const [bulkDrafts, setBulkDrafts] = useState<BulkDraft[]>([]);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [bulkFailed, setBulkFailed] = useState<string[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!draftToResume) return;
    setDraftId(draftToResume.id);
    setAttachedFileName(
      draftToResume.arquivo_original_path.split("/").pop() || "orcamento.pdf",
    );
    setValues({
      prestadorId: draftToResume.prestador_id ?? "",
      prestadorNome: draftToResume.prestador_nome,
      fornecedorCnpj: draftToResume.fornecedor_cnpj ?? "",
      numeroOrcamento: draftToResume.numero_orcamento,
      valorTotal:
        draftToResume.valor_total === null ? "" : String(draftToResume.valor_total),
      dataValidade: draftToResume.data_validade ?? "",
      descricao: draftToResume.descricao,
      observacoes: draftToResume.observacoes ?? "",
    });
    setSolicitanteId("");
    setFiles([]);
    setBulkDrafts([]);
    setConfidence(null);
    setAlerts([]);
    setError(null);
    setSuccess("Rascunho aberto para continuar.");
    onResumeHandled();
  }, [draftToResume, onResumeHandled]);

  const resetForm = () => {
    setFiles([]);
    setFileInputKey((current) => current + 1);
    setSolicitanteId("");
    setDraftId(null);
    setAttachedFileName("");
    setValues(EMPTY_REVIEW_VALUES);
    setConfidence(null);
    setAlerts([]);
    setBulkDrafts([]);
    setBulkCreating(false);
    setBulkProgress(null);
    setBulkFailed([]);
    setError(null);
    setSuccess(null);
  };

  const uploadAndCreateDraft = async (file: File) => {
    const uploadData = await uploadDocumentFile(file, "orcamentos_internos/originais");
    try {
      const token = await getToken();
      const response = await fetch("/api/orcamentos-internos", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          submit: false,
          solicitanteId: solicitanteId || null,
          arquivos: [
            {
              path: uploadData.path,
              name: file.name,
              type: "application/pdf",
              size: file.size,
              principal: true,
            },
          ],
        }),
      });
      const payload = (await response.json()) as {
        orcamento?: OrcamentoInterno;
        error?: string;
      };
      if (!response.ok || !payload.orcamento) {
        throw new Error(payload.error ?? "Não foi possível criar o rascunho.");
      }
      return payload.orcamento;
    } catch (err) {
      await supabase.storage.from("formularios").remove([uploadData.path]);
      throw err;
    }
  };

  const runAnalysis = async (id: string) => {
    const token = await getToken();
    const response = await fetch(`/api/orcamentos-internos/${id}/analisar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = (await response.json()) as AnalisePayload;
    if (!response.ok || !payload.sugestao) {
      throw new Error(payload.error ?? "Não foi possível analisar o orçamento.");
    }
    return payload.sugestao;
  };

  const analyzeDraft = async (id: string) => {
    setWorking("analyzing");
    setError(null);
    setSuccess(null);
    try {
      const sugestao = await runAnalysis(id);
      setValues((current) => sugestaoToValues(sugestao, current));
      setConfidence(sugestao.confianca);
      setAlerts(sugestao.alertas ?? []);
      setSuccess("Análise concluída. Confira os dados antes de enviar.");
    } catch (err) {
      setError(
        `${err instanceof Error ? err.message : "A análise automática falhou."} O rascunho foi mantido e os campos podem ser preenchidos manualmente.`,
      );
    } finally {
      setWorking(null);
    }
  };

  const startSingleFlow = async (file: File) => {
    if (!user) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("O orçamento deve ser enviado em PDF.");
      return;
    }
    setWorking("uploading");
    setError(null);
    setSuccess(null);
    try {
      const orcamento = await uploadAndCreateDraft(file);
      setDraftId(orcamento.id);
      setAttachedFileName(file.name);
      setFiles([]);
      setFileInputKey((current) => current + 1);
      onUpsert(orcamento);
      await analyzeDraft(orcamento.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar o orçamento.");
      setWorking(null);
    }
  };

  const persistDraft = async (submit: boolean) => {
    if (!draftId) return;
    if (submit && !values.prestadorNome.trim()) {
      setError("Confirme o nome do fornecedor.");
      return;
    }
    setWorking(submit ? "submitting" : "saving");
    setError(null);
    setSuccess(null);
    try {
      const token = await getToken();
      const response = await fetch(`/api/orcamentos-internos/${draftId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: submit ? "enviar_aprovacao" : "salvar_rascunho",
          prestadorId: values.prestadorId || null,
          prestadorNome: values.prestadorNome.trim(),
          fornecedorCnpj: values.fornecedorCnpj.trim() || null,
          numeroOrcamento: values.numeroOrcamento.trim(),
          valorTotal: values.valorTotal || null,
          dataValidade: values.dataValidade || null,
          descricao: values.descricao.trim(),
          observacoes: values.observacoes.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        orcamento?: OrcamentoInterno;
        error?: string;
      };
      if (!response.ok || !payload.orcamento) {
        throw new Error(payload.error ?? "Não foi possível salvar o orçamento.");
      }
      onUpsert(payload.orcamento);
      if (submit) {
        onSubmitted(payload.orcamento);
        resetForm();
      } else {
        setSuccess("Rascunho salvo.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setWorking(null);
    }
  };

  const startBulkFlow = async (selectedFiles: File[]) => {
    if (!user) return;
    setError(null);
    setSuccess(null);
    setBulkFailed([]);
    setBulkCreating(true);
    setBulkProgress({ current: 0, total: selectedFiles.length });

    const failed: string[] = [];
    for (let index = 0; index < selectedFiles.length; index += 1) {
      const file = selectedFiles[index];
      setBulkProgress({ current: index + 1, total: selectedFiles.length });
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        failed.push(`${file.name} (não é PDF)`);
        continue;
      }
      try {
        const orcamento = await uploadAndCreateDraft(file);
        onUpsert(orcamento);
        const entry: BulkDraft = {
          orcamentoId: orcamento.id,
          fileName: file.name,
          values: EMPTY_REVIEW_VALUES,
          confidence: null,
          alerts: [],
          busy: "analyzing",
          error: null,
          success: null,
        };
        setBulkDrafts((current) => [...current, entry]);

        try {
          const sugestao = await runAnalysis(orcamento.id);
          setBulkDrafts((current) =>
            current.map((item) =>
              item.orcamentoId === orcamento.id
                ? {
                    ...item,
                    values: sugestaoToValues(sugestao, item.values),
                    confidence: sugestao.confianca,
                    alerts: sugestao.alertas ?? [],
                    busy: null,
                  }
                : item,
            ),
          );
        } catch (analyzeErr) {
          setBulkDrafts((current) =>
            current.map((item) =>
              item.orcamentoId === orcamento.id
                ? {
                    ...item,
                    busy: null,
                    error:
                      analyzeErr instanceof Error
                        ? analyzeErr.message
                        : "A análise automática falhou. Preencha os campos manualmente.",
                  }
                : item,
            ),
          );
        }
      } catch (createErr) {
        failed.push(
          `${file.name} (${createErr instanceof Error ? createErr.message : "falha ao enviar"})`,
        );
      }
    }

    setBulkCreating(false);
    setBulkProgress(null);
    setFiles([]);
    setFileInputKey((current) => current + 1);
    setBulkFailed(failed);
  };

  const updateBulkDraftValues = (orcamentoId: string, next: ReviewValues) => {
    setBulkDrafts((current) =>
      current.map((item) => (item.orcamentoId === orcamentoId ? { ...item, values: next } : item)),
    );
  };

  const reanalyzeBulkDraft = async (orcamentoId: string) => {
    setBulkDrafts((current) =>
      current.map((item) =>
        item.orcamentoId === orcamentoId
          ? { ...item, busy: "analyzing", error: null, success: null }
          : item,
      ),
    );
    try {
      const sugestao = await runAnalysis(orcamentoId);
      setBulkDrafts((current) =>
        current.map((item) =>
          item.orcamentoId === orcamentoId
            ? {
                ...item,
                values: sugestaoToValues(sugestao, item.values),
                confidence: sugestao.confianca,
                alerts: sugestao.alertas ?? [],
                busy: null,
                success: "Análise concluída.",
              }
            : item,
        ),
      );
    } catch (err) {
      setBulkDrafts((current) =>
        current.map((item) =>
          item.orcamentoId === orcamentoId
            ? {
                ...item,
                busy: null,
                error: err instanceof Error ? err.message : "A análise automática falhou.",
              }
            : item,
        ),
      );
    }
  };

  const persistBulkDraft = async (orcamentoId: string, submit: boolean) => {
    const entry = bulkDrafts.find((item) => item.orcamentoId === orcamentoId);
    if (!entry) return;
    if (submit && !entry.values.prestadorNome.trim()) {
      setBulkDrafts((current) =>
        current.map((item) =>
          item.orcamentoId === orcamentoId
            ? { ...item, error: "Confirme o nome do fornecedor.", success: null }
            : item,
        ),
      );
      return;
    }
    setBulkDrafts((current) =>
      current.map((item) =>
        item.orcamentoId === orcamentoId
          ? { ...item, busy: submit ? "submitting" : "saving", error: null, success: null }
          : item,
      ),
    );
    try {
      const token = await getToken();
      const response = await fetch(`/api/orcamentos-internos/${orcamentoId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: submit ? "enviar_aprovacao" : "salvar_rascunho",
          prestadorId: entry.values.prestadorId || null,
          prestadorNome: entry.values.prestadorNome.trim(),
          fornecedorCnpj: entry.values.fornecedorCnpj.trim() || null,
          numeroOrcamento: entry.values.numeroOrcamento.trim(),
          valorTotal: entry.values.valorTotal || null,
          dataValidade: entry.values.dataValidade || null,
          descricao: entry.values.descricao.trim(),
          observacoes: entry.values.observacoes.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        orcamento?: OrcamentoInterno;
        error?: string;
      };
      if (!response.ok || !payload.orcamento) {
        throw new Error(payload.error ?? "Não foi possível salvar o orçamento.");
      }
      onUpsert(payload.orcamento);
      if (submit) {
        onSubmitted(payload.orcamento);
        setBulkDrafts((current) => current.filter((item) => item.orcamentoId !== orcamentoId));
      } else {
        setBulkDrafts((current) =>
          current.map((item) =>
            item.orcamentoId === orcamentoId
              ? { ...item, busy: null, success: "Rascunho salvo." }
              : item,
          ),
        );
      }
    } catch (err) {
      setBulkDrafts((current) =>
        current.map((item) =>
          item.orcamentoId === orcamentoId
            ? {
                ...item,
                busy: null,
                error: err instanceof Error ? err.message : "Não foi possível salvar.",
              }
            : item,
        ),
      );
    }
  };

  const handleSend = () => {
    if (files.length === 0) {
      setError("Selecione ao menos um PDF de orçamento.");
      return;
    }
    if (files.length === 1) {
      void startSingleFlow(files[0]);
    } else {
      void startBulkFlow(files);
    }
  };

  const idle = !draftId && bulkDrafts.length === 0;
  const busy = working !== null || bulkCreating;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Novo orçamento
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            Envie o PDF e confira a leitura automática
          </p>
        </div>
        {!idle ? (
          <button
            type="button"
            onClick={resetForm}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            {bulkDrafts.length > 0 ? "Novo lote" : "Outro orçamento"}
          </button>
        ) : null}
      </div>

      {idle || draftId ? (
        <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] font-semibold">
          {["1. PDF", "2. Conferência"].map((label, index) => {
            const active = draftId ? index <= 1 : index === 0;
            return (
              <div
                key={label}
                className={`rounded-full px-3 py-1.5 text-center ${
                  active ? "bg-sky-50 text-sky-700" : "bg-slate-50 text-slate-400"
                }`}
              >
                {label}
              </div>
            );
          })}
        </div>
      ) : null}

      {(error || success) && (
        <div
          className={`mt-4 rounded-xl px-3 py-2 text-xs ${
            error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {error ?? success}
        </div>
      )}

      {bulkFailed.length > 0 ? (
        <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Alguns arquivos não puderam ser enviados: {bulkFailed.join(", ")}
        </div>
      ) : null}

      {idle && colaboradores.length > 0 ? (
        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Enviar em nome de
          <select
            value={solicitanteId}
            onChange={(event) => setSolicitanteId(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs normal-case tracking-normal text-slate-800"
          >
            <option value="">Eu mesmo</option>
            {colaboradores.map((colaborador) => (
              <option key={colaborador.id} value={colaborador.id}>
                {colaborador.name ?? colaborador.email}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {idle ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            PDF do orçamento (pode selecionar vários)
            <input
              key={fileInputKey}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              className="mt-2 block w-full cursor-pointer text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-sky-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
          </label>
          {files.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {files.map((selectedFile, index) => (
                <li key={`${selectedFile.name}-${index}`} className="truncate">
                  {selectedFile.name}
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={handleSend}
            disabled={files.length === 0 || busy}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {working === "uploading" || working === "analyzing" || bulkCreating ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {bulkProgress
              ? `Processando ${bulkProgress.current} de ${bulkProgress.total}...`
              : working === "uploading"
                ? "Enviando PDF..."
                : working === "analyzing"
                  ? "Identificando fornecedor..."
                  : files.length > 1
                    ? `Enviar e analisar ${files.length} orçamentos`
                    : "Enviar e analisar com IA"}
          </button>
        </div>
      ) : null}

      {draftId ? (
        <div className="mt-4">
          <OrcamentoReviewCard
            fileName={attachedFileName}
            values={values}
            onChange={setValues}
            confidence={confidence}
            alerts={alerts}
            onReanalyze={() => void analyzeDraft(draftId)}
            onSaveDraft={() => void persistDraft(false)}
            onSubmit={() => void persistDraft(true)}
            busy={working}
            error={null}
            success={null}
          />
        </div>
      ) : null}

      {bulkDrafts.length > 0 ? (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-slate-500">
            Revise os dados de cada orçamento e envie individualmente.
          </p>
          {bulkDrafts.map((entry) => (
            <OrcamentoReviewCard
              key={entry.orcamentoId}
              fileName={entry.fileName}
              values={entry.values}
              onChange={(next) => updateBulkDraftValues(entry.orcamentoId, next)}
              confidence={entry.confidence}
              alerts={entry.alerts}
              onReanalyze={() => void reanalyzeBulkDraft(entry.orcamentoId)}
              onSaveDraft={() => void persistBulkDraft(entry.orcamentoId, false)}
              onSubmit={() => void persistBulkDraft(entry.orcamentoId, true)}
              busy={entry.busy}
              error={entry.error}
              success={entry.success}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Verificar tipos e testes**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: FAIL nesse ponto — `page.tsx` ainda passa a prop `gestores` pro `OrcamentoIntakeForm`, que não existe mais no novo `Props`. Isso é esperado; a Task 5 corrige o call site. Confirmar que o único erro reportado é sobre essa prop extra em `page.tsx` (não deve haver nenhum outro erro de tipo).

- [ ] **Step 5: Commit**

```bash
git add "src/app/documentos/orcamentos-internos/_components/OrcamentoReviewCard.tsx" "src/app/documentos/orcamentos-internos/_components/OrcamentoIntakeForm.tsx"
git commit -m "feat(orcamentos-internos): remove campo de gestor e mostra uma caixa de revisao por arquivo no lote"
```

---

### Task 5: Frontend — página de listagem sem reatribuição de gestor

**Files:**
- Modify: `src/app/documentos/orcamentos-internos/page.tsx` (linhas 187, 306, 570-588, 642-656, 725, 763, 860, 976-1015 aproximadamente — os números exatos mudam levemente conforme os removes anteriores; usar os trechos de código abaixo para localizar via busca de texto)

**Interfaces:**
- Consumes: `OrcamentoIntakeForm` sem a prop `gestores` (Task 4).
- Produces: nenhuma interface nova consumida por outras tarefas — esta é a última tarefa de código do plano.

- [ ] **Step 1: Remover a prop `gestores` passada pro formulário**

Localizar (dentro de `<OrcamentoIntakeForm ... />`):

```tsx
        <OrcamentoIntakeForm
          gestores={gestores}
          colaboradores={colaboradores}
```

Trocar por:

```tsx
        <OrcamentoIntakeForm
          colaboradores={colaboradores}
```

- [ ] **Step 2: Remover o estado `reassignEmail` e seu uso em `loadDetail`**

Localizar a declaração de estado:

```tsx
  const [reassignEmail, setReassignEmail] = useState("");
```

Remover essa linha.

Localizar, dentro de `loadDetail`:

```tsx
      setDetail(payload);
      setReassignEmail(payload.orcamento.gestor_email ?? "");
      setOrcamentos((current) =>
```

Trocar por:

```tsx
      setDetail(payload);
      setOrcamentos((current) =>
```

- [ ] **Step 3: Remover o painel "Reatribuir gestor"**

Localizar e remover inteiramente o bloco (dentro do `<footer>` do painel de detalhe, logo antes do bloco de justificativa/decisão):

```tsx
                {isAdmin ? (
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                    <select
                      value={reassignEmail}
                      onChange={(event) => setReassignEmail(event.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800"
                      aria-label="Novo gestor aprovador"
                    >
                      <option value="">Selecione um gestor</option>
                      {gestores.map((gestor) => (
                        <option key={gestor.email} value={gestor.email}>
                          {gestor.name
                            ? `${gestor.name} (${gestor.email})`
                            : gestor.email}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={Boolean(actionLoading) || !reassignEmail}
                      onClick={() => {
                        const gestor = gestores.find(
                          (item) => item.email === reassignEmail,
                        );
                        void patchAction(
                          selectedDetail.id,
                          {
                            action: "reatribuir_gestor",
                            gestorEmail: reassignEmail,
                            gestorId: gestor?.id ?? null,
                            gestorNome: gestor?.name ?? null,
                          },
                          "Gestor reatribuído.",
                        );
                      }}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Reatribuir gestor
                    </button>
                  </div>
                ) : null}
```

(sem substituição — remove o bloco inteiro; se o import `RefreshCw` de `lucide-react` ficar sem uso em outro lugar do arquivo, o próximo passo cuida disso)

- [ ] **Step 4: Verificar se `RefreshCw` continua em uso**

Buscar `RefreshCw` no arquivo (`grep -n "RefreshCw" src/app/documentos/orcamentos-internos/page.tsx`). Se ainda aparecer em outro lugar (ex.: o botão "Atualizar" da listagem), manter o import. Se não aparecer mais nenhuma vez fora do import, remover `RefreshCw` da lista de ícones importados de `lucide-react` no topo do arquivo.

- [ ] **Step 5: Renomear a coluna e o filtro "Gestor" pra "Decidido por"**

Na tabela (cabeçalho):

```tsx
                      <th className="px-5 py-3.5">Gestor</th>
```

trocar por:

```tsx
                      <th className="px-5 py-3.5">Decidido por</th>
```

No filtro:

```tsx
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Gestor
              <select
                value={gestorFilter}
```

trocar por:

```tsx
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Decidido por
              <select
                value={gestorFilter}
```

No painel de detalhe (linha do rótulo dentro do array de pares `[label, value]`):

```tsx
                      ["Gestor", selectedDetail.gestor_nome || selectedDetail.gestor_email || "--"],
```

trocar por:

```tsx
                      ["Decidido por", selectedDetail.gestor_nome || selectedDetail.gestor_email || "--"],
```

(as células da tabela que já exibem `orcamento.gestor_nome || orcamento.gestor_email || "--"` não precisam mudar — o valor exibido já reflete "quem decidiu" automaticamente, porque é isso que essas colunas passam a conter a partir da Task 3)

- [ ] **Step 6: Verificar tipos e testes**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: PASS — nenhum erro de tipo, todos os testes passando.

- [ ] **Step 7: Commit**

```bash
git add src/app/documentos/orcamentos-internos/page.tsx
git commit -m "feat(orcamentos-internos): remove reatribuicao de gestor e renomeia coluna para decidido por"
```

---

### Task 6: Verificação manual e deploy

**Files:**
- Nenhum arquivo modificado — tarefa de verificação e publicação.

**Interfaces:**
- Consumes: build final de todas as tarefas anteriores.
- Produces: nada consumido por outras tarefas — última tarefa do plano.

- [ ] **Step 1: Rodar a suíte completa uma última vez**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: PASS.

- [ ] **Step 2: Iniciar o servidor de dev e testar manualmente (Playwright ou navegador)**

Run: `npm run dev`

Checklist (do spec, `docs/superpowers/specs/2026-08-26-orcamentos-aprovacao-multipla-design.md`):
1. Criar um orçamento, enviar pra aprovação, confirmar que não há mais campo de gestor no formulário.
2. Logar como um aprovador qualquer (qualquer um dos cadastrados em `orcamentos_internos_aprovadores`, não precisa ser um "específico") e confirmar que consegue ver e aprovar/rejeitar/pedir ajuste um orçamento pendente.
3. Subir 3 PDFs de uma vez pelo formulário e confirmar que aparecem 3 caixas de revisão empilhadas na mesma tela, cada uma editável e enviável independentemente (usar "Salvar rascunho" numa e "Enviar para aprovação" em outra, confirmar que cada ação afeta só aquele orçamento).
4. Confirmar que a coluna "Decidido por" fica "--" enquanto pendente e mostra o e-mail/nome de quem decidiu depois de aprovar/rejeitar.
5. Confirmar que o painel "Reatribuir gestor" não aparece mais no detalhe de um orçamento (mesmo logado como admin).

- [ ] **Step 3: Push pros dois remotes e verificar deploy**

```bash
git push origin master
git push centralforms-manut master
git fetch centralforms-manut master
git rev-list --left-right --count centralforms-manut/master...master
```

Expected: `0	0` (ambos sincronizados). Depois, verificar o deploy no Azure App Service `FORMSCENTRAL` (assinatura "Projetos Bemol", `d5e3355c-999c-4779-aa91-892dd1e9391a`) via:

```bash
az rest --method get --url "https://management.azure.com/subscriptions/d5e3355c-999c-4779-aa91-892dd1e9391a/resourceGroups/RGDIROPERACIONAL/providers/Microsoft.Web/sites/FORMSCENTRAL/deployments?api-version=2022-03-01"
```

Expected: entrada mais recente com `status: 4` e `active: true`, com `start_time` posterior ao push.
