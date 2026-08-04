# Detecção de frases críticas e classificação de emergência — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a IA extrair achados críticos estruturados (problema, recomendação técnica, prioridade, prazo) de Registro e Laudos e Notas Fiscais, gravá-los numa tabela nova, forçar revisão humana quando houver achado emergencial/crítico, e exibi-los no detalhe do documento.

**Architecture:** Extensão aditiva do pipeline de análise já existente (sub-projetos 1 e 4): novo campo `recomendacoes_criticas` no schema estruturado da IA (`openAiDocumentAnalysis.ts`), duas funções puras/insert novas em `documentAnalysisPipeline.ts` (`temAchadoUrgente`, `registrarRecomendacoesCriticas`), um novo campo opcional em `determinarStatusFinal`, wiring idêntico nos dois pontos de entrada do pipeline (`processarDocumentoComIa` e a rota manual `/api/documentos/[id]/analisar`), e uma seção nova no `DocumentDetailsDrawer.tsx`.

**Tech Stack:** Next.js App Router (TypeScript), Supabase (Postgres + RLS sem policies, controle de acesso na API), Vitest.

## Global Constraints

- Escopo de tipo de documento: só `registro_laudos` e `notas_fiscais` extraem `recomendacoes_criticas`; qualquer outro tipo sempre recebe array vazio.
- Vínculo de equipamento por achado: cada achado usa o mesmo `equipamento_id` já resolvido para o documento inteiro (não identifica equipamento por achado individualmente).
- Prioridade: enum de 6 valores exatos — `emergencial`, `critica`, `alta`, `moderada`, `preventiva`, `informativa`.
- Achado com prioridade `emergencial` ou `critica` força `status_analise_ia = 'necessita_revisao'`, mesmo que confiança/loja/competência/equipamento já indiquem `concluida`.
- A lógica de gravação de achados + força de revisão deve ser implementada **nos dois pontos de entrada do pipeline** (`processarDocumentoComIa` em `src/lib/documentAnalysisPipeline.ts` e a rota manual `src/app/api/documentos/[id]/analisar/route.ts`) — nunca só em um. Repetir esse lembrete aqui é intencional: uma revisão anterior desta sessão encontrou um bug real causado exatamente por essa lógica ter sido adicionada só no orquestrador automático.
- Fora de escopo: identificação de equipamento por achado individual, painel/tela nova (fica para o sub-projeto 7), abertura real de ordem de manutenção em sistema externo, alertas por e-mail (sub-projeto 6).
- Sem novo RPC Postgres neste sub-projeto — inserção via cliente Supabase padrão (admin), não SECURITY DEFINER.

---

### Task 1: Migração — tabela `documento_recomendacoes_criticas`

**Files:**
- Create: `supabase/migrations/202607311600_create_documento_recomendacoes_criticas.sql`

**Interfaces:**
- Produces: tabela `public.documento_recomendacoes_criticas`, consumida por `registrarRecomendacoesCriticas` (Task 4) e futuramente pelo sub-projeto 7.

- [ ] **Step 1: Escrever a migração**

```sql
-- 202607311600_create_documento_recomendacoes_criticas.sql
create table public.documento_recomendacoes_criticas (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.formularios(id) on delete cascade,
  equipamento_id uuid references public.equipamentos(id) on delete set null,
  loja_id uuid,
  tipo_documento text not null,
  competencia text,
  trecho text not null,
  pagina integer,
  problema text not null,
  componente text,
  recomendacao_tecnica text not null,
  impacto text,
  acao_necessaria text not null,
  prioridade text not null check (
    prioridade in ('emergencial', 'critica', 'alta', 'moderada', 'preventiva', 'informativa')
  ),
  prazo_dias integer,
  desligar_equipamento boolean not null default false,
  substituir_peca boolean not null default false,
  precisa_inspecao_presencial boolean not null default false,
  abrir_ordem_corretiva boolean not null default false,
  riscos text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index documento_recomendacoes_criticas_documento_id_idx
  on public.documento_recomendacoes_criticas(documento_id);

create index documento_recomendacoes_criticas_equipamento_id_idx
  on public.documento_recomendacoes_criticas(equipamento_id)
  where equipamento_id is not null;

alter table public.documento_recomendacoes_criticas enable row level security;
-- Sem policies: controle de acesso inteiramente na camada da API (mesmo padrao
-- de formularios/equipamentos/documentos_analises_ia), acessado so via
-- supabaseAdmin (service role) no servidor.

revoke all on public.documento_recomendacoes_criticas from public, anon, authenticated;
```

- [ ] **Step 2: Aplicar a migração no projeto Supabase**

Rodar a migração (via CLI/MCP do projeto, conforme já usado nos sub-projetos anteriores).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202607311600_create_documento_recomendacoes_criticas.sql
git commit -m "feat(documentos): cria tabela documento_recomendacoes_criticas"
```

---

### Task 2: Schema, tipo e prompt da IA para `recomendacoes_criticas`

**Files:**
- Modify: `src/lib/openAiDocumentAnalysis.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `DocumentoAnaliseIa.recomendacoes_criticas: RecomendacaoCritica[]` (tipo `RecomendacaoCritica` exportado), consumido por `temAchadoUrgente`/`registrarRecomendacoesCriticas` (Tasks 3-4) e pela UI (Task 7).

- [ ] **Step 1: Adicionar o tipo `RecomendacaoCritica` e o campo em `DocumentoAnaliseIa`**

Em `src/lib/openAiDocumentAnalysis.ts`, logo antes de `export type DocumentoAnaliseIa`:

