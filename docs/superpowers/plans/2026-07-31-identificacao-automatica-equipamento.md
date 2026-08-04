# Identificação Automática de Equipamento no Documento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender o pipeline de análise automática por IA (já em produção) para tentar identificar a qual equipamento cadastrado da loja um documento (Registro e Laudos / Notas Fiscais) se refere, vinculando `formularios.equipamento_id` quando o match for confiável, e permitir correção manual desse vínculo pela tela de Documentos já existente.

**Architecture:** Extensão do schema de análise da IA (`openAiDocumentAnalysis.ts`) com 3 campos novos; uma função pura de matching (número de série → tipo+identificação, nunca chuta) em `documentAnalysisPipeline.ts`; integração no orquestrador já existente (`processarDocumentoComIa`) que só tenta o match para os 2 tipos em escopo e só quando a loja já tem equipamentos cadastrados; extensão da API `/api/documentos` (GET filtra por `status_analise_ia`, PATCH aceita `equipamentoId`); e um campo "Equipamento" novo no modal de edição já existente em `src/app/documentos/page.tsx`. Nenhuma tela nova — a "fila de revisão" é a lista de Documentos já existente, filtrada.

**Tech Stack:** Next.js App Router, Supabase, TypeScript, Vitest.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-07-31-identificacao-automatica-equipamento-design.md`.
- Match de equipamento só roda para `tipo` = `registro_laudos` ou `notas_fiscais` — nenhum outro tipo.
- Se a loja do documento não tem nenhum equipamento `ativo` cadastrado, não tenta match e não penaliza o status por isso.
- Match nunca "chuta": só vincula quando há exatamente 1 candidato depois de aplicar as regras (número de série exato, senão tipo único, senão tipo+identificação).
- `formularios.equipamento_id` usa `ON DELETE SET NULL` (não `CASCADE`) — desativar/remover um equipamento não apaga o histórico do documento.
- `determinarStatusFinal` (já existe, já testada em `src/lib/documentAnalysisPipeline.test.ts`) ganha um segundo parâmetro **opcional** — mudança aditiva, as chamadas existentes com 1 argumento continuam funcionando exatamente como antes.
- Nomes e mensagens em português, seguindo o padrão do restante do código.

---

### Task 1: Migration — coluna `equipamento_id` em `formularios`

**Files:**
- Create: `supabase/migrations/202607311400_add_equipamento_id_formularios.sql`

**Interfaces:**
- Produces: coluna `public.formularios.equipamento_id` (uuid, nullable, FK → `equipamentos.id` com `ON DELETE SET NULL`). Consumida pelas Tasks 5, 6 e 7.

- [ ] **Step 1: Escrever a migration**

```sql
ALTER TABLE public.formularios
  ADD COLUMN equipamento_id uuid REFERENCES public.equipamentos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS formularios_equipamento_id_idx
  ON public.formularios (equipamento_id);
```

- [ ] **Step 2: Aplicar no Supabase**

Use a ferramenta MCP `apply_migration` (projeto `tqzvgqauvbknwdvbtvfr`, nome `add_equipamento_id_formularios`) com o SQL acima.

- [ ] **Step 3: Verificar**

Via MCP `execute_sql`:
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'formularios' and column_name = 'equipamento_id';

select conname, confdeltype
from pg_constraint
where conname like '%equipamento_id%' and conrelid = 'public.formularios'::regclass;
```
Esperado: coluna `uuid`, nullable; constraint com `confdeltype = 'n'` (SET NULL).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202607311400_add_equipamento_id_formularios.sql
git commit -m "feat(db): adiciona equipamento_id em formularios"
```

---

### Task 2: Extrair sinais de equipamento no schema de análise da IA

**Files:**
- Modify: `src/lib/openAiDocumentAnalysis.ts`

**Interfaces:**
- Produces: `DocumentoAnaliseIa` ganha 3 campos novos (`equipamento_tipo`, `equipamento_identificacao`, `equipamento_numero_serie`, todos `string | null`). Consumidos pela Task 3 (matching).

- [ ] **Step 1: Estender o tipo `DocumentoAnaliseIa`**

Em `src/lib/openAiDocumentAnalysis.ts`, adicionar ao final do tipo (antes do `};` de fechamento, depois de `recomendacoes: string[];`):

```typescript
  equipamento_tipo: string | null;
  equipamento_identificacao: string | null;
  equipamento_numero_serie: string | null;
```

- [ ] **Step 2: Estender `ANALISE_SCHEMA`**

Adicionar os 3 nomes ao array `required` (depois de `"recomendacoes"`):
```typescript
    "recomendacoes",
    "equipamento_tipo",
    "equipamento_identificacao",
    "equipamento_numero_serie",
```

Adicionar as 3 propriedades ao objeto `properties` (depois de `recomendacoes: { type: "array", items: { type: "string" } },`):
```typescript
    equipamento_tipo: { anyOf: [{ type: "string" }, { type: "null" }] },
    equipamento_identificacao: { anyOf: [{ type: "string" }, { type: "null" }] },
    equipamento_numero_serie: { anyOf: [{ type: "string" }, { type: "null" }] },