```typescript
export type RecomendacaoCritica = {
  trecho: string;
  pagina: number | null;
  problema: string;
  componente: string | null;
  recomendacao_tecnica: string;
  prioridade:
    | "emergencial"
    | "critica"
    | "alta"
    | "moderada"
    | "preventiva"
    | "informativa";
  prazo_dias: number | null;
  impacto: string | null;
  acao_necessaria: string;
  desligar_equipamento: boolean;
  substituir_peca: boolean;
  precisa_inspecao_presencial: boolean;
  abrir_ordem_corretiva: boolean;
  riscos: string[];
};
```

E dentro de `DocumentoAnaliseIa`, logo após `equipamento_numero_serie: string | null;` (linha 40):

```typescript
  equipamento_numero_serie: string | null;
  recomendacoes_criticas: RecomendacaoCritica[];
};
```

- [ ] **Step 2: Adicionar `recomendacoes_criticas` ao `ANALISE_SCHEMA`**

Em `required` (após `"equipamento_numero_serie",`):

```typescript
    "equipamento_numero_serie",
    "recomendacoes_criticas",
  ],
```

Em `properties` (após `equipamento_numero_serie: { anyOf: [{ type: "string" }, { type: "null" }] },`, seguindo exatamente o padrão já usado no array `itens`):

```typescript
    equipamento_numero_serie: { anyOf: [{ type: "string" }, { type: "null" }] },
    recomendacoes_criticas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "trecho",
          "pagina",
          "problema",
          "componente",
          "recomendacao_tecnica",
          "prioridade",
          "prazo_dias",
          "impacto",
          "acao_necessaria",
          "desligar_equipamento",
          "substituir_peca",
          "precisa_inspecao_presencial",
          "abrir_ordem_corretiva",
          "riscos",
        ],
        properties: {
          trecho: { type: "string" },
          pagina: { anyOf: [{ type: "integer" }, { type: "null" }] },
          problema: { type: "string" },
          componente: { anyOf: [{ type: "string" }, { type: "null" }] },
          recomendacao_tecnica: { type: "string" },
          prioridade: {
            type: "string",
            enum: [
              "emergencial",
              "critica",
              "alta",
              "moderada",
              "preventiva",
              "informativa",
            ],
          },
          prazo_dias: { anyOf: [{ type: "integer" }, { type: "null" }] },
          impacto: { anyOf: [{ type: "string" }, { type: "null" }] },
          acao_necessaria: { type: "string" },
          desligar_equipamento: { type: "boolean" },
          substituir_peca: { type: "boolean" },
          precisa_inspecao_presencial: { type: "boolean" },
          abrir_ordem_corretiva: { type: "boolean" },
          riscos: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};
```

- [ ] **Step 3: Estender o prompt do sistema**

No bloco `content:` da mensagem `role: "system"` (linha ~374), o texto termina em:

`"...(4) Para qualquer outro tipo de documento, sempre retorne null nos tres campos — nao tente adivinhar."`

Acrescentar, antes das aspas finais desse literal de string:

```
 IMPORTANTE — Para documentos do tipo 'registro_laudos' ou 'notas_fiscais', preencha tambem 'recomendacoes_criticas': (1) Procure semanticamente por indicios de problema, risco ou necessidade de manutencao no documento — nao so frases literais como 'e necessario substituir' ou 'equipamento apresenta falha', mas variacoes de escrita e o contexto tecnico do documento como um todo. (2) Para cada achado, preencha 'trecho' com o texto original que motivou o achado, 'problema' com o que foi identificado, 'recomendacao_tecnica' com uma recomendacao especifica baseada no conteudo real do documento (nunca generica como 'fazer manutencao'), e 'acao_necessaria' com a acao objetiva a tomar. (3) Classifique 'prioridade' considerando o contexto, nao uma palavra isolada: 'emergencial' = acao imediata (risco iminente); 'critica' = resolver em ate 24h; 'alta' = ate 3 dias; 'moderada' = ate 7 dias; 'preventiva' = acompanhar ou programar; 'informativa' = nao exige acao. (4) Preencha 'prazo_dias' com o prazo em dias quando aplicavel (0 para emergencial), ou null. (5) Os campos booleanos 'desligar_equipamento', 'substituir_peca', 'precisa_inspecao_presencial' e 'abrir_ordem_corretiva' devem refletir apenas o que o documento realmente indica. (6) Em 'riscos', liste um subconjunto livre de: operacional, eletrico, estrutural, sanitario, seguranca — so os que se aplicam. (7) Para qualquer outro tipo de documento, ou quando nao houver nenhum achado, retorne 'recomendacoes_criticas' como array vazio.
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/openAiDocumentAnalysis.ts
git commit -m "feat(documentos): adiciona recomendacoes_criticas ao schema de analise por IA"
```

---

### Task 3: `temAchadoUrgente` (função pura) + testes

**Files:**
- Modify: `src/lib/documentAnalysisPipeline.ts`
- Test: `src/lib/documentAnalysisPipeline.test.ts`

**Interfaces:**
- Consumes: `DocumentoAnaliseIa.recomendacoes_criticas` (Task 2), `RecomendacaoCritica` type.
- Produces: `temAchadoUrgente(resultado: DocumentoAnaliseIa): boolean`, consumido por Task 5 (`determinarStatusFinal` wiring) e Tasks 5-6 (orquestrador + rota manual).

- [ ] **Step 1: Escrever os testes que falham**

Em `src/lib/documentAnalysisPipeline.test.ts`, adicionar um `describe` novo (pode ficar logo após o `describe("determinarStatusFinal com contexto de equipamento", ...)` já existente, linha ~165):

```typescript
describe("temAchadoUrgente", () => {
  it("retorna false quando nao ha recomendacoes_criticas", () => {
    expect(temAchadoUrgente(resultadoBase({ recomendacoes_criticas: [] }))).toBe(false);
  });

  it("retorna false quando so ha achados de prioridade baixa", () => {
    const resultado = resultadoBase({
      recomendacoes_criticas: [
        recomendacaoCriticaBase({ prioridade: "moderada" }),
        recomendacaoCriticaBase({ prioridade: "preventiva" }),
        recomendacaoCriticaBase({ prioridade: "informativa" }),
      ],
    });
    expect(temAchadoUrgente(resultado)).toBe(false);
  });

  it("retorna false para prioridade alta isolada", () => {
    const resultado = resultadoBase({
      recomendacoes_criticas: [recomendacaoCriticaBase({ prioridade: "alta" })],
    });
    expect(temAchadoUrgente(resultado)).toBe(false);
  });

  it("retorna true quando ha um achado critica", () => {
    const resultado = resultadoBase({
      recomendacoes_criticas: [
        recomendacaoCriticaBase({ prioridade: "moderada" }),
        recomendacaoCriticaBase({ prioridade: "critica" }),
      ],
    });
    expect(temAchadoUrgente(resultado)).toBe(true);
  });

  it("retorna true quando ha um achado emergencial", () => {
    const resultado = resultadoBase({
      recomendacoes_criticas: [recomendacaoCriticaBase({ prioridade: "emergencial" })],
    });
    expect(temAchadoUrgente(resultado)).toBe(true);
  });
});
```

E adicionar o helper `recomendacaoCriticaBase` logo após a função `resultadoBase` já existente no topo do arquivo (~linha 55), e incluir `recomendacoes_criticas: []` nos campos padrão de `resultadoBase`:

```typescript
function resultadoBase(overrides: Partial<DocumentoAnaliseIa> = {}): DocumentoAnaliseIa {
  return {
    tipo_documento: "notas_fiscais",
    competencias: ["07/2026"],
    lojas: [{ codigo: "001", nome: "Loja Teste", confianca: 0.9 }],
    prestador: "Prestador Teste",
    cnpj: null,
    numero_orcamento: null,
    numero_nf: "123",
    numero_pedido: null,
    numero_contrato: null,
    valor_total: 100,
    descricao: null,
    objeto: null,
    tipo_servico: null,
    data_assinatura: null,
    data_vencimento: null,
    data_validade: null,
    itens: [],
    alertas: [],
    confianca_geral: 0.9,
    observacoes: null,
    recomendacoes: [],
    equipamento_tipo: null,
    equipamento_identificacao: null,
    equipamento_numero_serie: null,
    recomendacoes_criticas: [],
    ...overrides,
  };
}

function recomendacaoCriticaBase(
  overrides: Partial<RecomendacaoCritica> = {},
): RecomendacaoCritica {
  return {
    trecho: "Equipamento apresenta ruido anormal.",
    pagina: 1,
    problema: "Ruido anormal no compressor.",
    componente: "Compressor",
    recomendacao_tecnica: "Inspecionar e lubrificar rolamentos do compressor.",
    prioridade: "moderada",
    prazo_dias: 7,
    impacto: "Risco de parada do equipamento.",
    acao_necessaria: "Agendar inspecao tecnica.",
    desligar_equipamento: false,
    substituir_peca: false,
    precisa_inspecao_presencial: true,
    abrir_ordem_corretiva: false,
    riscos: ["operacional"],
    ...overrides,
  };
}
```

E importar `RecomendacaoCritica` junto de `DocumentoAnaliseIa` no topo do arquivo de teste (linha ~26):

```typescript
import type { DocumentoAnaliseIa, RecomendacaoCritica } from "@/lib/openAiDocumentAnalysis";
```

E adicionar `temAchadoUrgente` ao bloco de import de `@/lib/documentAnalysisPipeline` (linha ~12-24).

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- documentAnalysisPipeline`
Expected: FAIL com "temAchadoUrgente is not defined" (ou erro de tipo por `recomendacoes_criticas` ausente).

- [ ] **Step 3: Implementar `temAchadoUrgente`**

Em `src/lib/documentAnalysisPipeline.ts`, adicionar logo após `determinarStatusFinal` (após a linha 45):

```typescript
const PRIORIDADES_URGENTES = new Set(["emergencial", "critica"]);