```

- [ ] **Step 3: Estender o prompt do sistema**

No final da string do `content` da mensagem `role: "system"` (depois da frase que termina em `"...retornam null para contratos."`), adicionar, antes das aspas de fechamento:

```
 IMPORTANTE — Para documentos do tipo 'registro_laudos' ou 'notas_fiscais': (1) Em 'equipamento_tipo', extraia o tipo do equipamento mencionado no documento (ex.: Gerador, Ar Condicionado, Elevador), em texto livre, só quando explicitamente identificável; senao retorne null. (2) Em 'equipamento_identificacao', extraia a identificacao ou apelido do equipamento citado (ex.: "Gerador 01", "Unidade 2"), quando houver; senao null. (3) Em 'equipamento_numero_serie', extraia o numero de serie ou patrimonio do equipamento, quando citado; senao null. (4) Para qualquer outro tipo de documento, sempre retorne null nos tres campos — nao tente adivinhar.
```

- [ ] **Step 4: Rodar o typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erros.

- [ ] **Step 5: Rodar a suite completa de testes**

Run: `npm run test`
Expected: PASS — nenhum teste existente quebrou (o tipo `DocumentoAnaliseIa` ganhou campos obrigatórios novos; os testes em `documentAnalysisPipeline.test.ts` que constroem um `DocumentoAnaliseIa` via `resultadoBase()` vão falhar no typecheck se não forem atualizados — **NÃO edite `resultadoBase()` nesta task**, isso é responsabilidade da Task 3, que já vai precisar mexer nesse arquivo de teste; se o typecheck falhar aqui por causa disso, é esperado, só confirme que a falha é exatamente essa e siga para a Task 3).

- [ ] **Step 6: Commit**

```bash
git add src/lib/openAiDocumentAnalysis.ts
git commit -m "feat: adiciona extracao de sinais de equipamento no schema de analise da IA"
```

---

### Task 3: `encontrarEquipamentoCorrespondente` — matching puro

**Files:**
- Modify: `src/lib/documentAnalysisPipeline.ts`
- Modify: `src/lib/documentAnalysisPipeline.test.ts`

**Interfaces:**
- Consumes: `DocumentoAnaliseIa` (Task 2, já tem os 3 campos novos).
- Produces:
  - `type EquipamentoAtivo = { id: string; tipo_equipamento: string; identificacao: string | null; numero_serie: string | null }`
  - `encontrarEquipamentoCorrespondente(equipamentos: EquipamentoAtivo[], resultado: DocumentoAnaliseIa): EquipamentoAtivo | null`

  Consumida pela Task 5 (orquestrador).

- [ ] **Step 1: Atualizar `resultadoBase()` no arquivo de teste**

Em `src/lib/documentAnalysisPipeline.test.ts`, a função `resultadoBase()` (usada por vários testes já existentes) constrói um `DocumentoAnaliseIa` completo — agora que o tipo tem 3 campos novos obrigatórios (Task 2), adicionar ao objeto retornado por `resultadoBase`:

```typescript
    equipamento_tipo: null,
    equipamento_identificacao: null,
    equipamento_numero_serie: null,
```

Rodar `npm run test -- documentAnalysisPipeline` e confirmar que os testes que já existiam voltam a passar (isso sozinho já resolve o typecheck pendente da Task 2, sem mudar nenhum comportamento).

- [ ] **Step 2: Escrever os testes que falham**

Adicionar ao final de `src/lib/documentAnalysisPipeline.test.ts`:

```typescript
import { encontrarEquipamentoCorrespondente, type EquipamentoAtivo } from "@/lib/documentAnalysisPipeline";