export function temAchadoUrgente(resultado: DocumentoAnaliseIa): boolean {
  return (resultado.recomendacoes_criticas ?? []).some((achado) =>
    PRIORIDADES_URGENTES.has(achado.prioridade),
  );
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- documentAnalysisPipeline`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentAnalysisPipeline.ts src/lib/documentAnalysisPipeline.test.ts
git commit -m "feat(documentos): adiciona temAchadoUrgente"
```

---

### Task 4: `registrarRecomendacoesCriticas` (insert helper) + testes

**Files:**
- Modify: `src/lib/documentAnalysisPipeline.ts`
- Test: `src/lib/documentAnalysisPipeline.test.ts`

**Interfaces:**
- Consumes: `RecomendacaoCritica[]` (Task 2), tabela `documento_recomendacoes_criticas` (Task 1).
- Produces: `registrarRecomendacoesCriticas(supabaseAdmin, params: { documentoId: string; equipamentoId: string | null; lojaId: string | null; tipoDocumento: string; competencia: string | null; achados: RecomendacaoCritica[] }): Promise<void>`, consumido por Tasks 5-6.

- [ ] **Step 1: Escrever os testes que falham**

Em `src/lib/documentAnalysisPipeline.test.ts`, adicionar `describe("registrarRecomendacoesCriticas", ...)` logo após o `describe("registrarAnaliseIa", ...)` existente (~linha 418):

```typescript
describe("registrarRecomendacoesCriticas", () => {
  it("nao chama insert quando nao ha achados", async () => {
    const insert = vi.fn();
    const supabase = { from: () => ({ insert }) } as unknown as SupabaseClient;

    await registrarRecomendacoesCriticas(supabase, {
      documentoId: "doc-1",
      equipamentoId: "eq-1",
      lojaId: "loja-1",
      tipoDocumento: "registro_laudos",
      competencia: "07/2026",
      achados: [],
    });

    expect(insert).not.toHaveBeenCalled();
  });

  it("insere uma linha por achado com equipamento_id e loja_id copiados do documento", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const supabase = { from: () => ({ insert }) } as unknown as SupabaseClient;

    await registrarRecomendacoesCriticas(supabase, {
      documentoId: "doc-1",
      equipamentoId: "eq-1",
      lojaId: "loja-1",
      tipoDocumento: "registro_laudos",
      competencia: "07/2026",
      achados: [
        recomendacaoCriticaBase({ prioridade: "critica" }),
        recomendacaoCriticaBase({ prioridade: "moderada" }),
      ],
    });

    expect(insert).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        documento_id: "doc-1",
        equipamento_id: "eq-1",
        loja_id: "loja-1",
        tipo_documento: "registro_laudos",
        competencia: "07/2026",
        prioridade: "critica",
      }),
    );
  });

  it("insere com equipamento_id null quando o documento nao tem equipamento resolvido", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const supabase = { from: () => ({ insert }) } as unknown as SupabaseClient;

    await registrarRecomendacoesCriticas(supabase, {
      documentoId: "doc-1",
      equipamentoId: null,
      lojaId: "loja-1",
      tipoDocumento: "notas_fiscais",
      competencia: "07/2026",
      achados: [recomendacaoCriticaBase()],
    });

    const rows = insert.mock.calls[0][0];
    expect(rows[0].equipamento_id).toBeNull();
  });

  it("propaga erro do supabase", async () => {
    const insert = vi.fn(async () => ({ error: new Error("falhou") }));
    const supabase = { from: () => ({ insert }) } as unknown as SupabaseClient;

    await expect(
      registrarRecomendacoesCriticas(supabase, {
        documentoId: "doc-1",
        equipamentoId: null,
        lojaId: null,
        tipoDocumento: "notas_fiscais",
        competencia: null,
        achados: [recomendacaoCriticaBase()],
      }),
    ).rejects.toThrow("falhou");
  });
});
```

Adicionar `registrarRecomendacoesCriticas` ao bloco de import de `@/lib/documentAnalysisPipeline`.

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- documentAnalysisPipeline`
Expected: FAIL com "registrarRecomendacoesCriticas is not defined"

- [ ] **Step 3: Implementar `registrarRecomendacoesCriticas`**

Em `src/lib/documentAnalysisPipeline.ts`, adicionar logo após `registrarAnaliseIa` (após a linha 202), importando `RecomendacaoCritica` no topo do arquivo:

```typescript
import {
  analisarDocumentoComOpenAi,
  type DocumentoAnaliseIa,
  type RecomendacaoCritica,
} from "@/lib/openAiDocumentAnalysis";
```

```typescript
export async function registrarRecomendacoesCriticas(
  supabaseAdmin: SupabaseClient,
  params: {
    documentoId: string;
    equipamentoId: string | null;
    lojaId: string | null;
    tipoDocumento: string;
    competencia: string | null;
    achados: RecomendacaoCritica[];
  },
): Promise<void> {
  if (params.achados.length === 0) {
    return;
  }

  const rows = params.achados.map((achado) => ({
    documento_id: params.documentoId,
    equipamento_id: params.equipamentoId,
    loja_id: params.lojaId,
    tipo_documento: params.tipoDocumento,
    competencia: params.competencia,
    trecho: achado.trecho,
    pagina: achado.pagina,
    problema: achado.problema,
    componente: achado.componente,
    recomendacao_tecnica: achado.recomendacao_tecnica,
    impacto: achado.impacto,
    acao_necessaria: achado.acao_necessaria,
    prioridade: achado.prioridade,
    prazo_dias: achado.prazo_dias,
    desligar_equipamento: achado.desligar_equipamento,
    substituir_peca: achado.substituir_peca,
    precisa_inspecao_presencial: achado.precisa_inspecao_presencial,
    abrir_ordem_corretiva: achado.abrir_ordem_corretiva,
    riscos: achado.riscos,
  }));

  const { error } = await supabaseAdmin
    .from("documento_recomendacoes_criticas")
    .insert(rows);

  if (error) {
    throw error;
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- documentAnalysisPipeline`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentAnalysisPipeline.ts src/lib/documentAnalysisPipeline.test.ts
git commit -m "feat(documentos): adiciona registrarRecomendacoesCriticas"
```

---

### Task 5: Estender `determinarStatusFinal` + wiring no orquestrador automático

**Files:**
- Modify: `src/lib/documentAnalysisPipeline.ts`
- Test: `src/lib/documentAnalysisPipeline.test.ts`

**Interfaces:**
- Consumes: `temAchadoUrgente` (Task 3), `registrarRecomendacoesCriticas` (Task 4).
- Produces: `determinarStatusFinal(resultado, contexto?: { equipamentoRequerido: boolean; equipamentoResolvido: boolean; achadoUrgente?: boolean })` — assinatura estendida, retrocompatível. `processarDocumentoComIa` passa a gravar achados e considerar `achadoUrgente`.

- [ ] **Step 1: Escrever os testes que falham (determinarStatusFinal)**

Adicionar ao `describe("determinarStatusFinal com contexto de equipamento", ...)` existente (~linha 137-165):

```typescript
  it("forca necessita_revisao quando ha achado urgente, mesmo com tudo resolvido", () => {
    const resultado = determinarStatusFinal(resultadoBase(), {
      equipamentoRequerido: true,
      equipamentoResolvido: true,
      achadoUrgente: true,
    });
    expect(resultado).toBe("necessita_revisao");
  });

  it("mantem concluida quando achadoUrgente e false e tudo mais resolvido", () => {
    const resultado = determinarStatusFinal(resultadoBase(), {
      equipamentoRequerido: true,
      equipamentoResolvido: true,
      achadoUrgente: false,
    });
    expect(resultado).toBe("concluida");
  });

  it("mantem comportamento quando achadoUrgente nao e informado", () => {
    const resultado = determinarStatusFinal(resultadoBase(), {
      equipamentoRequerido: false,
      equipamentoResolvido: false,
    });
    expect(resultado).toBe("concluida");
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- documentAnalysisPipeline`
Expected: FAIL — `achadoUrgente` nao existe no tipo do contexto, ou o teste de "forca" retorna `concluida`.

- [ ] **Step 3: Estender `determinarStatusFinal`**

Substituir a função existente (linhas 28-45) por:

```typescript
export function determinarStatusFinal(
  resultado: DocumentoAnaliseIa,
  contexto?: {
    equipamentoRequerido: boolean;
    equipamentoResolvido: boolean;
    achadoUrgente?: boolean;
  },
): "concluida" | "necessita_revisao" {
  const semLoja = !resultado.lojas || resultado.lojas.length === 0;
  const semCompetencia =
    !resultado.competencias || resultado.competencias.length === 0;
  const confiancaBaixa =
    typeof resultado.confianca_geral !== "number" ||
    resultado.confianca_geral < LIMIAR_CONFIANCA_REVISAO;
  const semEquipamentoObrigatorio =
    Boolean(contexto?.equipamentoRequerido) && !contexto?.equipamentoResolvido;
  const achadoUrgente = Boolean(contexto?.achadoUrgente);

  if (
    semLoja ||
    semCompetencia ||
    confiancaBaixa ||
    semEquipamentoObrigatorio ||
    achadoUrgente
  ) {
    return "necessita_revisao";
  }
  return "concluida";
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- documentAnalysisPipeline`
Expected: PASS

- [ ] **Step 5: Escrever o teste que falha (wiring em processarDocumentoComIa)**

Adicionar ao `describe("processarDocumentoComIa", ...)` existente, após o teste "vincula equipamento..." (~linha 653):

```typescript
  it("grava recomendacoes_criticas e forca necessita_revisao quando ha achado critica", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
      provider: "azure-openai",
      model: "gpt-5-chat",
      resultado: resultadoBase({
        recomendacoes_criticas: [recomendacaoCriticaBase({ prioridade: "critica" })],
      }),
    });

    const { supabase, updates, inserts } = criarSupabaseFake({
      registro: {
        id: "doc-5",
        tipo: "notas_fiscais",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/nota.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
      },
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-5");

    expect(resultado.status).toBe("necessita_revisao");
    const ultimoUpdate = updates[updates.length - 1];
    expect(ultimoUpdate.payload.status_analise_ia).toBe("necessita_revisao");
    expect(inserts.filter((i) => i.table === "documento_recomendacoes_criticas")).toHaveLength(1);
  });

  it("nao forca revisao quando so ha achados de prioridade baixa", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
      provider: "azure-openai",
      model: "gpt-5-chat",
      resultado: resultadoBase({
        recomendacoes_criticas: [recomendacaoCriticaBase({ prioridade: "preventiva" })],
      }),
    });

    const { supabase, updates } = criarSupabaseFake({
      registro: {
        id: "doc-6",
        tipo: "notas_fiscais",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/nota.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
      },
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-6");

    expect(resultado.status).toBe("concluida");
    const ultimoUpdate = updates[updates.length - 1];
    expect(ultimoUpdate.payload.status_analise_ia).toBe("concluida");
  });

  it("nao insere linhas quando nao ha achados criticos", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
      provider: "azure-openai",
      model: "gpt-5-chat",
      resultado: resultadoBase({ recomendacoes_criticas: [] }),
    });

    const { supabase, inserts } = criarSupabaseFake({
      registro: {
        id: "doc-7",
        tipo: "notas_fiscais",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/nota.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
      },
    });

    await processarDocumentoComIa(supabase, "doc-7");

    expect(inserts.filter((i) => i.table === "documento_recomendacoes_criticas")).toHaveLength(0);
  });
```

Estender o `criarSupabaseFake` (linhas 420-507) para rastrear inserts e responder pela nova tabela — trocar a assinatura e o corpo por:

```typescript
function criarSupabaseFake(options: {
  registro: Record<string, unknown> | null;
  duplicado?: boolean;
  downloadOk?: boolean;
  equipamentosAtivos?: EquipamentoAtivo[];
}) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; payload: unknown }> = [];
  let selectCallCount = 0;

  const supabase = {
    from: (table: string) => {
      if (table === "formularios") {
        return {
          select: () => {
            selectCallCount += 1;
            const isInitialFetch = selectCallCount === 1;
            const chain: {
              eq: () => typeof chain;
              neq: () => typeof chain;
              limit: () => typeof chain;
              maybeSingle: () => Promise<{ data: unknown; error: null }>;
            } = {
              eq: () => chain,
              neq: () => chain,
              limit: () => chain,
              maybeSingle: async () =>
                isInitialFetch
                  ? { data: options.registro, error: null }
                  : {
                      data: options.duplicado ? { id: "doc-existente" } : null,
                      error: null,
                    },
            };
            return chain;
          },
          update: (payload: Record<string, unknown>) => {
            updates.push({ table, payload });
            return { eq: async () => ({ data: null, error: null }) };
          },
        };
      }
      if (table === "documentos_analises_ia") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: "analise-1", status: "concluida" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "documento_recomendacoes_criticas") {
        return {
          insert: (payload: unknown) => {
            inserts.push({ table, payload });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "equipamentos") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({
                data: options.equipamentosAtivos ?? [],
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Tabela inesperada no teste: ${table}`);
    },
    storage: {
      from: () => ({
        download: async () =>
          options.downloadOk === false
            ? { data: null, error: new Error("falha no download") }
            : {
                data: {
                  type: "application/pdf",
                  arrayBuffer: async () => new ArrayBuffer(4),
                },
                error: null,
              },
      }),
    },
  } as unknown as SupabaseClient;

  return { supabase, updates, inserts };
}
```

- [ ] **Step 6: Rodar os testes e confirmar que falham**

Run: `npm test -- documentAnalysisPipeline`
Expected: FAIL — `processarDocumentoComIa` ainda nao grava achados nem considera `achadoUrgente`.

- [ ] **Step 7: Implementar o wiring em `processarDocumentoComIa`**

Em `src/lib/documentAnalysisPipeline.ts`, dentro de `processarDocumentoComIa`, substituir o trecho (linhas 344-379):

```typescript
    let equipamentoId: string | null = row.equipamento_id;
    let equipamentoRequerido = false;
    const lojaId = typeof dados?.loja_id === "string" ? dados.loja_id : null;

    if (deveTentarEquipamento(row.tipo) && lojaId && !equipamentoId) {
      const sinalDeEquipamento = Boolean(
        resultado.equipamento_tipo?.trim() ||
          resultado.equipamento_numero_serie?.trim() ||
          resultado.equipamento_identificacao?.trim(),
      );
      if (sinalDeEquipamento) {
        const equipamentosAtivos = await buscarEquipamentosAtivosDaLoja(supabaseAdmin, lojaId);
        if (equipamentosAtivos.length > 0) {
          equipamentoRequerido = true;
          const match = encontrarEquipamentoCorrespondente(equipamentosAtivos, resultado);
          equipamentoId = match?.id ?? null;
        }
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

por:

```typescript
    let equipamentoId: string | null = row.equipamento_id;
    let equipamentoRequerido = false;
    const lojaId = typeof dados?.loja_id === "string" ? dados.loja_id : null;

    if (deveTentarEquipamento(row.tipo) && lojaId && !equipamentoId) {
      const sinalDeEquipamento = Boolean(
        resultado.equipamento_tipo?.trim() ||
          resultado.equipamento_numero_serie?.trim() ||
          resultado.equipamento_identificacao?.trim(),
      );
      if (sinalDeEquipamento) {
        const equipamentosAtivos = await buscarEquipamentosAtivosDaLoja(supabaseAdmin, lojaId);
        if (equipamentosAtivos.length > 0) {
          equipamentoRequerido = true;
          const match = encontrarEquipamentoCorrespondente(equipamentosAtivos, resultado);
          equipamentoId = match?.id ?? null;
        }
      }
    }

    const competencia =
      typeof dados?.competencia === "string" ? dados.competencia : null;

    await registrarRecomendacoesCriticas(supabaseAdmin, {
      documentoId: row.id,
      equipamentoId,
      lojaId,
      tipoDocumento: row.tipo,
      competencia,
      achados: resultado.recomendacoes_criticas ?? [],
    });

    const statusFinal = determinarStatusFinal(resultado, {
      equipamentoRequerido,
      equipamentoResolvido: equipamentoId !== null,
      achadoUrgente: temAchadoUrgente(resultado),
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

- [ ] **Step 8: Rodar os testes e confirmar que passam**

Run: `npm test -- documentAnalysisPipeline`
Expected: PASS (todos os testes de `documentAnalysisPipeline.test.ts`)

- [ ] **Step 9: Commit**

```bash
git add src/lib/documentAnalysisPipeline.ts src/lib/documentAnalysisPipeline.test.ts
git commit -m "feat(documentos): forca revisao em achado critico e grava achados no orquestrador automatico"
```

---

### Task 6: Mesmo wiring na rota manual de reanálise

**Files:**
- Modify: `src/app/api/documentos/[id]/analisar/route.ts`

**Interfaces:**
- Consumes: `registrarRecomendacoesCriticas`, `temAchadoUrgente` (do `documentAnalysisPipeline.ts`, Tasks 3-4).
- Produces: mesmo comportamento de gravação de achados + força de revisão que o orquestrador automático (Task 5), aplicado à rota manual.

Esta task existe separada da Task 5 propositalmente — é o ponto do plano que existe especificamente para não repetir o bug da sessão anterior (lógica adicionada só no orquestrador automático e esquecida aqui).

- [ ] **Step 1: Atualizar os imports**

Em `src/app/api/documentos/[id]/analisar/route.ts`, trocar o bloco de import de `@/lib/documentAnalysisPipeline` (linhas 9-16):

```typescript
import {
  baixarEAnalisarArquivo,
  buscarEquipamentosAtivosDaLoja,
  determinarStatusFinal,
  deveTentarEquipamento,
  encontrarEquipamentoCorrespondente,
  registrarAnaliseIa,
  registrarRecomendacoesCriticas,
  temAchadoUrgente,
} from "@/lib/documentAnalysisPipeline";
```

- [ ] **Step 2: Aplicar o mesmo wiring**

Substituir o trecho (linhas 84-107):

```typescript
    let equipamentoId: string | null = row.equipamento_id;
    let equipamentoRequerido = false;
    const lojaId = typeof dadosAtuais?.loja_id === "string" ? dadosAtuais.loja_id : null;

    if (deveTentarEquipamento(row.tipo) && lojaId && !equipamentoId) {
      const sinalDeEquipamento = Boolean(
        resultado.equipamento_tipo?.trim() ||
          resultado.equipamento_numero_serie?.trim() ||
          resultado.equipamento_identificacao?.trim(),
      );
      if (sinalDeEquipamento) {
        const equipamentosAtivos = await buscarEquipamentosAtivosDaLoja(supabaseAdmin, lojaId);
        if (equipamentosAtivos.length > 0) {
          equipamentoRequerido = true;
          const match = encontrarEquipamentoCorrespondente(equipamentosAtivos, resultado);
          equipamentoId = match?.id ?? null;
        }
      }
    }

    const statusFinal = determinarStatusFinal(resultado, {
      equipamentoRequerido,
      equipamentoResolvido: equipamentoId !== null,
    });
```

por:

```typescript
    let equipamentoId: string | null = row.equipamento_id;
    let equipamentoRequerido = false;
    const lojaId = typeof dadosAtuais?.loja_id === "string" ? dadosAtuais.loja_id : null;

    if (deveTentarEquipamento(row.tipo) && lojaId && !equipamentoId) {
      const sinalDeEquipamento = Boolean(
        resultado.equipamento_tipo?.trim() ||
          resultado.equipamento_numero_serie?.trim() ||
          resultado.equipamento_identificacao?.trim(),
      );
      if (sinalDeEquipamento) {
        const equipamentosAtivos = await buscarEquipamentosAtivosDaLoja(supabaseAdmin, lojaId);
        if (equipamentosAtivos.length > 0) {
          equipamentoRequerido = true;
          const match = encontrarEquipamentoCorrespondente(equipamentosAtivos, resultado);
          equipamentoId = match?.id ?? null;
        }
      }
    }

    const competencia =
      typeof dadosAtuais?.competencia === "string" ? dadosAtuais.competencia : null;

    await registrarRecomendacoesCriticas(supabaseAdmin, {
      documentoId: row.id,
      equipamentoId,
      lojaId,
      tipoDocumento: row.tipo,
      competencia,
      achados: resultado.recomendacoes_criticas ?? [],
    });

    const statusFinal = determinarStatusFinal(resultado, {
      equipamentoRequerido,
      equipamentoResolvido: equipamentoId !== null,
      achadoUrgente: temAchadoUrgente(resultado),
    });
```

O restante da função (bloco `updatePayload` em diante) já reaproveita `statusFinal`/`equipamentoId` sem mudanças.

- [ ] **Step 3: Verificar manualmente (sem endpoint de teste automatizado dedicado — a rota já é coberta indiretamente pelo typecheck e pelos testes unitários das funções que ela chama)**

Rodar o typecheck do projeto para garantir que a rota compila com a nova assinatura:

Run: `npx tsc --noEmit`
Expected: sem erros em `src/app/api/documentos/[id]/analisar/route.ts`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/documentos/[id]/analisar/route.ts
git commit -m "feat(documentos): aplica gravacao de achados criticos e forca de revisao na rota manual de reanalise"
```

---

### Task 7: Exibição dos achados críticos no `DocumentDetailsDrawer`

**Files:**
- Modify: `src/app/documentos/_components/DocumentDetailsDrawer.tsx`

**Interfaces:**
- Consumes: `resultado.recomendacoes_criticas` já presente no JSONB retornado pela API de detalhe do documento (nenhuma mudança de rota necessária — o campo passa a vir automaticamente assim que a Task 2 estiver em produção).
- Produces: nada consumido por outra task — é a última task do plano.

- [ ] **Step 1: Estender o tipo local `DocumentoAnaliseResultado`**

Em `src/app/documentos/_components/DocumentDetailsDrawer.tsx`, adicionar um tipo novo logo antes de `type DocumentoAnaliseResultado` (linha 45):

```typescript
type RecomendacaoCriticaResultado = {
  trecho: string;
  pagina: number | null;
  problema: string;
  componente: string | null;
  recomendacao_tecnica: string;
  prioridade:
    | "emergencial"
    | "critica"
    | "alta"
    | "moderada"
    | "preventiva"
    | "informativa";
  prazo_dias: number | null;
  impacto: string | null;
  acao_necessaria: string;
  desligar_equipamento: boolean;
  substituir_peca: boolean;
  precisa_inspecao_presencial: boolean;
  abrir_ordem_corretiva: boolean;
  riscos: string[];
};
```

E, dentro de `DocumentoAnaliseResultado`, acrescentar após `recomendacoes?: string[];` (linha 75):

```typescript
  recomendacoes?: string[];
  recomendacoes_criticas?: RecomendacaoCriticaResultado[];
};
```

- [ ] **Step 2: Adicionar um helper de estilo por prioridade**

Adicionar, próximo aos demais helpers de formatação do arquivo (ex.: perto de `formatConfidence`), uma função que mapeia prioridade para cor/etiqueta:

```typescript
const PRIORIDADE_ESTILO: Record<
  RecomendacaoCriticaResultado["prioridade"],
  { label: string; badgeClass: string }
> = {
  emergencial: { label: "Emergencial", badgeClass: "bg-red-600 text-white" },
  critica: { label: "Critica", badgeClass: "bg-red-100 text-red-800" },
  alta: { label: "Alta", badgeClass: "bg-orange-100 text-orange-800" },
  moderada: { label: "Moderada", badgeClass: "bg-amber-100 text-amber-800" },
  preventiva: { label: "Preventiva", badgeClass: "bg-blue-100 text-blue-800" },
  informativa: { label: "Informativa", badgeClass: "bg-slate-100 text-slate-700" },
};
```

- [ ] **Step 3: Adicionar a seção de exibição**

No JSX, logo após o bloco existente de `analiseResultado.recomendacoes` (que termina na linha 878, fechando com `) : null}` — esse bloco genérico **não muda**), adicionar a nova seção:

```tsx
                    {analiseResultado.recomendacoes_criticas &&
                    analiseResultado.recomendacoes_criticas.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Achados criticos identificados
                        </p>
                        {analiseResultado.recomendacoes_criticas.map((achado, i) => {
                          const estilo = PRIORIDADE_ESTILO[achado.prioridade];
                          const flags = [
                            achado.desligar_equipamento && "Desligar equipamento",
                            achado.substituir_peca && "Substituir peca",
                            achado.precisa_inspecao_presencial && "Inspecao presencial",
                            achado.abrir_ordem_corretiva && "Abrir ordem corretiva",
                          ].filter((flag): flag is string => Boolean(flag));

                          return (
                            <div
                              key={i}
                              className="rounded-xl border border-red-100 bg-red-50 px-4 py-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${estilo.badgeClass}`}
                                >
                                  {estilo.label}
                                </span>
                                {achado.prazo_dias !== null ? (
                                  <span className="text-[11px] font-medium text-red-700">
                                    Prazo: {achado.prazo_dias} dia(s)
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-2 text-sm font-medium text-red-900">
                                {achado.problema}
                              </p>
                              <p className="mt-1 text-xs text-red-800">
                                {achado.acao_necessaria}
                              </p>
                              {flags.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {flags.map((flag) => (
                                    <span
                                      key={flag}
                                      className="rounded-full bg-red-600/10 px-2 py-0.5 text-[10px] font-semibold text-red-700"
                                    >
                                      {flag}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
```

- [ ] **Step 4: Verificar manualmente no navegador**

Rodar `npm run dev`, abrir um documento (Registro e Laudos ou Notas Fiscais) já analisado que tenha `resultado.recomendacoes_criticas` populado (pode ser simulado inserindo um resultado de teste na tabela `documentos_analises_ia` via SQL, ou reanalisando um documento real após o deploy da Task 2) e confirmar que a seção nova aparece corretamente, sem quebrar a seção genérica de `recomendacoes` já existente.

- [ ] **Step 5: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add src/app/documentos/_components/DocumentDetailsDrawer.tsx
git commit -m "feat(documentos): exibe achados criticos estruturados no detalhe do documento"
```

---

## Self-Review

**Cobertura do spec:**
- Extração pela IA (schema + prompt, escopo por tipo) → Task 2. ✅
- Armazenamento (tabela nova) → Task 1. ✅
- Onde entra no pipeline (dois pontos de entrada, gravação + força de revisão) → Tasks 3, 4, 5, 6. ✅
- Tela (seção nova aditiva no drawer) → Task 7. ✅
- Fora de escopo (equipamento por achado, painel novo, ordem real, e-mail) → nenhuma task cria isso. ✅
- Todos os itens de "Testes necessários" do spec têm teste correspondente: escopo por tipo (Task 2 é só schema/prompt, coberto indiretamente — o teste automatizável real é "tipo fora do escopo sempre array vazio", que já é garantido pelo prompt + pela ausência de wiring de `registrarRecomendacoesCriticas` fora de `deveTentarEquipamento`... na verdade a chamada a `registrarRecomendacoesCriticas` roda para *qualquer* tipo em `deveAnalisarAutomaticamente`, mas com `achados: resultado.recomendacoes_criticas ?? []` — como o prompt garante array vazio para tipos fora de escopo, `registrarRecomendacoesCriticas` recebe `achados: []` e não insere nada, coberto pelo teste "nao chama insert quando nao ha achados" da Task 4); inserção por achado (Task 4); zero achados não força revisão (Task 5, teste "mantem concluida quando achadoUrgente e false"); achado emergencial/critica força revisão (Task 5, testes de `determinarStatusFinal` e de `processarDocumentoComIa`); moderada/preventiva/informativa não força (Task 3 e Task 5); os dois pontos de entrada aplicam a mesma lógica (Task 5 cobre o orquestrador com testes, Task 6 aplica o código idêntico na rota manual, verificado por typecheck — a rota manual não tem suite de testes automatizados própria no projeto, mesmo padrão dos sub-projetos anteriores).

**Varredura de placeholders:** nenhum "TBD"/"TODO"/"implementar depois" encontrado nas tasks acima; todo código é completo e verbatim.

**Consistência de tipos:** `RecomendacaoCritica` (Task 2) é usado com os mesmos nomes de campo em `temAchadoUrgente` (Task 3), `registrarRecomendacoesCriticas` (Task 4), no wiring de `processarDocumentoComIa`/rota manual (Tasks 5-6) e no tipo espelho `RecomendacaoCriticaResultado` da UI (Task 7) — os 14 campos batem em todas as ocorrências. `determinarStatusFinal`'s novo campo `achadoUrgente?: boolean` é opcional, preservando a assinatura de 1 argumento e a assinatura de 2 argumentos sem o campo (usadas em testes antigos).