describe("encontrarEquipamentoCorrespondente", () => {
  const equipamentos: EquipamentoAtivo[] = [
    { id: "eq-1", tipo_equipamento: "Gerador", identificacao: "Gerador 01", numero_serie: "SN-100" },
    { id: "eq-2", tipo_equipamento: "Gerador", identificacao: "Gerador 02", numero_serie: "SN-200" },
    { id: "eq-3", tipo_equipamento: "Ar Condicionado", identificacao: null, numero_serie: null },
  ];

  it("da prioridade ao numero de serie quando bate com exatamente um equipamento", () => {
    const resultado = resultadoBase({
      equipamento_tipo: "Gerador",
      equipamento_identificacao: "Gerador 02",
      equipamento_numero_serie: "sn-100",
    });
    const match = encontrarEquipamentoCorrespondente(equipamentos, resultado);
    expect(match?.id).toBe("eq-1");
  });

  it("casa por tipo quando ha exatamente um equipamento daquele tipo", () => {
    const resultado = resultadoBase({
      equipamento_tipo: "ar condicionado",
      equipamento_identificacao: null,
      equipamento_numero_serie: null,
    });
    const match = encontrarEquipamentoCorrespondente(equipamentos, resultado);
    expect(match?.id).toBe("eq-3");
  });

  it("desempata por identificacao quando ha mais de um equipamento do mesmo tipo", () => {
    const resultado = resultadoBase({
      equipamento_tipo: "Gerador",
      equipamento_identificacao: "Gerador 02",
      equipamento_numero_serie: null,
    });
    const match = encontrarEquipamentoCorrespondente(equipamentos, resultado);
    expect(match?.id).toBe("eq-2");
  });

  it("retorna null quando ha mais de um candidato e a identificacao nao desempata", () => {
    const resultado = resultadoBase({
      equipamento_tipo: "Gerador",
      equipamento_identificacao: "Gerador Principal",
      equipamento_numero_serie: null,
    });
    expect(encontrarEquipamentoCorrespondente(equipamentos, resultado)).toBeNull();
  });

  it("retorna null quando nao ha equipamento_tipo nem match de numero de serie", () => {
    const resultado = resultadoBase({
      equipamento_tipo: null,
      equipamento_identificacao: null,
      equipamento_numero_serie: null,
    });
    expect(encontrarEquipamentoCorrespondente(equipamentos, resultado)).toBeNull();
  });

  it("retorna null quando o tipo extraido nao bate com nenhum equipamento", () => {
    const resultado = resultadoBase({
      equipamento_tipo: "Subestacao",
      equipamento_identificacao: null,
      equipamento_numero_serie: null,
    });
    expect(encontrarEquipamentoCorrespondente(equipamentos, resultado)).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npm run test -- documentAnalysisPipeline`
Expected: FAIL — `encontrarEquipamentoCorrespondente is not a function`.

- [ ] **Step 4: Implementar**

Adicionar ao `src/lib/documentAnalysisPipeline.ts`:

```typescript
export type EquipamentoAtivo = {
  id: string;
  tipo_equipamento: string;
  identificacao: string | null;
  numero_serie: string | null;
};

function normalizarTextoEquipamento(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

export function encontrarEquipamentoCorrespondente(
  equipamentos: EquipamentoAtivo[],
  resultado: DocumentoAnaliseIa,
): EquipamentoAtivo | null {
  const numeroSerie = resultado.equipamento_numero_serie?.trim();
  if (numeroSerie) {
    const porSerie = equipamentos.filter(
      (eq) =>
        eq.numero_serie &&
        normalizarTextoEquipamento(eq.numero_serie) ===
          normalizarTextoEquipamento(numeroSerie),
    );
    if (porSerie.length === 1) {
      return porSerie[0];
    }
  }

  const tipo = resultado.equipamento_tipo?.trim();
  if (!tipo) {
    return null;
  }
  const tipoNormalizado = normalizarTextoEquipamento(tipo);
  const porTipo = equipamentos.filter(
    (eq) => normalizarTextoEquipamento(eq.tipo_equipamento) === tipoNormalizado,
  );
  if (porTipo.length === 1) {
    return porTipo[0];
  }
  if (porTipo.length > 1) {
    const identificacao = resultado.equipamento_identificacao?.trim();
    if (identificacao) {
      const identificacaoNormalizada = normalizarTextoEquipamento(identificacao);
      const porIdentificacao = porTipo.filter(
        (eq) =>
          eq.identificacao &&
          normalizarTextoEquipamento(eq.identificacao) === identificacaoNormalizada,
      );
      if (porIdentificacao.length === 1) {
        return porIdentificacao[0];
      }
    }
  }
  return null;
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npm run test -- documentAnalysisPipeline`
Expected: PASS — todos os testes anteriores mais os 6 novos de `encontrarEquipamentoCorrespondente`, nenhuma falha.

- [ ] **Step 6: Commit**

```bash
git add src/lib/documentAnalysisPipeline.ts src/lib/documentAnalysisPipeline.test.ts
git commit -m "feat: adiciona matching de equipamento por numero de serie e tipo"
```

---

### Task 4: `buscarEquipamentosAtivosDaLoja` + extensão de `determinarStatusFinal`

**Files:**
- Modify: `src/lib/documentAnalysisPipeline.ts`
- Modify: `src/lib/documentAnalysisPipeline.test.ts`

**Interfaces:**
- Produces:
  - `buscarEquipamentosAtivosDaLoja(supabaseAdmin: SupabaseClient, lojaId: string): Promise<EquipamentoAtivo[]>`
  - `determinarStatusFinal(resultado: DocumentoAnaliseIa, contexto?: { equipamentoRequerido: boolean; equipamentoResolvido: boolean }): "concluida" | "necessita_revisao"` — assinatura estendida da função já existente; chamadas com 1 argumento continuam com o comportamento de antes.

  Ambas consumidas pela Task 5 (orquestrador).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `src/lib/documentAnalysisPipeline.test.ts`:

```typescript
describe("buscarEquipamentosAtivosDaLoja", () => {
  it("retorna so os equipamentos ativos da loja", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: async () => ({
              data: [
                { id: "eq-1", tipo_equipamento: "Gerador", identificacao: "Gerador 01", numero_serie: "SN-1" },
              ],
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const equipamentos = await buscarEquipamentosAtivosDaLoja(supabase, "loja-1");
    expect(equipamentos).toEqual([
      { id: "eq-1", tipo_equipamento: "Gerador", identificacao: "Gerador 01", numero_serie: "SN-1" },
    ]);
  });

  it("propaga erro do supabase", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: null, error: new Error("falhou") }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(buscarEquipamentosAtivosDaLoja(supabase, "loja-1")).rejects.toThrow("falhou");
  });
});

describe("determinarStatusFinal com contexto de equipamento", () => {
  it("mantem comportamento antigo quando contexto nao e passado", () => {
    expect(determinarStatusFinal(resultadoBase())).toBe("concluida");
  });

  it("forca necessita_revisao quando equipamento e requerido mas nao foi resolvido", () => {
    const resultado = determinarStatusFinal(resultadoBase(), {
      equipamentoRequerido: true,
      equipamentoResolvido: false,
    });
    expect(resultado).toBe("necessita_revisao");
  });

  it("mantem concluida quando equipamento e requerido e foi resolvido", () => {
    const resultado = determinarStatusFinal(resultadoBase(), {
      equipamentoRequerido: true,
      equipamentoResolvido: true,
    });
    expect(resultado).toBe("concluida");
  });

  it("nao exige equipamento quando equipamentoRequerido e false", () => {
    const resultado = determinarStatusFinal(resultadoBase(), {
      equipamentoRequerido: false,
      equipamentoResolvido: false,
    });
    expect(resultado).toBe("concluida");
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm run test -- documentAnalysisPipeline`
Expected: FAIL — `buscarEquipamentosAtivosDaLoja is not a function`.

- [ ] **Step 3: Implementar**

Adicionar ao `src/lib/documentAnalysisPipeline.ts`:

```typescript
export async function buscarEquipamentosAtivosDaLoja(
  supabaseAdmin: SupabaseClient,
  lojaId: string,
): Promise<EquipamentoAtivo[]> {
  const { data, error } = await supabaseAdmin
    .from("equipamentos")
    .select("id,tipo_equipamento,identificacao,numero_serie")
    .eq("loja_id", lojaId)
    .eq("status", "ativo");

  if (error) {
    throw error;
  }

  return (data ?? []) as EquipamentoAtivo[];
}
```

Substituir a assinatura e o corpo de `determinarStatusFinal` (função já existente) por:

```typescript
export function determinarStatusFinal(
  resultado: DocumentoAnaliseIa,
  contexto?: { equipamentoRequerido: boolean; equipamentoResolvido: boolean },
): "concluida" | "necessita_revisao" {
  const semLoja = !resultado.lojas || resultado.lojas.length === 0;
  const semCompetencia =
    !resultado.competencias || resultado.competencias.length === 0;
  const confiancaBaixa =
    typeof resultado.confianca_geral !== "number" ||
    resultado.confianca_geral < LIMIAR_CONFIANCA_REVISAO;
  const semEquipamentoObrigatorio =
    Boolean(contexto?.equipamentoRequerido) && !contexto?.equipamentoResolvido;

  if (semLoja || semCompetencia || confiancaBaixa || semEquipamentoObrigatorio) {
    return "necessita_revisao";
  }
  return "concluida";
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm run test -- documentAnalysisPipeline`
Expected: PASS — todos os testes anteriores mais os novos, nenhuma falha.

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentAnalysisPipeline.ts src/lib/documentAnalysisPipeline.test.ts
git commit -m "feat: adiciona busca de equipamentos ativos e contexto de equipamento no status final"
```

---

### Task 5: Integrar o matching no orquestrador `processarDocumentoComIa`

**Files:**
- Modify: `src/lib/documentAnalysisPipeline.ts`
- Modify: `src/lib/documentAnalysisPipeline.test.ts`

**Interfaces:**
- Consumes: `buscarEquipamentosAtivosDaLoja`, `encontrarEquipamentoCorrespondente`, `determinarStatusFinal` (Tasks 3–4, já implementadas nesta mesma sessão de plano).
- Produces: `processarDocumentoComIa` (assinatura inalterada) passa a gravar `equipamento_id` em `formularios` quando aplicável. Nenhuma task futura depende de uma interface nova aqui — é o ponto final da integração.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `src/lib/documentAnalysisPipeline.test.ts`, dentro (ou logo após) do `describe("processarDocumentoComIa", ...)` já existente. Terá que estender o `criarSupabaseFake` já usado nesse describe para também responder por `equipamentos` — leia a implementação atual de `criarSupabaseFake` no arquivo antes de editar, e adicione um parâmetro novo `equipamentosAtivos?: EquipamentoAtivo[]` que, quando fornecido, faz `supabase.from("equipamentos").select().eq().eq()` (a mesma cadeia usada por `buscarEquipamentosAtivosDaLoja`) retornar `{ data: equipamentosAtivos, error: null }`; quando omitido, retorna `{ data: [], error: null }`.

```typescript
it("vincula equipamento quando ha match confiavel para registro_laudos", async () => {
  vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
    provider: "azure-openai",
    model: "gpt-5-chat",
    resultado: resultadoBase({
      equipamento_tipo: "Gerador",
      equipamento_identificacao: null,
      equipamento_numero_serie: null,
    }),
  });

  const { supabase, updates } = criarSupabaseFake({
    registro: {
      id: "doc-3",
      tipo: "registro_laudos",
      dados: { loja_id: "loja-1", competencia: "07/2026" },
      arquivo_path: "pasta/laudo.pdf",
      arquivo_assinado_path: null,
      prestador_id: null,
    },
    equipamentosAtivos: [
      { id: "eq-1", tipo_equipamento: "Gerador", identificacao: null, numero_serie: null },
    ],
  });

  const resultado = await processarDocumentoComIa(supabase, "doc-3");

  expect(resultado.status).toBe("concluida");
  const ultimoUpdate = updates[updates.length - 1];
  expect(ultimoUpdate.payload.equipamento_id).toBe("eq-1");
});

it("marca necessita_revisao quando a loja tem equipamentos mas nenhum bate", async () => {
  vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
    provider: "azure-openai",
    model: "gpt-5-chat",
    resultado: resultadoBase({
      equipamento_tipo: "Subestacao",
      equipamento_identificacao: null,
      equipamento_numero_serie: null,
    }),
  });

  const { supabase, updates } = criarSupabaseFake({
    registro: {
      id: "doc-4",
      tipo: "registro_laudos",
      dados: { loja_id: "loja-1", competencia: "07/2026" },
      arquivo_path: "pasta/laudo.pdf",
      arquivo_assinado_path: null,
      prestador_id: null,
    },
    equipamentosAtivos: [
      { id: "eq-1", tipo_equipamento: "Gerador", identificacao: null, numero_serie: null },
    ],
  });

  const resultado = await processarDocumentoComIa(supabase, "doc-4");

  expect(resultado.status).toBe("necessita_revisao");
  const ultimoUpdate = updates[updates.length - 1];
  expect(ultimoUpdate.payload.equipamento_id).toBeNull();
});

it("nao tenta match de equipamento quando a loja nao tem nenhum cadastrado", async () => {
  vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
    provider: "azure-openai",
    model: "gpt-5-chat",
    resultado: resultadoBase({
      equipamento_tipo: null,
      equipamento_identificacao: null,
      equipamento_numero_serie: null,
    }),
  });

  const { supabase, updates } = criarSupabaseFake({
    registro: {
      id: "doc-5",
      tipo: "registro_laudos",
      dados: { loja_id: "loja-1", competencia: "07/2026" },
      arquivo_path: "pasta/laudo.pdf",
      arquivo_assinado_path: null,
      prestador_id: null,
    },
    // sem equipamentosAtivos: loja sem nenhum equipamento cadastrado
  });

  const resultado = await processarDocumentoComIa(supabase, "doc-5");

  expect(resultado.status).toBe("concluida");
});

it("nao tenta match de equipamento para tipos fora de escopo mesmo com equipamentos cadastrados", async () => {
  vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
    provider: "azure-openai",
    model: "gpt-5-chat",
    resultado: resultadoBase(),
  });

  const { supabase, updates } = criarSupabaseFake({
    registro: {
      id: "doc-6",
      tipo: "contratos",
      dados: { loja_id: "loja-1", competencia: "07/2026" },
      arquivo_path: "pasta/contrato.pdf",
      arquivo_assinado_path: null,
      prestador_id: null,
    },
    equipamentosAtivos: [
      { id: "eq-1", tipo_equipamento: "Gerador", identificacao: null, numero_serie: null },
    ],
  });

  const resultado = await processarDocumentoComIa(supabase, "doc-6");

  expect(resultado.status).toBe("concluida");
  const ultimoUpdate = updates[updates.length - 1];
  expect(ultimoUpdate.payload.equipamento_id).toBeUndefined();
});
```

O último teste espera `equipamento_id` **ausente** do payload (não `null`) para tipos fora de escopo — a implementação do Step 3 só inclui a chave `equipamento_id` no update quando o tipo está em escopo, para não sobrescrever um vínculo manual já existente em um documento de outro tipo.

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm run test -- documentAnalysisPipeline`
Expected: FAIL — os 4 novos testes falham (comportamento ainda não implementado); os testes anteriores continuam passando.

- [ ] **Step 3: Implementar**

Modificar `processarDocumentoComIa` em `src/lib/documentAnalysisPipeline.ts`. Adicionar, antes da função (junto das outras constantes/tipos do arquivo):

```typescript
const TIPOS_COM_EQUIPAMENTO = ["registro_laudos", "notas_fiscais"] as const;

function deveTentarEquipamento(tipo: string): boolean {
  return (TIPOS_COM_EQUIPAMENTO as readonly string[]).includes(tipo);
}
```

Dentro de `processarDocumentoComIa`, no bloco de sucesso (depois de `await registrarAnaliseIa(...)` e antes de `const statusFinal = determinarStatusFinal(resultado);`), substituir:

```typescript
    const statusFinal = determinarStatusFinal(resultado);
    await supabaseAdmin
      .from("formularios")
      .update({ status_analise_ia: statusFinal })
      .eq("id", row.id);

    return { status: statusFinal };
```

por:

```typescript
    let equipamentoId: string | null = null;
    let equipamentoRequerido = false;
    const lojaId = typeof dados?.loja_id === "string" ? dados.loja_id : null;

    if (deveTentarEquipamento(row.tipo) && lojaId) {
      const equipamentosAtivos = await buscarEquipamentosAtivosDaLoja(supabaseAdmin, lojaId);
      if (equipamentosAtivos.length > 0) {
        equipamentoRequerido = true;
        const match = encontrarEquipamentoCorrespondente(equipamentosAtivos, resultado);
        equipamentoId = match?.id ?? null;
      }
    }

    const statusFinal = determinarStatusFinal(resultado, {
      equipamentoRequerido,
      equipamentoResolvido: equipamentoId !== null,
    });

    const updatePayload: { status_analise_ia: string; equipamento_id?: string | null } = {
      status_analise_ia: statusFinal,
    };
    if (deveTentarEquipamento(row.tipo)) {
      updatePayload.equipamento_id = equipamentoId;
    }

    await supabaseAdmin
      .from("formularios")
      .update(updatePayload)
      .eq("id", row.id);

    return { status: statusFinal };
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm run test -- documentAnalysisPipeline`
Expected: PASS — todos os testes anteriores mais os 4 novos, nenhuma falha.

- [ ] **Step 5: Rodar a suite completa e o typecheck**

Run: `npm run test`
Run: `npx tsc --noEmit -p .`
Expected: ambos limpos.

- [ ] **Step 6: Commit**

```bash
git add src/lib/documentAnalysisPipeline.ts src/lib/documentAnalysisPipeline.test.ts
git commit -m "feat: integra matching de equipamento no orquestrador de analise automatica"
```

---

### Task 6: API `/api/documentos` — filtro por `status_analise_ia` e edição de `equipamentoId`

**Files:**
- Modify: `src/app/api/documentos/route.ts`

**Interfaces:**
- Consumes: nada de outra task deste plano (usa a coluna `equipamento_id` da Task 1 e a tabela `equipamentos` já existente do sub-projeto 2).
- Produces: `GET /api/documentos?statusAnaliseIa=<valor>` (filtro novo); `PATCH /api/documentos` aceita `equipamentoId?: string | null` no corpo. Resposta do documento (`DocumentRecord`) ganha os campos `status_analise_ia` e `equipamento_id`. Consumida pela Task 7 (UI).

- [ ] **Step 1: Ler o arquivo atual**

Leia `src/app/api/documentos/route.ts` por completo antes de editar — os números de linha abaixo são referência de quando este plano foi escrito, confirme contra o arquivo real antes de aplicar.

- [ ] **Step 2: Estender `FormularioRow`, `DocumentRecord` e `mapRows`**

Em `FormularioRow` (perto da linha 23), adicionar:
```typescript
  status_analise_ia?: string | null;
  equipamento_id?: string | null;
```

Em `DocumentRecord` (logo abaixo), adicionar os mesmos dois campos (sem `?`, sempre presentes na resposta):
```typescript
  status_analise_ia: string | null;
  equipamento_id: string | null;
```

Em `mapRows`, adicionar ao objeto retornado:
```typescript
    status_analise_ia: item.status_analise_ia ?? null,
    equipamento_id: item.equipamento_id ?? null,
```

- [ ] **Step 3: Adicionar as colunas nos `.select(...)`**

Há dois `.select("id,tipo,status,arquivo_path,arquivo_assinado_path,created_at,dados,assinado_por,user_id,prestador_id")` no arquivo — um na função `GET` (query principal da lista) e um no final do `PATCH` (select do registro atualizado). Em **ambos**, adicionar `,status_analise_ia,equipamento_id` à string de colunas.

- [ ] **Step 4: Adicionar o filtro `statusAnaliseIa` no `GET`**

Perto de onde `statusFilter` já é lido e aplicado (`const statusFilter = searchParams.get("status");` e, mais abaixo, `if (statusFilter && statusFilter !== "todos") { query = query.eq("status", statusFilter); }`), adicionar o equivalente para o novo filtro:

```typescript
    const statusAnaliseIaFilter = searchParams.get("statusAnaliseIa");
```

e, junto do bloco `if (statusFilter && ...)`:

```typescript
    if (statusAnaliseIaFilter && statusAnaliseIaFilter !== "todos") {
      query = query.eq("status_analise_ia", statusAnaliseIaFilter);
    }
```

- [ ] **Step 5: Adicionar suporte a `equipamentoId` no `PATCH`**

No tipo do `body` do `PATCH` (`{ id?, updates?, lojaId?, prestadorId?, status? }`), adicionar `equipamentoId?: string | null`.

Adicionar a constante de presença, junto de `hasLojaUpdate`/`hasPrestadorUpdate`:
```typescript
    const hasEquipamentoUpdate = Object.prototype.hasOwnProperty.call(
      body,
      "equipamentoId",
    );
```

Incluir `hasEquipamentoUpdate` na condição de erro 400 "informe id e dados" (a linha `if (!id || (!hasDadosUpdates && !hasLojaUpdate && !hasPrestadorUpdate && !hasStatusUpdate))`), adicionando `&& !hasEquipamentoUpdate`.

No tipo de `updatePayload`, adicionar `equipamento_id?: string | null`.

Depois do bloco `if (hasPrestadorUpdate) { ... }` e antes do bloco `if (hasStatusUpdate) { ... }`, adicionar:

```typescript
    if (hasEquipamentoUpdate) {
      const equipamentoId = sanitizeId((body.equipamentoId ?? "").trim());
      if (!equipamentoId) {
        updatePayload.equipamento_id = null;
      } else {
        const { data: equipamento, error: equipamentoError } = await supabaseAdmin
          .from("equipamentos")
          .select("id,loja_id")
          .eq("id", equipamentoId)
          .maybeSingle();
        if (equipamentoError) {
          throw equipamentoError;
        }
        if (!equipamento) {
          throw new HttpError(404, "Equipamento nao encontrado.");
        }

        const lojaIdParaValidar = hasLojaUpdate
          ? (updatePayload.dados.loja_id as string | undefined)
          : (safeParseDados(registro.dados)?.loja_id as string | undefined);

        if (lojaIdParaValidar && equipamento.loja_id !== lojaIdParaValidar) {
          throw new HttpError(400, "Equipamento nao pertence a loja do documento.");
        }

        updatePayload.equipamento_id = equipamento.id;
      }
    }
```

- [ ] **Step 6: Rodar a suite completa de testes e o typecheck**

Run: `npm run test`
Run: `npx tsc --noEmit -p .`
Expected: ambos limpos.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/documentos/route.ts
git commit -m "feat: adiciona filtro por status_analise_ia e edicao de equipamento na API de documentos"
```

---

### Task 7: UI — filtro "Status da análise" e campo "Equipamento" no modal de edição

**Files:**
- Modify: `src/app/documentos/page.tsx`
- Modify: `src/app/documentos/_components/DocumentosFilters.tsx`

**Interfaces:**
- Consumes: `GET /api/documentos?statusAnaliseIa=...` e `PATCH /api/documentos` com `equipamentoId` (Task 6); `useEquipamentos` (já existe, do sub-projeto 2, `src/hooks/useEquipamentos.ts`).
- Produces: nenhuma interface nova consumida por outra task — é a ponta final da cadeia.

- [ ] **Step 1: Ler os arquivos atuais**

Leia `src/app/documentos/page.tsx` (é um arquivo grande, mais de 2000 linhas — procure por `statusFilter`, `editDialog`, `abrirEdicao`, `salvarEdicao` para entender o padrão de filtro e o modal de edição já existentes) e `src/app/documentos/_components/DocumentosFilters.tsx` (procure por `statusOptions`, `onStatusFilterChange`) por completo antes de editar. Os trechos abaixo mostram a forma esperada da mudança, mas confirme os números de linha e o texto exato contra o arquivo real — não assuma que não mudou desde a escrita deste plano.

- [ ] **Step 2: Filtro "Status da análise" — estado e chamada da API**

Em `documentos/page.tsx`, junto de onde `statusFilter` é declarado (`const [statusFilter, setStatusFilter] = useState<string>("todos");`), adicionar:

```typescript
  const [statusAnaliseIaFilter, setStatusAnaliseIaFilter] = useState<string>("todos");
```

Junto de onde `statusFilter` é persistido/restaurado (procure `parsed.statusFilter`) e incluído nas dependências de `useCallback`/`useEffect` (`statusFilter,` aparece em várias listas de dependências) — replique o mesmo tratamento para `statusAnaliseIaFilter`, nos mesmos pontos.

Junto do bloco que monta os `params` da URL (`if (statusFilter !== "todos") { params.set("status", statusFilter); }`), adicionar:

```typescript
        if (statusAnaliseIaFilter !== "todos") {
          params.set("statusAnaliseIa", statusAnaliseIaFilter);
        }
```

- [ ] **Step 3: Filtro "Status da análise" — opções e componente**

Definir a lista de opções (fixa, não vem de `filterOptions` como o `statusOptions` de status do formulário — os valores de `status_analise_ia` são um enum pequeno e conhecido, não precisam ser derivados dos dados):

```typescript
  const STATUS_ANALISE_IA_OPTIONS = [
    { value: "todos", label: "Todos" },
    { value: "recebido", label: "Aguardando análise" },
    { value: "em_analise", label: "Em análise pela IA" },
    { value: "concluida", label: "Análise concluída" },
    { value: "necessita_revisao", label: "Necessita revisão" },
    { value: "erro", label: "Erro na leitura" },
    { value: "duplicado", label: "Documento duplicado" },
  ];
```
(Declarar fora do componente, como uma constante do módulo — não dentro do render.)

Em `DocumentosFilters.tsx`, adicionar às props do componente (junto de `statusFilter: string;` e `onStatusFilterChange`):
```typescript
  statusAnaliseIaFilter: string;
  onStatusAnaliseIaFilterChange: (value: string) => void;
  statusAnaliseIaOptions: Array<{ value: string; label: string }>;
```

No JSX, logo depois do bloco `<label>` do "Status" existente (o que renderiza `statusOptions.map(...)`), adicionar um bloco irmão idêntico em estrutura:

```tsx
                <label className="text-xs font-semibold text-slate-600">
                  Status da análise
                  <select
                    value={statusAnaliseIaFilter}
                    onChange={(event) =>
                      onStatusAnaliseIaFilterChange(event.target.value)
                    }
                    className={inputClassName}
                  >
                    {statusAnaliseIaOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
```

De volta em `documentos/page.tsx`, no ponto onde `<DocumentosFilters ... statusFilter={statusFilter} .../>` é renderizado, adicionar as 3 props novas:
```tsx
            statusAnaliseIaFilter={statusAnaliseIaFilter}
            onStatusAnaliseIaFilterChange={setStatusAnaliseIaFilter}
            statusAnaliseIaOptions={STATUS_ANALISE_IA_OPTIONS}
```

- [ ] **Step 4: Campo "Equipamento" no modal de edição**

Em `documentos/page.tsx`, o estado `editDialog` (`const [editDialog, setEditDialog] = useState<{ registro: FormularioRecord; values: Record<string, string>; lojaId: string } | null>(null);`) ganha um campo `equipamentoId: string`:

```typescript
  const [editDialog, setEditDialog] = useState<{
    registro: FormularioRecord;
    values: Record<string, string>;
    lojaId: string;
    equipamentoId: string;
  } | null>(null);
```

Em `abrirEdicao`, onde `setEditDialog({ registro, values, lojaId })` é chamado, incluir o valor inicial:
```typescript
    setEditDialog({
      registro,
      values,
      lojaId,
      equipamentoId: String((registro as unknown as { equipamento_id?: string | null }).equipamento_id ?? ""),
    });
```
(O cast é necessário porque `FormularioRecord` — o tipo do registro nesta tela — precisa ganhar o campo `equipamento_id?: string | null` também; adicione esse campo ao tipo `FormularioRecord` deste arquivo, do mesmo jeito que `status_analise_ia`/`equipamento_id` foram adicionados a `DocumentRecord` na Task 6 — são tipos espelhados, um no cliente e um no servidor.)

Importar o hook no topo do arquivo:
```typescript
import { useEquipamentos } from "@/hooks/useEquipamentos";
```

Chamar o hook no nível superior do componente (não dentro de um `if`/callback — regra de hooks do React), próximo de onde outros hooks de dados já são chamados:
```typescript
  const { equipamentos: equipamentosDaLojaSelecionada } = useEquipamentos({
    lojaId: editDialog?.lojaId || undefined,
    enabled: Boolean(editDialog?.lojaId),
  });
```

No JSX do modal, logo depois do `<label>` "Loja / Unidade" (antes de `{getEditFields(editDialog.registro.tipo).map(...)}`), adicionar:

```tsx
              <label className="text-xs font-semibold text-slate-600 md:col-span-2">
                Equipamento (opcional)
                <select
                  value={editDialog.equipamentoId}
                  onChange={(e) =>
                    setEditDialog((prev) =>
                      prev ? { ...prev, equipamentoId: e.target.value } : prev,
                    )
                  }
                  disabled={!editDialog.lojaId}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                >
                  <option value="">Nenhum</option>
                  {equipamentosDaLojaSelecionada.map((equipamento) => (
                    <option key={equipamento.id} value={equipamento.id}>
                      {equipamento.tipo_equipamento}
                      {equipamento.identificacao ? ` — ${equipamento.identificacao}` : ""}
                    </option>
                  ))}
                </select>
              </label>
```

Quando a loja do `editDialog` mudar (o `onChange` do select de Loja), limpar `equipamentoId` para não manter um vínculo de uma loja diferente — no handler existente do select de Loja, ao atualizar `lojaId`, resetar `equipamentoId` para `""` na mesma chamada de `setEditDialog`.

- [ ] **Step 5: Incluir `equipamentoId` no `PATCH` de salvar edição**

Em `salvarEdicao`, o corpo do `fetch` já inclui `lojaId` condicionalmente quando muda:
```typescript
        body: JSON.stringify({
          id: editDialog.registro.id,
          updates: editDialog.values,
          ...(editDialog.lojaId && editDialog.lojaId !== String(editDialog.registro.dados?.loja_id ?? "")
            ? { lojaId: editDialog.lojaId }
            : {}),
        }),
```
Adicionar `equipamentoId` sempre que o valor mudou em relação ao original (comparar contra `String((editDialog.registro as unknown as { equipamento_id?: string | null }).equipamento_id ?? "")`):
```typescript
        body: JSON.stringify({
          id: editDialog.registro.id,
          updates: editDialog.values,
          ...(editDialog.lojaId && editDialog.lojaId !== String(editDialog.registro.dados?.loja_id ?? "")
            ? { lojaId: editDialog.lojaId }
            : {}),
          ...(editDialog.equipamentoId !==
          String((editDialog.registro as unknown as { equipamento_id?: string | null }).equipamento_id ?? "")
            ? { equipamentoId: editDialog.equipamentoId }
            : {}),
        }),
```

- [ ] **Step 6: Rodar o typecheck e o lint**

Run: `npx tsc --noEmit -p .`
Expected: sem erros.

Run: `npx eslint src/app/documentos/page.tsx src/app/documentos/_components/DocumentosFilters.tsx`
Expected: sem erros.

- [ ] **Step 7: Verificar manualmente**

Suba o dev server (`npm run dev`), logado como admin: na lista de Documentos, abra o filtro e confirme que "Status da análise" aparece com as 7 opções; filtre por "Necessita revisão" e confirme que a lista atualiza. Abra o modal de editar um documento cuja loja tenha equipamentos cadastrados e confirme que o select "Equipamento" lista só os equipamentos daquela loja; troque a loja no mesmo modal e confirme que o equipamento selecionado é limpo.

- [ ] **Step 8: Commit**

```bash
git add src/app/documentos/page.tsx src/app/documentos/_components/DocumentosFilters.tsx
git commit -m "feat: adiciona filtro por status da analise e edicao de equipamento na tela de documentos"
```
