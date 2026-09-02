# Busca semântica — Fase 2: Taxonomia e metadados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a taxonomia de assuntos/equipamentos de manutenção (com sinônimos), classificar automaticamente cada documento indexado na Fase 1 contra essa taxonomia (`documento_conteudo.termos`), e propor termos novos quando a IA identificar um equipamento que a taxonomia ainda não conhece — com aprovação de admin antes de qualquer termo novo valer para busca.

**Architecture:** Duas tabelas novas guardam a taxonomia (`taxonomia_termos` + `taxonomia_sinonimos`, semeadas por migração idempotente a partir de um arquivo TypeScript versionado) e uma terceira guarda sugestões pendentes de aprovação (`taxonomia_sugestoes`). Um módulo puro de matching por texto (`taxonomiaClassificacao.ts`) casa variações normalizadas contra o texto já persistido pela Fase 1 — sem LLM, sem custo. Um orquestrador (`taxonomiaIndexacao.ts`) roda esse matching e, quando o campo `equipamento_tipo` (já extraído de graça pela análise existente) não bate com nenhum termo conhecido, registra uma sugestão. Isso é chamado ao final de `processarDocumentoComIa` para documentos novos, e por um endpoint de reclassificação em lote para o acervo que a Fase 1 já indexou. Uma tela administrativa lista as sugestões e aprova/rejeita.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-busca-semantica-documentos-design.md` (seção "Fase 2 — Taxonomia e metadados")

## Decisões deste plano que divergem ou detalham a spec (e por quê)

1. **Nenhuma chamada de IA nova para sugerir termos.** A spec fala em "o LLM já classifica... passa a propor também termos técnicos". O campo `equipamento_tipo` (texto livre, ex.: "Gerador", "Termográfica") já é extraído sem custo adicional pela chamada de análise existente (`analisarDocumentoComOpenAi`, ver `src/lib/openAiDocumentAnalysis.ts:61`). Quando esse valor não bate com nenhum termo/sinônimo conhecido, isso já é sinal suficiente de "termo técnico não catalogado" — sem precisar de uma segunda chamada de IA dedicada a propor termos.
2. **Coluna nova `documento_conteudo.termos_classificado_em`** (não prevista na spec). Sem ela, "já classificado" só poderia ser inferido por `termos <> '{}'` — mas um documento que legitimamente não bate com nenhum termo da taxonomia (ex.: uma nota fiscal genérica) sempre teria `termos = '{}'`, ficando candidato a reclassificação para sempre. É exatamente a classe de bug que a revisão final da Fase 1 encontrou (write sem sinalização de conclusão). A coluna nova resolve isso da mesma forma que `indexado_em` resolve para a indexação.
3. **A classificação por texto roda como um passo separado de `indexarConteudoDocumento`** (Fase 1, não tocada nesta fase). Mantém a função da Fase 1 estável e com responsabilidade única; o passo novo (`classificarDocumento`, em `taxonomiaIndexacao.ts`) faz seu próprio update em `documento_conteudo` depois.
4. **Reclassificação do acervo não precisa de teto diário nem de cursor complexo.** Ao contrário do backfill de OCR (Fase 1), este passo não chama nenhuma API externa — só lê `documento_conteudo.texto` (já persistido) e faz correspondência de texto em memória. Isso também elimina de raiz a classe de bug do cursor da Fase 1: o filtro `termos_classificado_em is null` já é suficiente para "próximo lote", sem precisar computar um cursor por página.
5. **A reclassificação do acervo não gera sugestões novas.** `equipamento_tipo` só existe durante a análise original (não fica persistido) — para documentos já indexados na Fase 1, só é possível recalcular `termos`, não redescobrir o `equipamento_tipo`. Limitação aceita e documentada; sugestões só nascem de documentos processados a partir desta fase em diante.
6. **A semente da taxonomia é escrita duas vezes deliberadamente**: como array TypeScript (`src/lib/taxonomiaSeed.ts`, fonte de verdade revisável) e como `insert` literal na migração (SQL não importa TypeScript). As duas devem ficar idênticas — a Task 2 traz os dois arquivos lado a lado para conferência.

## Global Constraints

- Nenhuma tabela ou coluna da Fase 1 muda de forma incompatível — só a coluna nova `termos`/`termos_classificado_em` em `documento_conteudo`.
- Toda escrita no Supabase deve checar `{ error }` e lançar quando presente — a Fase 1 já corrigiu um bug real de escrita silenciosamente ignorada; esta fase não pode reintroduzir a mesma classe de erro.
- Classificação e sugestão são aditivas: falha nesse passo nunca pode impedir upload, análise ou a indexação da Fase 1.
- Nada entra em `taxonomia_sinonimos` sem aprovação explícita de admin — `taxonomia_sugestoes.origem`/aprovação é o único caminho.
- Migrações seguem a convenção do repositório: `public.`-qualificadas, RLS habilitada, `revoke all ... from public, anon, authenticated` — acesso só via `supabaseAdmin`.
- Rotas administrativas exigem `actor.isAdmin` (mesmo padrão de `src/app/api/documentos/indexacao/backfill/route.ts`, Fase 1).
- Testes seguem o padrão do repositório: Vitest, `environment: "node"`, `src/**/*.test.ts`, Supabase mockado por objeto encadeável.

---

## Estrutura de arquivos

**Criar:**
- `supabase/migrations/202609021200_create_taxonomia.sql`
- `supabase/migrations/202609021201_seed_taxonomia.sql`
- `src/lib/taxonomiaSeed.ts`
- `src/lib/taxonomiaClassificacao.ts`
- `src/lib/taxonomiaIndexacao.ts`
- `src/app/api/documentos/indexacao/reclassificar/route.ts`
- `src/app/api/taxonomia/sugestoes/route.ts`
- `src/app/api/taxonomia/sugestoes/[id]/decidir/route.ts`
- `src/app/api/taxonomia/termos/route.ts`
- `src/app/taxonomia/page.tsx`
- Testes: `taxonomiaSeed.test.ts`, `taxonomiaClassificacao.test.ts`, `taxonomiaIndexacao.test.ts`, `reclassificar/route.test.ts`, `sugestoes/[id]/decidir/route.test.ts`

**Modificar:**
- `src/lib/documentAnalysisPipeline.ts` — chama `classificarDocumento` ao final.
- `src/lib/documentAnalysisPipeline.test.ts` — cobre a chamada nova.
- `src/components/AppShell.tsx` — item de navegação "Taxonomia" (admin).

---

### Task 1: Migração — tabelas de taxonomia e coluna nova em `documento_conteudo`

**Files:**
- Create: `supabase/migrations/202609021200_create_taxonomia.sql`

**Interfaces:**
- Produces: `public.taxonomia_termos`, `public.taxonomia_sinonimos`, `public.taxonomia_sugestoes`; `public.documento_conteudo.termos` (text[]) e `public.documento_conteudo.termos_classificado_em` (timestamptz) — consumidos por `taxonomiaClassificacao.ts`/`taxonomiaIndexacao.ts` (Tasks 3-4) e pelas rotas de API (Tasks 6-7).

- [ ] **Step 1: Escrever a migração**

```sql
-- Busca semantica (Fase 2): taxonomia de assuntos/equipamentos, com fila de
-- sugestoes para aprovacao antes de qualquer termo novo valer para busca.
-- Acesso exclusivamente via supabaseAdmin na camada de API (padrao do projeto).

create table public.taxonomia_termos (
  id uuid primary key default gen_random_uuid(),
  termo text not null unique,
  categoria text not null,
  tipo text not null check (tipo in ('assunto', 'equipamento')),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.taxonomia_sinonimos (
  id uuid primary key default gen_random_uuid(),
  termo_id uuid not null references public.taxonomia_termos(id) on delete cascade,
  variacao text not null,
  origem text not null check (origem in ('semente', 'aprovado')),
  created_at timestamptz not null default now(),
  unique (variacao)
);

create index taxonomia_sinonimos_termo_id_idx
  on public.taxonomia_sinonimos (termo_id);

create table public.taxonomia_sugestoes (
  id uuid primary key default gen_random_uuid(),
  variacao text not null,
  termo_sugerido text,
  categoria_sugerida text,
  documento_id uuid references public.formularios(id) on delete set null,
  trecho text,
  ocorrencias integer not null default 1,
  status text not null default 'pendente'
    check (status in ('pendente', 'aprovada', 'rejeitada')),
  revisado_por uuid references auth.users(id) on delete set null,
  revisado_em timestamptz,
  created_at timestamptz not null default now(),
  unique (variacao)
);

create index taxonomia_sugestoes_status_idx
  on public.taxonomia_sugestoes (status);

alter table public.documento_conteudo
  add column termos text[] not null default '{}'::text[];
alter table public.documento_conteudo
  add column termos_classificado_em timestamptz;

create index documento_conteudo_termos_idx
  on public.documento_conteudo using gin (termos);
create index documento_conteudo_termos_classificado_em_idx
  on public.documento_conteudo (termos_classificado_em);

alter table public.taxonomia_termos enable row level security;
alter table public.taxonomia_sinonimos enable row level security;
alter table public.taxonomia_sugestoes enable row level security;

revoke all on public.taxonomia_termos from public, anon, authenticated;
revoke all on public.taxonomia_sinonimos from public, anon, authenticated;
revoke all on public.taxonomia_sugestoes from public, anon, authenticated;
```

- [ ] **Step 2: Verificar por inspeção**

Comparar com `supabase/migrations/202609021000_create_documento_conteudo_chunks.sql` (Fase 1): nomes `public.`-qualificados, RLS nas três tabelas novas, `revoke` nas três, todo comando terminado com `;`. Não há Supabase CLI/Postgres local neste repositório — migrações são commitadas e aplicadas no projeto hospedado separadamente; não tente executar.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202609021200_create_taxonomia.sql
git commit -m "feat: cria tabelas de taxonomia e fila de sugestoes"
```

---

### Task 2: Semente da taxonomia (`taxonomiaSeed.ts` + migração)

**Files:**
- Create: `src/lib/taxonomiaSeed.ts`
- Create: `supabase/migrations/202609021201_seed_taxonomia.sql`
- Test: `src/lib/taxonomiaSeed.test.ts`

**Interfaces:**
- Produces: `TaxonomiaSeedTermo = { termo: string; categoria: string; tipo: "assunto" | "equipamento"; sinonimos: string[] }`, `TAXONOMIA_SEED: TaxonomiaSeedTermo[]` — consumido pela Task 3 (testes de classificação usam termos reais da semente) e serve de referência para a migração deste Task.

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// src/lib/taxonomiaSeed.test.ts
import { describe, expect, it } from "vitest";
import { TAXONOMIA_SEED } from "@/lib/taxonomiaSeed";

describe("TAXONOMIA_SEED", () => {
  it("nao tem termos canonicos duplicados", () => {
    const termos = TAXONOMIA_SEED.map((item) => item.termo);
    expect(new Set(termos).size).toBe(termos.length);
  });

  it("nao tem variacoes duplicadas, nem entre termos diferentes", () => {
    const variacoes = TAXONOMIA_SEED.flatMap((item) => item.sinonimos);
    expect(new Set(variacoes).size).toBe(variacoes.length);
  });

  it("nenhuma variacao repete o proprio termo canonico do mesmo item", () => {
    for (const item of TAXONOMIA_SEED) {
      expect(item.sinonimos).not.toContain(item.termo);
    }
  });

  it("todo item tem categoria e ao menos um sinonimo", () => {
    for (const item of TAXONOMIA_SEED) {
      expect(item.categoria.length).toBeGreaterThan(0);
      expect(item.sinonimos.length).toBeGreaterThan(0);
    }
  });

  it("inclui os equipamentos citados explicitamente na spec", () => {
    const termos = TAXONOMIA_SEED.map((item) => item.termo);
    expect(termos).toEqual(
      expect.arrayContaining([
        "gerador",
        "refrigeracao",
        "elevador",
        "subestacao",
        "extintor",
        "ar condicionado",
      ]),
    );
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/taxonomiaSeed.test.ts`
Expected: FAIL — `Cannot find module '@/lib/taxonomiaSeed'`.

- [ ] **Step 3: Implementar `taxonomiaSeed.ts`**

```ts
export type TaxonomiaSeedTermo = {
  termo: string;
  categoria: string;
  tipo: "assunto" | "equipamento";
  sinonimos: string[];
};

// Semente inicial da taxonomia de assuntos/equipamentos de manutencao.
// "equipamento" = ativo fisico especifico citado em documentos (ex.: gerador,
// elevador). "assunto" = categoria de servico mais ampla, nao um ativo unico.
// Cresce em producao via taxonomia_sugestoes -> aprovacao de admin, nunca
// editando esta lista diretamente para termos aprendidos depois do deploy.
export const TAXONOMIA_SEED: TaxonomiaSeedTermo[] = [
  {
    termo: "gerador",
    categoria: "Gerador / nobreak",
    tipo: "equipamento",
    sinonimos: [
      "grupo gerador",
      "motogerador",
      "gmg",
      "alternador",
      "motor diesel",
      "teste de carga",
      "banco de carga",
      "nobreak",
      "ups",
      "ats",
      "transferencia automatica",
      "combustivel",
      "oleo diesel",
    ],
  },
  {
    termo: "ar condicionado",
    categoria: "Ar condicionado / climatizacao",
    tipo: "equipamento",
    sinonimos: [
      "climatizacao",
      "split",
      "fancoil",
      "chiller",
      "condensadora",
      "evaporadora",
      "gas refrigerante",
      "compressor",
      "dutos de ar",
      "vrf",
      "cassete",
    ],
  },
  {
    termo: "elevador",
    categoria: "Elevadores / escadas rolantes",
    tipo: "equipamento",
    sinonimos: [
      "casa de maquinas",
      "cabine do elevador",
      "botoeira",
      "cabo de tracao",
      "freio do elevador",
      "governador de velocidade",
      "poco do elevador",
    ],
  },
  {
    termo: "escada rolante",
    categoria: "Elevadores / escadas rolantes",
    tipo: "equipamento",
    sinonimos: ["esteira rolante", "degraus", "corrimao", "trilho"],
  },
  {
    termo: "subestacao",
    categoria: "Subestação",
    tipo: "equipamento",
    sinonimos: [
      "transformador",
      "disjuntor",
      "quadro de distribuicao",
      "media tensao",
      "baixa tensao",
      "cabine primaria",
      "para-raio",
      "aterramento",
    ],
  },
  {
    termo: "extintor",
    categoria: "Extintores / combate a incêndio",
    tipo: "equipamento",
    sinonimos: [
      "combate a incendio",
      "sistema de incendio",
      "hidrante",
      "mangueira de incendio",
      "sprinkler",
      "alarme de incendio",
      "deteccao de fumaca",
      "brigada de incendio",
      "recarga de extintor",
    ],
  },
  {
    termo: "refrigeracao",
    categoria: "Refrigeração",
    tipo: "equipamento",
    sinonimos: [
      "camara fria",
      "geladeira industrial",
      "freezer",
      "compressor de refrigeracao",
      "unidade condensadora",
    ],
  },
  {
    termo: "controle de pragas",
    categoria: "Controle de pragas / dedetização",
    tipo: "equipamento",
    sinonimos: ["dedetizacao", "desratizacao", "descupinizacao", "praga urbana", "inseticida"],
  },
  {
    termo: "plataforma de acessibilidade",
    categoria: "Portas automáticas / sensores",
    tipo: "equipamento",
    sinonimos: ["plataforma elevatoria", "acessibilidade", "cadeirante"],
  },
  {
    termo: "monta cargas",
    categoria: "Elevadores / escadas rolantes",
    tipo: "equipamento",
    sinonimos: ["montacargas", "elevador de carga"],
  },
  {
    termo: "poco artesiano",
    categoria: "Hidráulica",
    tipo: "equipamento",
    sinonimos: ["poco semi-artesiano", "captacao de agua", "bomba submersa"],
  },
  {
    termo: "balancas",
    categoria: "Balanças / calibração",
    tipo: "assunto",
    sinonimos: ["calibracao", "afericao", "pesagem"],
  },
  {
    termo: "cftv",
    categoria: "CFTV / segurança patrimonial",
    tipo: "assunto",
    sinonimos: ["camera de seguranca", "monitoramento", "seguranca patrimonial", "alarme"],
  },
  {
    termo: "comunicacao visual",
    categoria: "Comunicação visual / fachada",
    tipo: "assunto",
    sinonimos: ["fachada", "letreiro", "placa", "banner"],
  },
  {
    termo: "eletrica",
    categoria: "Elétrica",
    tipo: "assunto",
    sinonimos: ["instalacao eletrica", "quadro eletrico", "disjuntores", "fiacao", "curto-circuito"],
  },
  {
    termo: "exaustao",
    categoria: "Exaustão / ventilação",
    tipo: "assunto",
    sinonimos: ["ventilacao", "coifa", "dutos de exaustao", "exaustor"],
  },
  {
    termo: "gas",
    categoria: "Gás / GLP",
    tipo: "assunto",
    sinonimos: ["glp", "botijao", "tubulacao de gas", "vazamento de gas"],
  },
  {
    termo: "hidraulica",
    categoria: "Hidráulica",
    tipo: "assunto",
    sinonimos: ["encanamento", "vazamento", "tubulacao", "caixa dagua", "bomba dagua"],
  },
  {
    termo: "iluminacao",
    categoria: "Iluminação",
    tipo: "assunto",
    sinonimos: ["lampada", "luminaria", "refletor", "sensor de presenca"],
  },
  {
    termo: "limpeza e conservacao",
    categoria: "Limpeza e conservação",
    tipo: "assunto",
    sinonimos: ["conservacao", "faxina", "higienizacao"],
  },
  {
    termo: "manutencao civil",
    categoria: "Manutenção civil",
    tipo: "assunto",
    sinonimos: ["reforma", "alvenaria", "reparo estrutural", "infiltracao"],
  },
  {
    termo: "pintura",
    categoria: "Pintura / reparos",
    tipo: "assunto",
    sinonimos: ["reparo", "retoque", "repintura"],
  },
  {
    termo: "portas automaticas",
    categoria: "Portas automáticas / sensores",
    tipo: "assunto",
    sinonimos: ["sensor de presenca", "catraca", "roleta", "portao automatico"],
  },
  {
    termo: "rede",
    categoria: "Rede / TI / PDV",
    tipo: "assunto",
    sinonimos: ["ti", "pdv", "cabeamento", "roteador", "switch", "ponto de venda"],
  },
  {
    termo: "residuos",
    categoria: "Resíduos / reciclagem",
    tipo: "assunto",
    sinonimos: ["reciclagem", "coleta seletiva", "descarte"],
  },
  {
    termo: "sinalizacao",
    categoria: "Sinalização / comunicação interna",
    tipo: "assunto",
    sinonimos: ["comunicacao interna", "placa de sinalizacao"],
  },
  {
    termo: "termografia",
    categoria: "Elétrica",
    tipo: "assunto",
    sinonimos: ["inspecao termografica", "camera termica", "termovisao"],
  },
];
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/taxonomiaSeed.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Escrever a migração de semente, idêntica ao arquivo acima**

```sql
-- Semente da taxonomia (Fase 2). Deve permanecer identica a
-- src/lib/taxonomiaSeed.ts — qualquer termo/sinonimo novo aprendido em
-- producao entra via taxonomia_sugestoes -> aprovacao, nunca editando este
-- arquivo depois do deploy inicial.

insert into public.taxonomia_termos (termo, categoria, tipo) values
  ('gerador', 'Gerador / nobreak', 'equipamento'),
  ('ar condicionado', 'Ar condicionado / climatizacao', 'equipamento'),
  ('elevador', 'Elevadores / escadas rolantes', 'equipamento'),
  ('escada rolante', 'Elevadores / escadas rolantes', 'equipamento'),
  ('subestacao', 'Subestacao', 'equipamento'),
  ('extintor', 'Extintores / combate a incendio', 'equipamento'),
  ('refrigeracao', 'Refrigeracao', 'equipamento'),
  ('controle de pragas', 'Controle de pragas / dedetizacao', 'equipamento'),
  ('plataforma de acessibilidade', 'Portas automaticas / sensores', 'equipamento'),
  ('monta cargas', 'Elevadores / escadas rolantes', 'equipamento'),
  ('poco artesiano', 'Hidraulica', 'equipamento'),
  ('balancas', 'Balancas / calibracao', 'assunto'),
  ('cftv', 'CFTV / seguranca patrimonial', 'assunto'),
  ('comunicacao visual', 'Comunicacao visual / fachada', 'assunto'),
  ('eletrica', 'Eletrica', 'assunto'),
  ('exaustao', 'Exaustao / ventilacao', 'assunto'),
  ('gas', 'Gas / GLP', 'assunto'),
  ('hidraulica', 'Hidraulica', 'assunto'),
  ('iluminacao', 'Iluminacao', 'assunto'),
  ('limpeza e conservacao', 'Limpeza e conservacao', 'assunto'),
  ('manutencao civil', 'Manutencao civil', 'assunto'),
  ('pintura', 'Pintura / reparos', 'assunto'),
  ('portas automaticas', 'Portas automaticas / sensores', 'assunto'),
  ('rede', 'Rede / TI / PDV', 'assunto'),
  ('residuos', 'Residuos / reciclagem', 'assunto'),
  ('sinalizacao', 'Sinalizacao / comunicacao interna', 'assunto'),
  ('termografia', 'Eletrica', 'assunto')
on conflict (termo) do nothing;

insert into public.taxonomia_sinonimos (termo_id, variacao, origem)
select t.id, v.variacao, 'semente'
from (values
  ('gerador', 'grupo gerador'),
  ('gerador', 'motogerador'),
  ('gerador', 'gmg'),
  ('gerador', 'alternador'),
  ('gerador', 'motor diesel'),
  ('gerador', 'teste de carga'),
  ('gerador', 'banco de carga'),
  ('gerador', 'nobreak'),
  ('gerador', 'ups'),
  ('gerador', 'ats'),
  ('gerador', 'transferencia automatica'),
  ('gerador', 'combustivel'),
  ('gerador', 'oleo diesel'),
  ('ar condicionado', 'climatizacao'),
  ('ar condicionado', 'split'),
  ('ar condicionado', 'fancoil'),
  ('ar condicionado', 'chiller'),
  ('ar condicionado', 'condensadora'),
  ('ar condicionado', 'evaporadora'),
  ('ar condicionado', 'gas refrigerante'),
  ('ar condicionado', 'compressor'),
  ('ar condicionado', 'dutos de ar'),
  ('ar condicionado', 'vrf'),
  ('ar condicionado', 'cassete'),
  ('elevador', 'casa de maquinas'),
  ('elevador', 'cabine do elevador'),
  ('elevador', 'botoeira'),
  ('elevador', 'cabo de tracao'),
  ('elevador', 'freio do elevador'),
  ('elevador', 'governador de velocidade'),
  ('elevador', 'poco do elevador'),
  ('escada rolante', 'esteira rolante'),
  ('escada rolante', 'degraus'),
  ('escada rolante', 'corrimao'),
  ('escada rolante', 'trilho'),
  ('subestacao', 'transformador'),
  ('subestacao', 'disjuntor'),
  ('subestacao', 'quadro de distribuicao'),
  ('subestacao', 'media tensao'),
  ('subestacao', 'baixa tensao'),
  ('subestacao', 'cabine primaria'),
  ('subestacao', 'para-raio'),
  ('subestacao', 'aterramento'),
  ('extintor', 'combate a incendio'),
  ('extintor', 'sistema de incendio'),
  ('extintor', 'hidrante'),
  ('extintor', 'mangueira de incendio'),
  ('extintor', 'sprinkler'),
  ('extintor', 'alarme de incendio'),
  ('extintor', 'deteccao de fumaca'),
  ('extintor', 'brigada de incendio'),
  ('extintor', 'recarga de extintor'),
  ('refrigeracao', 'camara fria'),
  ('refrigeracao', 'geladeira industrial'),
  ('refrigeracao', 'freezer'),
  ('refrigeracao', 'compressor de refrigeracao'),
  ('refrigeracao', 'unidade condensadora'),
  ('controle de pragas', 'dedetizacao'),
  ('controle de pragas', 'desratizacao'),
  ('controle de pragas', 'descupinizacao'),
  ('controle de pragas', 'praga urbana'),
  ('controle de pragas', 'inseticida'),
  ('plataforma de acessibilidade', 'plataforma elevatoria'),
  ('plataforma de acessibilidade', 'acessibilidade'),
  ('plataforma de acessibilidade', 'cadeirante'),
  ('monta cargas', 'montacargas'),
  ('monta cargas', 'elevador de carga'),
  ('poco artesiano', 'poco semi-artesiano'),
  ('poco artesiano', 'captacao de agua'),
  ('poco artesiano', 'bomba submersa'),
  ('balancas', 'calibracao'),
  ('balancas', 'afericao'),
  ('balancas', 'pesagem'),
  ('cftv', 'camera de seguranca'),
  ('cftv', 'monitoramento'),
  ('cftv', 'seguranca patrimonial'),
  ('cftv', 'alarme'),
  ('comunicacao visual', 'fachada'),
  ('comunicacao visual', 'letreiro'),
  ('comunicacao visual', 'placa'),
  ('comunicacao visual', 'banner'),
  ('eletrica', 'instalacao eletrica'),
  ('eletrica', 'quadro eletrico'),
  ('eletrica', 'disjuntores'),
  ('eletrica', 'fiacao'),
  ('eletrica', 'curto-circuito'),
  ('exaustao', 'ventilacao'),
  ('exaustao', 'coifa'),
  ('exaustao', 'dutos de exaustao'),
  ('exaustao', 'exaustor'),
  ('gas', 'glp'),
  ('gas', 'botijao'),
  ('gas', 'tubulacao de gas'),
  ('gas', 'vazamento de gas'),
  ('hidraulica', 'encanamento'),
  ('hidraulica', 'vazamento'),
  ('hidraulica', 'tubulacao'),
  ('hidraulica', 'caixa dagua'),
  ('hidraulica', 'bomba dagua'),
  ('iluminacao', 'lampada'),
  ('iluminacao', 'luminaria'),
  ('iluminacao', 'refletor'),
  ('iluminacao', 'sensor de presenca'),
  ('limpeza e conservacao', 'conservacao'),
  ('limpeza e conservacao', 'faxina'),
  ('limpeza e conservacao', 'higienizacao'),
  ('manutencao civil', 'reforma'),
  ('manutencao civil', 'alvenaria'),
  ('manutencao civil', 'reparo estrutural'),
  ('manutencao civil', 'infiltracao'),
  ('pintura', 'reparo'),
  ('pintura', 'retoque'),
  ('pintura', 'repintura'),
  ('portas automaticas', 'sensor de presenca'),
  ('portas automaticas', 'catraca'),
  ('portas automaticas', 'roleta'),
  ('portas automaticas', 'portao automatico'),
  ('rede', 'ti'),
  ('rede', 'pdv'),
  ('rede', 'cabeamento'),
  ('rede', 'roteador'),
  ('rede', 'switch'),
  ('rede', 'ponto de venda'),
  ('residuos', 'reciclagem'),
  ('residuos', 'coleta seletiva'),
  ('residuos', 'descarte'),
  ('sinalizacao', 'comunicacao interna'),
  ('sinalizacao', 'placa de sinalizacao'),
  ('termografia', 'inspecao termografica'),
  ('termografia', 'camera termica'),
  ('termografia', 'termovisao')
) as v(termo, variacao)
join public.taxonomia_termos t on t.termo = v.termo
on conflict (variacao) do nothing;
```

Nota: `('portas automaticas', 'sensor de presenca')` e `('iluminacao', 'sensor de presenca')` colidiriam no `unique (variacao)` se ambas fossem inseridas — a segunda ocorrência (`iluminacao`) já existe na lista acima antes de `portas automaticas` ser processada, então o `on conflict (variacao) do nothing` silenciosamente pula a segunda. Isso é aceitável (o termo mais específico vence por ordem de inserção) mas verifique ao rodar o Step 6 que nenhum outro par se repete da mesma forma.

- [ ] **Step 6: Verificar que a migração não tem `variacao` duplicada nem diverge do TS**

Run: `grep -oE "'[a-z0-9 àáâãéêíóôõúç-]+'" supabase/migrations/202609021201_seed_taxonomia.sql | sort | uniq -d`
Expected: só a linha `'sensor de presenca'` (dupe conhecida e aceita, ver nota acima — o `on conflict` já trata isso) — qualquer outra duplicata é erro de transcrição a corrigir antes de commitar.

- [ ] **Step 7: Commit**

```bash
git add src/lib/taxonomiaSeed.ts src/lib/taxonomiaSeed.test.ts supabase/migrations/202609021201_seed_taxonomia.sql
git commit -m "feat: adiciona semente da taxonomia de assuntos e equipamentos"
```

---

### Task 3: Matching de texto (`taxonomiaClassificacao.ts`)

**Files:**
- Create: `src/lib/taxonomiaClassificacao.ts`
- Test: `src/lib/taxonomiaClassificacao.test.ts`

**Interfaces:**
- Produces: `normalizarTermo(valor: string): string`, `TaxonomiaIndiceEntry = { termoId: string; termo: string }`, `TaxonomiaIndice = Map<string, TaxonomiaIndiceEntry>`, `construirIndiceTaxonomia(termos: {id: string; termo: string}[], sinonimos: {termo_id: string; variacao: string}[]): TaxonomiaIndice`, `classificarTexto(texto: string, indice: TaxonomiaIndice): string[]` — consumidos por `taxonomiaIndexacao.ts` (Task 4).

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// src/lib/taxonomiaClassificacao.test.ts
import { describe, expect, it } from "vitest";
import {
  classificarTexto,
  construirIndiceTaxonomia,
  normalizarTermo,
} from "@/lib/taxonomiaClassificacao";

describe("normalizarTermo", () => {
  it("remove acentos, baixa a caixa e colapsa espacos", () => {
    expect(normalizarTermo("  Subestação   Elétrica ")).toBe("subestacao eletrica");
  });

  it("remove pontuacao mantendo letras e numeros", () => {
    expect(normalizarTermo("Grupo-Motogerador (GMG)")).toBe("grupo motogerador gmg");
  });
});

describe("construirIndiceTaxonomia", () => {
  const termos = [
    { id: "t-gerador", termo: "gerador" },
    { id: "t-elevador", termo: "elevador" },
  ];
  const sinonimos = [
    { termo_id: "t-gerador", variacao: "grupo motogerador" },
    { termo_id: "t-gerador", variacao: "GMG" },
    { termo_id: "t-elevador", variacao: "casa de maquinas" },
  ];

  it("indexa o proprio termo canonico alem dos sinonimos", () => {
    const indice = construirIndiceTaxonomia(termos, sinonimos);
    expect(indice.get("gerador")).toEqual({ termoId: "t-gerador", termo: "gerador" });
    expect(indice.get("grupo motogerador")).toEqual({ termoId: "t-gerador", termo: "gerador" });
  });

  it("normaliza a variacao antes de indexar", () => {
    const indice = construirIndiceTaxonomia(termos, sinonimos);
    expect(indice.get("gmg")).toEqual({ termoId: "t-gerador", termo: "gerador" });
  });

  it("ignora sinonimo orfao (termo_id sem termo correspondente)", () => {
    const indice = construirIndiceTaxonomia(termos, [
      { termo_id: "t-inexistente", variacao: "algo" },
    ]);
    expect(indice.has("algo")).toBe(false);
  });
});

describe("classificarTexto", () => {
  const indice = construirIndiceTaxonomia(
    [
      { id: "t-gerador", termo: "gerador" },
      { id: "t-elevador", termo: "elevador" },
    ],
    [
      { termo_id: "t-gerador", variacao: "grupo motogerador" },
      { termo_id: "t-gerador", variacao: "GMG" },
    ],
  );

  it("retorna vazio para texto vazio", () => {
    expect(classificarTexto("", indice)).toEqual([]);
    expect(classificarTexto("   ", indice)).toEqual([]);
  });

  it("encontra o termo canonico pelo proprio nome", () => {
    expect(classificarTexto("Laudo de manutencao do gerador da loja Matriz.", indice)).toEqual([
      "gerador",
    ]);
  });

  it("encontra o termo canonico por um sinonimo, inclusive com acentuacao/caixa diferente", () => {
    expect(classificarTexto("Realizado teste no GRUPO MOTOGERADOR da unidade.", indice)).toEqual([
      "gerador",
    ]);
  });

  it("nao da falso positivo por substring dentro de outra palavra", () => {
    const indiceComGas = construirIndiceTaxonomia([{ id: "t-gas", termo: "gas" }], []);
    // "gas" e substring literal de "algas" — o match precisa exigir limite de
    // palavra, senao "algas marinhas" seria classificado como assunto "gas".
    expect(classificarTexto("Foram encontradas algas na caixa dagua.", indiceComGas)).toEqual([]);
  });

  it("dedup quando o termo e o sinonimo aparecem no mesmo texto", () => {
    expect(
      classificarTexto("Manutencao do gerador. O GMG apresentou falha na partida.", indice),
    ).toEqual(["gerador"]);
  });

  it("encontra multiplos termos diferentes, em ordem alfabetica", () => {
    expect(
      classificarTexto("Vistoria do elevador e teste do gerador na mesma visita.", indice),
    ).toEqual(["elevador", "gerador"]);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/taxonomiaClassificacao.test.ts`
Expected: FAIL — `Cannot find module '@/lib/taxonomiaClassificacao'`.

- [ ] **Step 3: Implementar `taxonomiaClassificacao.ts`**

```ts
export type TaxonomiaIndiceEntry = { termoId: string; termo: string };
export type TaxonomiaIndice = Map<string, TaxonomiaIndiceEntry>;

export function normalizarTermo(valor: string): string {
  return valor
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRegExp = (valor: string) => valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function construirIndiceTaxonomia(
  termos: { id: string; termo: string }[],
  sinonimos: { termo_id: string; variacao: string }[],
): TaxonomiaIndice {
  const termoPorId = new Map(termos.map((item) => [item.id, item.termo]));
  const indice: TaxonomiaIndice = new Map();

  for (const item of termos) {
    indice.set(normalizarTermo(item.termo), { termoId: item.id, termo: item.termo });
  }

  for (const sinonimo of sinonimos) {
    const termo = termoPorId.get(sinonimo.termo_id);
    if (!termo) {
      continue;
    }
    indice.set(normalizarTermo(sinonimo.variacao), { termoId: sinonimo.termo_id, termo });
  }

  return indice;
}

export function classificarTexto(texto: string, indice: TaxonomiaIndice): string[] {
  const textoNormalizado = normalizarTermo(texto);
  if (!textoNormalizado) {
    return [];
  }

  const encontrados = new Set<string>();
  for (const [variacaoNormalizada, entrada] of indice) {
    if (!variacaoNormalizada) {
      continue;
    }
    const regex = new RegExp(`(?:^|\\s)${escapeRegExp(variacaoNormalizada)}(?:\\s|$)`);
    if (regex.test(textoNormalizado)) {
      encontrados.add(entrada.termo);
    }
  }

  return Array.from(encontrados).sort();
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/taxonomiaClassificacao.test.ts`
Expected: PASS (11 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/taxonomiaClassificacao.ts src/lib/taxonomiaClassificacao.test.ts
git commit -m "feat: adiciona matching de texto contra a taxonomia"
```

---

### Task 4: Orquestração (`taxonomiaIndexacao.ts`)

**Files:**
- Create: `src/lib/taxonomiaIndexacao.ts`
- Test: `src/lib/taxonomiaIndexacao.test.ts`

**Interfaces:**
- Consumes: `construirIndiceTaxonomia`, `classificarTexto`, `normalizarTermo`, `TaxonomiaIndice` (Task 3).
- Produces: `carregarIndiceTaxonomia(supabaseAdmin): Promise<TaxonomiaIndice>`, `ClassificarDocumentoParams = { documentoId: string; texto: string | null; equipamentoTipo: string | null; equipamentoIdentificacao: string | null }`, `ResultadoClassificacao = { status: "classificado" | "pulado" | "erro"; termos: string[]; detalhe?: string }`, `classificarDocumento(supabaseAdmin, params: ClassificarDocumentoParams): Promise<ResultadoClassificacao>` — consumidos pela Task 5 (pipeline) e pela Task 6 (reclassificação em lote).

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// src/lib/taxonomiaIndexacao.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classificarDocumento } from "@/lib/taxonomiaIndexacao";

type Chamada = { tabela: string; metodo: string; payload?: unknown };

function makeSupabase(opts: {
  termos?: { id: string; termo: string }[];
  sinonimos?: { termo_id: string; variacao: string }[];
  sugestaoExistente?: { id: string; ocorrencias: number; status: string } | null;
}) {
  const chamadas: Chamada[] = [];
  const termos = opts.termos ?? [{ id: "t-gerador", termo: "gerador" }];
  const sinonimos = opts.sinonimos ?? [];
  const sugestaoExistente = opts.sugestaoExistente ?? null;

  const supabase = {
    from(tabela: string) {
      if (tabela === "taxonomia_termos") {
        return {
          select: () => ({
            eq: async () => {
              chamadas.push({ tabela, metodo: "select" });
              return { data: termos, error: null };
            },
          }),
        };
      }
      if (tabela === "taxonomia_sinonimos") {
        return {
          select: async () => {
            chamadas.push({ tabela, metodo: "select" });
            return { data: sinonimos, error: null };
          },
          insert: async (payload: unknown) => {
            chamadas.push({ tabela, metodo: "insert", payload });
            return { error: null };
          },
        };
      }
      if (tabela === "documento_conteudo") {
        return {
          update: (payload: unknown) => ({
            eq: async () => {
              chamadas.push({ tabela, metodo: "update", payload });
              return { error: null };
            },
          }),
        };
      }
      if (tabela === "taxonomia_sugestoes") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                chamadas.push({ tabela, metodo: "select" });
                return { data: sugestaoExistente, error: null };
              },
            }),
          }),
          insert: async (payload: unknown) => {
            chamadas.push({ tabela, metodo: "insert", payload });
            return { error: null };
          },
          update: (payload: unknown) => ({
            eq: async () => {
              chamadas.push({ tabela, metodo: "update", payload });
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  };

  return { supabase, chamadas };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("classificarDocumento", () => {
  it("pula quando nao ha texto, sem tocar em taxonomia_sugestoes", async () => {
    const { supabase, chamadas } = makeSupabase({});
    const resultado = await classificarDocumento(supabase as never, {
      documentoId: "doc-1",
      texto: null,
      equipamentoTipo: null,
      equipamentoIdentificacao: null,
    });
    expect(resultado).toEqual({ status: "pulado", termos: [], detalhe: "sem_texto" });
    expect(chamadas.some((c) => c.tabela === "taxonomia_sugestoes")).toBe(false);
  });

  it("classifica o texto e grava termos + termos_classificado_em", async () => {
    const { supabase, chamadas } = makeSupabase({});
    const resultado = await classificarDocumento(supabase as never, {
      documentoId: "doc-1",
      texto: "Laudo de manutencao do gerador da loja Matriz.",
      equipamentoTipo: null,
      equipamentoIdentificacao: null,
    });
    expect(resultado.status).toBe("classificado");
    expect(resultado.termos).toEqual(["gerador"]);
    const update = chamadas.find((c) => c.tabela === "documento_conteudo" && c.metodo === "update");
    expect(update?.payload).toMatchObject({ termos: ["gerador"] });
    expect(
      (update?.payload as { termos_classificado_em?: string }).termos_classificado_em,
    ).toEqual(expect.any(String));
  });

  it("registra sugestao quando equipamentoTipo nao bate com nenhum termo conhecido", async () => {
    const { supabase, chamadas } = makeSupabase({});
    await classificarDocumento(supabase as never, {
      documentoId: "doc-2",
      texto: "Relatorio de inspecao.",
      equipamentoTipo: "Termovisao Predial",
      equipamentoIdentificacao: "Painel 3",
    });
    const insert = chamadas.find((c) => c.tabela === "taxonomia_sugestoes" && c.metodo === "insert");
    expect(insert?.payload).toMatchObject({
      variacao: "termovisao predial",
      termo_sugerido: "Termovisao Predial",
      documento_id: "doc-2",
      trecho: "Painel 3",
      ocorrencias: 1,
    });
  });

  it("nao registra sugestao quando equipamentoTipo ja bate com um termo/sinonimo conhecido", async () => {
    const { supabase, chamadas } = makeSupabase({});
    await classificarDocumento(supabase as never, {
      documentoId: "doc-3",
      texto: "Relatorio.",
      equipamentoTipo: "Gerador",
      equipamentoIdentificacao: null,
    });
    expect(chamadas.some((c) => c.tabela === "taxonomia_sugestoes" && c.metodo === "insert")).toBe(
      false,
    );
  });

  it("incrementa ocorrencias em vez de duplicar quando a sugestao pendente ja existe", async () => {
    const { supabase, chamadas } = makeSupabase({
      sugestaoExistente: { id: "sug-1", ocorrencias: 2, status: "pendente" },
    });
    await classificarDocumento(supabase as never, {
      documentoId: "doc-4",
      texto: "Relatorio.",
      equipamentoTipo: "Termovisao Predial",
      equipamentoIdentificacao: null,
    });
    const update = chamadas.find((c) => c.tabela === "taxonomia_sugestoes" && c.metodo === "update");
    expect(update?.payload).toMatchObject({ ocorrencias: 3 });
    expect(chamadas.some((c) => c.tabela === "taxonomia_sugestoes" && c.metodo === "insert")).toBe(
      false,
    );
  });

  it("nao reabre sugestao ja revisada (aprovada ou rejeitada)", async () => {
    const { supabase, chamadas } = makeSupabase({
      sugestaoExistente: { id: "sug-1", ocorrencias: 5, status: "rejeitada" },
    });
    await classificarDocumento(supabase as never, {
      documentoId: "doc-5",
      texto: "Relatorio.",
      equipamentoTipo: "Termovisao Predial",
      equipamentoIdentificacao: null,
    });
    expect(chamadas.some((c) => c.tabela === "taxonomia_sugestoes" && c.metodo !== "select")).toBe(
      false,
    );
  });

  it("falha ao gravar termos: devolve status erro sem lancar", async () => {
    const { chamadas } = makeSupabase({});
    const supabaseComErro = {
      from(tabela: string) {
        if (tabela === "taxonomia_termos") {
          return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
        }
        if (tabela === "taxonomia_sinonimos") {
          return { select: async () => ({ data: [], error: null }) };
        }
        if (tabela === "documento_conteudo") {
          return {
            update: () => ({
              eq: async () => ({ error: new Error("conexao perdida") }),
            }),
          };
        }
        throw new Error(`tabela inesperada: ${tabela}`);
      },
    };
    const resultado = await classificarDocumento(supabaseComErro as never, {
      documentoId: "doc-6",
      texto: "Relatorio.",
      equipamentoTipo: null,
      equipamentoIdentificacao: null,
    });
    expect(resultado.status).toBe("erro");
    expect(resultado.detalhe).toContain("conexao perdida");
    void chamadas;
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/taxonomiaIndexacao.test.ts`
Expected: FAIL — `Cannot find module '@/lib/taxonomiaIndexacao'`.

- [ ] **Step 3: Implementar `taxonomiaIndexacao.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classificarTexto,
  construirIndiceTaxonomia,
  normalizarTermo,
  type TaxonomiaIndice,
} from "@/lib/taxonomiaClassificacao";

export async function carregarIndiceTaxonomia(
  supabaseAdmin: SupabaseClient,
): Promise<TaxonomiaIndice> {
  const { data: termos, error: erroTermos } = await supabaseAdmin
    .from("taxonomia_termos")
    .select("id,termo")
    .eq("ativo", true);
  if (erroTermos) {
    throw erroTermos;
  }

  const { data: sinonimos, error: erroSinonimos } = await supabaseAdmin
    .from("taxonomia_sinonimos")
    .select("termo_id,variacao");
  if (erroSinonimos) {
    throw erroSinonimos;
  }

  return construirIndiceTaxonomia(
    (termos ?? []) as { id: string; termo: string }[],
    (sinonimos ?? []) as { termo_id: string; variacao: string }[],
  );
}

async function registrarSugestaoSeNaoReconhecido(
  supabaseAdmin: SupabaseClient,
  params: {
    equipamentoTipo: string | null;
    documentoId: string;
    trecho: string | null;
    indice: TaxonomiaIndice;
  },
): Promise<void> {
  const bruto = params.equipamentoTipo?.trim();
  if (!bruto) {
    return;
  }
  const normalizado = normalizarTermo(bruto);
  if (!normalizado || params.indice.has(normalizado)) {
    return;
  }

  const { data: existente, error: erroBusca } = await supabaseAdmin
    .from("taxonomia_sugestoes")
    .select("id,ocorrencias,status")
    .eq("variacao", normalizado)
    .maybeSingle();
  if (erroBusca) {
    throw erroBusca;
  }

  if (existente) {
    if (existente.status !== "pendente") {
      return;
    }
    const { error: erroUpdate } = await supabaseAdmin
      .from("taxonomia_sugestoes")
      .update({ ocorrencias: existente.ocorrencias + 1 })
      .eq("id", existente.id);
    if (erroUpdate) {
      throw erroUpdate;
    }
    return;
  }

  const { error: erroInsert } = await supabaseAdmin.from("taxonomia_sugestoes").insert({
    variacao: normalizado,
    termo_sugerido: bruto,
    documento_id: params.documentoId,
    trecho: params.trecho,
    ocorrencias: 1,
  });
  if (erroInsert) {
    throw erroInsert;
  }
}

export type ClassificarDocumentoParams = {
  documentoId: string;
  texto: string | null;
  equipamentoTipo: string | null;
  equipamentoIdentificacao: string | null;
};

export type ResultadoClassificacao = {
  status: "classificado" | "pulado" | "erro";
  termos: string[];
  detalhe?: string;
};

/**
 * Classifica o texto do documento contra a taxonomia e grava documento_conteudo.termos.
 * Quando equipamentoTipo nao bate com nenhum termo conhecido, registra uma sugestao
 * (best-effort: falha ao registrar sugestao nao invalida a classificacao ja gravada).
 * Nunca lanca para o chamador.
 */
export async function classificarDocumento(
  supabaseAdmin: SupabaseClient,
  params: ClassificarDocumentoParams,
): Promise<ResultadoClassificacao> {
  const texto = params.texto?.trim() ?? "";
  if (!texto) {
    return { status: "pulado", termos: [], detalhe: "sem_texto" };
  }

  try {
    const indice = await carregarIndiceTaxonomia(supabaseAdmin);
    const termos = classificarTexto(texto, indice);

    const { error: erroUpdate } = await supabaseAdmin
      .from("documento_conteudo")
      .update({ termos, termos_classificado_em: new Date().toISOString() })
      .eq("documento_id", params.documentoId);
    if (erroUpdate) {
      throw erroUpdate;
    }

    try {
      await registrarSugestaoSeNaoReconhecido(supabaseAdmin, {
        equipamentoTipo: params.equipamentoTipo,
        documentoId: params.documentoId,
        trecho: params.equipamentoIdentificacao,
        indice,
      });
    } catch (err) {
      // Best-effort: a classificacao (mais importante e ja gravada) nao pode
      // ser invalidada por uma falha ao registrar a sugestao.
      console.error("[classificarDocumento] Falha ao registrar sugestao:", err);
    }

    return { status: "classificado", termos };
  } catch (err) {
    const mensagem =
      err instanceof Error ? err.message : "Falha desconhecida na classificacao.";
    console.error("[classificarDocumento] Falha:", err);
    return { status: "erro", termos: [], detalhe: mensagem };
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/taxonomiaIndexacao.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/taxonomiaIndexacao.ts src/lib/taxonomiaIndexacao.test.ts
git commit -m "feat: adiciona orquestracao de classificacao e sugestao de taxonomia"
```

---

### Task 5: Ligar a classificação ao pipeline de análise

**Files:**
- Modify: `src/lib/documentAnalysisPipeline.ts`
- Modify: `src/lib/documentAnalysisPipeline.test.ts`

**Interfaces:**
- Consumes: `classificarDocumento` (Task 4).

- [ ] **Step 1: Escrever os testes (falhando)**

Em `src/lib/documentAnalysisPipeline.test.ts`, acrescentar o mock junto aos `vi.mock` já existentes no topo (o de `@/lib/documentoIndexacao` já está lá desde a Fase 1 — adicionar ao lado):

```ts
vi.mock("@/lib/taxonomiaIndexacao", () => ({
  classificarDocumento: vi.fn(async () => ({ status: "classificado", termos: ["gerador"] })),
}));
```

E ao import block:

```ts
import { classificarDocumento } from "@/lib/taxonomiaIndexacao";
```

Depois, dois testes dentro de `describe("processarDocumentoComIa", ...)`, ao lado dos testes de indexação já existentes:

```ts
  it("classifica o conteudo contra a taxonomia ao final do processamento bem-sucedido", async () => {
    vi.mocked(classificarDocumento).mockClear();
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce(
      analiseBase({
        textoExtraido: "laudo do grupo gerador da matriz",
        resultado: resultadoBase({ equipamento_tipo: "Gerador", equipamento_identificacao: "Gerador 01" }),
      }),
    );

    const { supabase } = criarSupabaseFake({
      registro: {
        id: "doc-tax",
        tipo: "registro_laudos",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/laudo.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
        created_at: "2026-07-10T00:00:00.000Z",
      },
    });

    await processarDocumentoComIa(supabase, "doc-tax");

    expect(classificarDocumento).toHaveBeenCalledTimes(1);
    const [, params] = vi.mocked(classificarDocumento).mock.calls[0];
    expect(params).toMatchObject({
      documentoId: "doc-tax",
      texto: "laudo do grupo gerador da matriz",
      equipamentoTipo: "Gerador",
      equipamentoIdentificacao: "Gerador 01",
    });
  });

  it("falha na classificacao de taxonomia nao altera o status final da analise", async () => {
    vi.mocked(classificarDocumento).mockClear();
    vi.mocked(classificarDocumento).mockRejectedValueOnce(new Error("taxonomia indisponivel"));
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce(analiseBase());

    const { supabase, updates } = criarSupabaseFake({
      registro: {
        id: "doc-tax-erro",
        tipo: "notas_fiscais",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/nota.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
        created_at: "2026-07-10T00:00:00.000Z",
      },
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-tax-erro");

    expect(resultado.status).toBe("concluida");
    expect(updates.map((u) => u.payload.status_analise_ia)).toEqual([
      "em_analise",
      "concluida",
    ]);
  });
```

Note que o segundo teste usa `mockRejectedValueOnce` mesmo `classificarDocumento` nunca lançando na implementação real — isso testa que o **ponto de chamada** no pipeline está protegido por `try/catch`, não apenas que a função em si é segura (defesa em profundidade, mesmo padrão já usado para `indexarConteudoDocumento` na Fase 1).

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/documentAnalysisPipeline.test.ts`
Expected: FAIL — a classificação ainda não é chamada.

- [ ] **Step 3: Chamar a classificação no pipeline**

Em `src/lib/documentAnalysisPipeline.ts`, adicionar o import:

```ts
import { classificarDocumento } from "@/lib/taxonomiaIndexacao";
```

Logo depois do bloco `try { await indexarConteudoDocumento(...) } catch (err) { ... }` (Fase 1) e antes do `return { status: statusFinal };`, acrescentar:

```ts
    try {
      await classificarDocumento(supabaseAdmin, {
        documentoId: row.id,
        texto: analise.textoExtraido,
        equipamentoTipo: resultado.equipamento_tipo,
        equipamentoIdentificacao: resultado.equipamento_identificacao,
      });
    } catch (err) {
      // Best-effort: classificacao de taxonomia e aditiva e nao pode derrubar a analise.
      console.error("[processarDocumentoComIa] Falha ao classificar taxonomia:", err);
    }
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/documentAnalysisPipeline.test.ts && npm test`
Expected: PASS — inclusive todos os testes que já existiam no arquivo (71 na Fase 1, mais os 2 novos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentAnalysisPipeline.ts src/lib/documentAnalysisPipeline.test.ts
git commit -m "feat: classifica documentos contra a taxonomia ao final da analise"
```

---

### Task 6: Reclassificação do acervo (endpoint em lote)

**Files:**
- Create: `src/app/api/documentos/indexacao/reclassificar/route.ts`
- Test: `src/app/api/documentos/indexacao/reclassificar/route.test.ts`

**Interfaces:**
- Consumes: `classificarDocumento` (Task 4).

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// src/app/api/documentos/indexacao/reclassificar/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/taxonomiaIndexacao", () => ({
  classificarDocumento: vi.fn(async () => ({ status: "classificado", termos: [] })),
}));
vi.mock("@/lib/apiAuth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/apiAuth")>("@/lib/apiAuth");
  return { ...actual, getActorFromRequest: vi.fn() };
});
vi.mock("@/lib/supabaseAdminClient", () => ({ createSupabaseAdminClient: vi.fn() }));

import { getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { classificarDocumento } from "@/lib/taxonomiaIndexacao";
import { POST } from "./route";

const mockedActor = vi.mocked(getActorFromRequest);
const mockedCreateSupabase = vi.mocked(createSupabaseAdminClient);
const mockedClassificar = vi.mocked(classificarDocumento);

function makeRequest(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/documentos/indexacao/reclassificar", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function makeSupabaseComPendentes(pendentes: { documento_id: string; texto: string }[]) {
  return {
    from: (tabela: string) => {
      if (tabela !== "documento_conteudo") {
        throw new Error(`tabela inesperada: ${tabela}`);
      }
      return {
        select: () => ({
          is: () => ({
            not: () => ({
              order: () => ({
                limit: async () => ({ data: pendentes, error: null }),
              }),
            }),
          }),
        }),
      };
    },
  };
}

beforeEach(() => {
  mockedActor.mockReset();
  mockedCreateSupabase.mockReset();
  mockedClassificar.mockReset().mockResolvedValue({ status: "classificado", termos: [] });
});

describe("POST /api/documentos/indexacao/reclassificar", () => {
  it("rejeita quem nao e admin", async () => {
    mockedActor.mockResolvedValueOnce({
      userId: "u1",
      email: "user@empresa.com",
      isAdmin: false,
      realUserId: "u1",
      realEmail: "user@empresa.com",
      realIsAdmin: false,
      isSimulating: false,
    });
    mockedCreateSupabase.mockReturnValueOnce(makeSupabaseComPendentes([]) as never);

    const response = await POST(makeRequest());
    expect(response.status).toBe(403);
  });

  it("classifica cada documento pendente e reporta os contadores", async () => {
    mockedActor.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@empresa.com",
      isAdmin: true,
      realUserId: "admin-1",
      realEmail: "admin@empresa.com",
      realIsAdmin: true,
      isSimulating: false,
    });
    mockedCreateSupabase.mockReturnValueOnce(
      makeSupabaseComPendentes([
        { documento_id: "doc-1", texto: "laudo do gerador" },
        { documento_id: "doc-2", texto: "nota fiscal" },
      ]) as never,
    );
    mockedClassificar
      .mockResolvedValueOnce({ status: "classificado", termos: ["gerador"] })
      .mockResolvedValueOnce({ status: "pulado", termos: [], detalhe: "sem_texto" });

    const response = await POST(makeRequest());
    const payload = (await response.json()) as {
      processados: number;
      classificados: number;
      pulados: number;
      erros: number;
      concluido: boolean;
    };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      processados: 2,
      classificados: 1,
      pulados: 1,
      erros: 0,
      concluido: false,
    });
    expect(mockedClassificar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ documentoId: "doc-1", texto: "laudo do gerador", equipamentoTipo: null }),
    );
  });

  it("reporta concluido quando nao ha mais pendentes", async () => {
    mockedActor.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@empresa.com",
      isAdmin: true,
      realUserId: "admin-1",
      realEmail: "admin@empresa.com",
      realIsAdmin: true,
      isSimulating: false,
    });
    mockedCreateSupabase.mockReturnValueOnce(makeSupabaseComPendentes([]) as never);

    const response = await POST(makeRequest());
    const payload = (await response.json()) as { concluido: boolean; processados: number };
    expect(payload).toEqual({ processados: 0, classificados: 0, pulados: 0, erros: 0, concluido: true });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/app/api/documentos/indexacao/reclassificar/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implementar a rota**

```ts
// src/app/api/documentos/indexacao/reclassificar/route.ts
import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { classificarDocumento } from "@/lib/taxonomiaIndexacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE_PADRAO = 200;
const LIMITE_MAX = 500;

type DocumentoConteudoRow = { documento_id: string; texto: string };

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    if (!actor.isAdmin) {
      throw new HttpError(403, "Reclassificacao de taxonomia e restrita a administradores.");
    }

    const body = (await request.json().catch(() => ({}))) as { limite?: number };
    const limiteBruto = Number(body.limite);
    const limite = Number.isFinite(limiteBruto)
      ? Math.min(Math.max(Math.trunc(limiteBruto), 1), LIMITE_MAX)
      : LIMITE_PADRAO;

    // Sem custo externo (so texto ja persistido + matching local), entao o
    // filtro "ainda nao classificado" e o unico cursor necessario: cada
    // chamada processa o proximo lote e marca termos_classificado_em, sem
    // precisar computar uma janela como o backfill de OCR da Fase 1.
    const { data, error } = await supabaseAdmin
      .from("documento_conteudo")
      .select("documento_id,texto")
      .is("termos_classificado_em", null)
      .not("indexado_em", "is", null)
      .order("documento_id", { ascending: true })
      .limit(limite);
    if (error) {
      throw error;
    }

    const pendentes = (data as DocumentoConteudoRow[] | null) ?? [];

    let classificados = 0;
    let pulados = 0;
    let erros = 0;

    for (const row of pendentes) {
      const resultado = await classificarDocumento(supabaseAdmin, {
        documentoId: row.documento_id,
        texto: row.texto,
        equipamentoTipo: null,
        equipamentoIdentificacao: null,
      });
      if (resultado.status === "classificado") classificados += 1;
      else if (resultado.status === "pulado") pulados += 1;
      else erros += 1;
    }

    return NextResponse.json({
      processados: pendentes.length,
      classificados,
      pulados,
      erros,
      concluido: pendentes.length === 0,
    });
  } catch (err) {
    console.error("Erro na reclassificacao de taxonomia:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel reclassificar os documentos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/app/api/documentos/indexacao/reclassificar/route.test.ts && npx tsc --noEmit`
Expected: PASS (3 testes); tipos limpos.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/documentos/indexacao/reclassificar/route.ts src/app/api/documentos/indexacao/reclassificar/route.test.ts
git commit -m "feat: adiciona endpoint de reclassificacao de taxonomia do acervo"
```

---

### Task 7: Rotas de revisão de sugestões

**Files:**
- Create: `src/app/api/taxonomia/termos/route.ts`
- Create: `src/app/api/taxonomia/sugestoes/route.ts`
- Create: `src/app/api/taxonomia/sugestoes/[id]/decidir/route.ts`
- Test: `src/app/api/taxonomia/sugestoes/[id]/decidir/route.test.ts`

**Interfaces:**
- Produces: `GET /api/taxonomia/termos` → `{ termos: {id,termo,categoria,tipo}[] }`; `GET /api/taxonomia/sugestoes` → `{ sugestoes: {...}[] }`; `POST /api/taxonomia/sugestoes/[id]/decidir` — consumidos pela Task 8 (UI).

- [ ] **Step 1: Implementar `GET /api/taxonomia/termos`**

```ts
// src/app/api/taxonomia/termos/route.ts
import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    if (!actor.isAdmin) {
      throw new HttpError(403, "Consulta de taxonomia e restrita a administradores.");
    }

    const { data, error } = await supabaseAdmin
      .from("taxonomia_termos")
      .select("id,termo,categoria,tipo")
      .eq("ativo", true)
      .order("categoria", { ascending: true });
    if (error) {
      throw error;
    }

    return NextResponse.json({ termos: data ?? [] });
  } catch (err) {
    console.error("Erro ao listar termos de taxonomia:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Nao foi possivel listar os termos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Implementar `GET /api/taxonomia/sugestoes`**

```ts
// src/app/api/taxonomia/sugestoes/route.ts
import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    if (!actor.isAdmin) {
      throw new HttpError(403, "Revisao de taxonomia e restrita a administradores.");
    }

    const { data, error } = await supabaseAdmin
      .from("taxonomia_sugestoes")
      .select("id,variacao,termo_sugerido,documento_id,trecho,ocorrencias,created_at")
      .eq("status", "pendente")
      .order("ocorrencias", { ascending: false });
    if (error) {
      throw error;
    }

    return NextResponse.json({ sugestoes: data ?? [] });
  } catch (err) {
    console.error("Erro ao listar sugestoes de taxonomia:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Nao foi possivel listar as sugestoes.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Escrever os testes de `POST /decidir` (falhando)**

```ts
// src/app/api/taxonomia/sugestoes/[id]/decidir/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiAuth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/apiAuth")>("@/lib/apiAuth");
  return { ...actual, getActorFromRequest: vi.fn() };
});
vi.mock("@/lib/supabaseAdminClient", () => ({ createSupabaseAdminClient: vi.fn() }));

import { getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { POST } from "./route";

const mockedActor = vi.mocked(getActorFromRequest);
const mockedCreateSupabase = vi.mocked(createSupabaseAdminClient);

const admin = {
  userId: "admin-1",
  email: "admin@empresa.com",
  isAdmin: true,
  realUserId: "admin-1",
  realEmail: "admin@empresa.com",
  realIsAdmin: true,
  isSimulating: false,
};

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/taxonomia/sugestoes/sug-1/decidir", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function makeParams(id = "sug-1") {
  return { params: Promise.resolve({ id }) };
}

type Chamada = { tabela: string; metodo: string; payload?: unknown };

function makeSupabase(sugestao: { id: string; variacao: string; status: string } | null) {
  const chamadas: Chamada[] = [];
  const supabase = {
    from(tabela: string) {
      if (tabela === "taxonomia_sugestoes") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                chamadas.push({ tabela, metodo: "select" });
                return { data: sugestao, error: null };
              },
            }),
          }),
          update: (payload: unknown) => ({
            eq: async () => {
              chamadas.push({ tabela, metodo: "update", payload });
              return { error: null };
            },
          }),
        };
      }
      if (tabela === "taxonomia_termos") {
        return {
          insert: (payload: unknown) => ({
            select: () => ({
              single: async () => {
                chamadas.push({ tabela, metodo: "insert", payload });
                return { data: { id: "termo-novo-1" }, error: null };
              },
            }),
          }),
        };
      }
      if (tabela === "taxonomia_sinonimos") {
        return {
          insert: async (payload: unknown) => {
            chamadas.push({ tabela, metodo: "insert", payload });
            return { error: null };
          },
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  };
  return { supabase, chamadas };
}

beforeEach(() => {
  mockedActor.mockReset();
  mockedCreateSupabase.mockReset();
});

describe("POST /api/taxonomia/sugestoes/[id]/decidir", () => {
  it("rejeita quem nao e admin", async () => {
    mockedActor.mockResolvedValueOnce({ ...admin, isAdmin: false, realIsAdmin: false });
    mockedCreateSupabase.mockReturnValueOnce(makeSupabase(null).supabase as never);

    const response = await POST(makeRequest({ decisao: "rejeitar" }), makeParams());
    expect(response.status).toBe(403);
  });

  it("404 quando a sugestao nao existe", async () => {
    mockedActor.mockResolvedValueOnce(admin);
    mockedCreateSupabase.mockReturnValueOnce(makeSupabase(null).supabase as never);

    const response = await POST(makeRequest({ decisao: "rejeitar" }), makeParams());
    expect(response.status).toBe(404);
  });

  it("400 quando a sugestao ja foi revisada", async () => {
    mockedActor.mockResolvedValueOnce(admin);
    mockedCreateSupabase.mockReturnValueOnce(
      makeSupabase({ id: "sug-1", variacao: "termovisao", status: "aprovada" }).supabase as never,
    );

    const response = await POST(makeRequest({ decisao: "rejeitar" }), makeParams());
    expect(response.status).toBe(400);
  });

  it("rejeitar marca status rejeitada", async () => {
    mockedActor.mockResolvedValueOnce(admin);
    const { supabase, chamadas } = makeSupabase({ id: "sug-1", variacao: "termovisao", status: "pendente" });
    mockedCreateSupabase.mockReturnValueOnce(supabase as never);

    const response = await POST(makeRequest({ decisao: "rejeitar" }), makeParams());
    expect(response.status).toBe(200);
    const update = chamadas.find((c) => c.tabela === "taxonomia_sugestoes" && c.metodo === "update");
    expect(update?.payload).toMatchObject({ status: "rejeitada" });
  });

  it("aprovar_existente cria sinonimo apontando para o termo informado", async () => {
    mockedActor.mockResolvedValueOnce(admin);
    const { supabase, chamadas } = makeSupabase({ id: "sug-1", variacao: "termovisao", status: "pendente" });
    mockedCreateSupabase.mockReturnValueOnce(supabase as never);

    const response = await POST(
      makeRequest({ decisao: "aprovar_existente", termoId: "termo-eletrica" }),
      makeParams(),
    );
    expect(response.status).toBe(200);
    const insert = chamadas.find((c) => c.tabela === "taxonomia_sinonimos" && c.metodo === "insert");
    expect(insert?.payload).toMatchObject({
      termo_id: "termo-eletrica",
      variacao: "termovisao",
      origem: "aprovado",
    });
    const update = chamadas.find((c) => c.tabela === "taxonomia_sugestoes" && c.metodo === "update");
    expect(update?.payload).toMatchObject({ status: "aprovada" });
  });

  it("aprovar_novo cria termo e sinonimo, e marca a sugestao aprovada", async () => {
    mockedActor.mockResolvedValueOnce(admin);
    const { supabase, chamadas } = makeSupabase({ id: "sug-1", variacao: "termovisao", status: "pendente" });
    mockedCreateSupabase.mockReturnValueOnce(supabase as never);

    const response = await POST(
      makeRequest({
        decisao: "aprovar_novo",
        termo: "termografia",
        categoria: "Eletrica",
        tipo: "assunto",
      }),
      makeParams(),
    );
    const payload = (await response.json()) as { ok: boolean; termoId: string };
    expect(response.status).toBe(200);
    expect(payload.termoId).toBe("termo-novo-1");

    const insertTermo = chamadas.find((c) => c.tabela === "taxonomia_termos" && c.metodo === "insert");
    expect(insertTermo?.payload).toMatchObject({
      termo: "termografia",
      categoria: "Eletrica",
      tipo: "assunto",
    });
    const insertSinonimo = chamadas.find((c) => c.tabela === "taxonomia_sinonimos" && c.metodo === "insert");
    expect(insertSinonimo?.payload).toMatchObject({ termo_id: "termo-novo-1", variacao: "termovisao" });
  });

  it("aprovar_novo sem categoria devolve 400", async () => {
    mockedActor.mockResolvedValueOnce(admin);
    const { supabase } = makeSupabase({ id: "sug-1", variacao: "termovisao", status: "pendente" });
    mockedCreateSupabase.mockReturnValueOnce(supabase as never);

    const response = await POST(
      makeRequest({ decisao: "aprovar_novo", termo: "termografia" }),
      makeParams(),
    );
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 4: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/app/api/taxonomia/sugestoes/[id]/decidir/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 5: Implementar `POST /api/taxonomia/sugestoes/[id]/decidir`**

```ts
// src/app/api/taxonomia/sugestoes/[id]/decidir/route.ts
import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

type DecidirBody = {
  decisao?: string;
  termoId?: string;
  termo?: string;
  categoria?: string;
  tipo?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    if (!actor.isAdmin) {
      throw new HttpError(403, "Revisao de taxonomia e restrita a administradores.");
    }

    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as DecidirBody;

    const { data: sugestao, error: erroSugestao } = await supabaseAdmin
      .from("taxonomia_sugestoes")
      .select("id,variacao,status")
      .eq("id", id)
      .maybeSingle();
    if (erroSugestao) {
      throw erroSugestao;
    }
    if (!sugestao) {
      throw new HttpError(404, "Sugestao nao encontrada.");
    }
    if (sugestao.status !== "pendente") {
      throw new HttpError(400, "Essa sugestao ja foi revisada.");
    }

    if (body.decisao === "rejeitar") {
      const { error } = await supabaseAdmin
        .from("taxonomia_sugestoes")
        .update({
          status: "rejeitada",
          revisado_por: actor.realUserId,
          revisado_em: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) {
        throw error;
      }
      return NextResponse.json({ ok: true });
    }

    if (body.decisao === "aprovar_existente") {
      const termoId = typeof body.termoId === "string" ? body.termoId.trim() : "";
      if (!termoId) {
        throw new HttpError(400, "Informe o termo existente para vincular.");
      }

      const { error: erroSinonimo } = await supabaseAdmin.from("taxonomia_sinonimos").insert({
        termo_id: termoId,
        variacao: sugestao.variacao,
        origem: "aprovado",
      });
      if (erroSinonimo) {
        throw erroSinonimo;
      }

      const { error: erroUpdate } = await supabaseAdmin
        .from("taxonomia_sugestoes")
        .update({
          status: "aprovada",
          revisado_por: actor.realUserId,
          revisado_em: new Date().toISOString(),
        })
        .eq("id", id);
      if (erroUpdate) {
        throw erroUpdate;
      }

      return NextResponse.json({ ok: true });
    }

    if (body.decisao === "aprovar_novo") {
      const termo = typeof body.termo === "string" ? body.termo.trim().toLowerCase() : "";
      const categoria = typeof body.categoria === "string" ? body.categoria.trim() : "";
      const tipo =
        body.tipo === "equipamento" ? "equipamento" : body.tipo === "assunto" ? "assunto" : "";
      if (!termo || !categoria || !tipo) {
        throw new HttpError(400, "Informe termo, categoria e tipo para criar um novo termo.");
      }

      const { data: novoTermo, error: erroTermo } = await supabaseAdmin
        .from("taxonomia_termos")
        .insert({ termo, categoria, tipo })
        .select("id")
        .single();
      if (erroTermo) {
        throw erroTermo;
      }

      const { error: erroSinonimo } = await supabaseAdmin.from("taxonomia_sinonimos").insert({
        termo_id: novoTermo.id,
        variacao: sugestao.variacao,
        origem: "aprovado",
      });
      if (erroSinonimo) {
        throw erroSinonimo;
      }

      const { error: erroUpdate } = await supabaseAdmin
        .from("taxonomia_sugestoes")
        .update({
          status: "aprovada",
          revisado_por: actor.realUserId,
          revisado_em: new Date().toISOString(),
        })
        .eq("id", id);
      if (erroUpdate) {
        throw erroUpdate;
      }

      return NextResponse.json({ ok: true, termoId: novoTermo.id as string });
    }

    throw new HttpError(400, "Decisao invalida.");
  } catch (err) {
    console.error("Erro ao decidir sugestao de taxonomia:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Nao foi possivel processar a decisao.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/app/api/taxonomia && npx tsc --noEmit`
Expected: PASS (7 testes de `decidir`); tipos limpos.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/taxonomia
git commit -m "feat: adiciona rotas de revisao de sugestoes de taxonomia"
```

---

### Task 8: Tela administrativa e navegação

**Files:**
- Create: `src/app/taxonomia/page.tsx`
- Modify: `src/components/AppShell.tsx`

**Interfaces:**
- Consumes: `GET /api/taxonomia/sugestoes`, `GET /api/taxonomia/termos`, `POST /api/taxonomia/sugestoes/[id]/decidir` (Tasks 6-7).

- [ ] **Step 1: Implementar a página**

```tsx
// src/app/taxonomia/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { supabase } from "@/lib/supabaseClient";

type Sugestao = {
  id: string;
  variacao: string;
  termo_sugerido: string | null;
  documento_id: string | null;
  trecho: string | null;
  ocorrencias: number;
  created_at: string;
};

type Termo = {
  id: string;
  termo: string;
  categoria: string;
  tipo: "assunto" | "equipamento";
};

export default function TaxonomiaPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();

  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [termos, setTermos] = useState<Termo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processandoId, setProcessandoId] = useState<string | null>(null);
  const [selecaoTermo, setSelecaoTermo] = useState<Record<string, string>>({});
  const [novoTermoAberto, setNovoTermoAberto] = useState<Record<string, boolean>>({});
  const [novoTermoTexto, setNovoTermoTexto] = useState<Record<string, string>>({});
  const [novoTermoCategoria, setNovoTermoCategoria] = useState<Record<string, string>>({});
  const [novoTermoTipo, setNovoTermoTipo] = useState<Record<string, "assunto" | "equipamento">>(
    {},
  );

  useEffect(() => {
    if (authLoading || accessLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!isAdmin) {
      router.replace("/dashboard");
    }
  }, [authLoading, accessLoading, user, isAdmin, router]);

  const getAccessToken = async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const token = data.session?.access_token;
    if (!token) throw new Error("Sessao expirada. Faca login novamente.");
    return token;
  };

  const carregar = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [resSugestoes, resTermos] = await Promise.all([
        fetch("/api/taxonomia/sugestoes", { headers }),
        fetch("/api/taxonomia/termos", { headers }),
      ]);
      const payloadSugestoes = (await resSugestoes.json()) as {
        sugestoes?: Sugestao[];
        error?: string;
      };
      const payloadTermos = (await resTermos.json()) as { termos?: Termo[]; error?: string };
      if (!resSugestoes.ok) throw new Error(payloadSugestoes.error ?? "Falha ao carregar sugestoes.");
      if (!resTermos.ok) throw new Error(payloadTermos.error ?? "Falha ao carregar termos.");
      setSugestoes(payloadSugestoes.sugestoes ?? []);
      setTermos(payloadTermos.termos ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar a taxonomia.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !accessLoading && user && isAdmin) {
      void carregar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, accessLoading, user, isAdmin]);

  const decidir = async (id: string, body: Record<string, unknown>) => {
    setProcessandoId(id);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/taxonomia/sugestoes/${id}/decidir`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Nao foi possivel processar a decisao.");
      setSugestoes((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nao foi possivel processar a decisao.");
    } finally {
      setProcessandoId(null);
    }
  };

  if (authLoading || accessLoading || !user || !isAdmin) {
    return <div className="p-6 text-sm text-slate-500">Carregando...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Taxonomia — sugestões pendentes</h1>
        <p className="text-sm text-slate-500">
          Termos identificados pela IA que ainda não existem na taxonomia de busca. Aprove como
          sinônimo de um termo existente ou crie um termo novo.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando...</p>
      ) : sugestoes.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhuma sugestão pendente.</p>
      ) : (
        <div className="space-y-4">
          {sugestoes.map((sugestao) => (
            <div key={sugestao.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {sugestao.termo_sugerido ?? sugestao.variacao}
                  </p>
                  <p className="text-xs text-slate-500">
                    {sugestao.ocorrencias} ocorrência(s) — visto em{" "}
                    {new Date(sugestao.created_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={processandoId === sugestao.id}
                  onClick={() => void decidir(sugestao.id, { decisao: "rejeitar" })}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                >
                  Rejeitar
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={selecaoTermo[sugestao.id] ?? ""}
                  onChange={(event) =>
                    setSelecaoTermo((prev) => ({ ...prev, [sugestao.id]: event.target.value }))
                  }
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
                >
                  <option value="">Vincular a um termo existente…</option>
                  {termos.map((termo) => (
                    <option key={termo.id} value={termo.id}>
                      {termo.categoria} — {termo.termo}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!selecaoTermo[sugestao.id] || processandoId === sugestao.id}
                  onClick={() =>
                    void decidir(sugestao.id, {
                      decisao: "aprovar_existente",
                      termoId: selecaoTermo[sugestao.id],
                    })
                  }
                  className="rounded-full bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
                >
                  Aprovar como sinônimo
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setNovoTermoAberto((prev) => ({ ...prev, [sugestao.id]: !prev[sugestao.id] }))
                  }
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  {novoTermoAberto[sugestao.id] ? "Cancelar novo termo" : "Criar termo novo"}
                </button>
              </div>

              {novoTermoAberto[sugestao.id] && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
                  <input
                    placeholder="Termo canônico (ex.: gerador)"
                    value={novoTermoTexto[sugestao.id] ?? sugestao.termo_sugerido ?? ""}
                    onChange={(event) =>
                      setNovoTermoTexto((prev) => ({ ...prev, [sugestao.id]: event.target.value }))
                    }
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
                  />
                  <input
                    placeholder="Categoria (ex.: Gerador / nobreak)"
                    value={novoTermoCategoria[sugestao.id] ?? ""}
                    onChange={(event) =>
                      setNovoTermoCategoria((prev) => ({
                        ...prev,
                        [sugestao.id]: event.target.value,
                      }))
                    }
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
                  />
                  <select
                    value={novoTermoTipo[sugestao.id] ?? "equipamento"}
                    onChange={(event) =>
                      setNovoTermoTipo((prev) => ({
                        ...prev,
                        [sugestao.id]: event.target.value as "assunto" | "equipamento",
                      }))
                    }
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
                  >
                    <option value="equipamento">Equipamento</option>
                    <option value="assunto">Assunto</option>
                  </select>
                  <button
                    type="button"
                    disabled={processandoId === sugestao.id}
                    onClick={() =>
                      void decidir(sugestao.id, {
                        decisao: "aprovar_novo",
                        termo: novoTermoTexto[sugestao.id] ?? sugestao.termo_sugerido ?? "",
                        categoria: novoTermoCategoria[sugestao.id] ?? "",
                        tipo: novoTermoTipo[sugestao.id] ?? "equipamento",
                      })
                    }
                    className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    Criar e aprovar
                  </button>
                </div>
              )}

              {sugestao.trecho && (
                <p className="mt-3 rounded-xl bg-slate-50 p-2 text-xs text-slate-500">
                  &quot;{sugestao.trecho}&quot;
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Adicionar o item de navegação**

Em `src/components/AppShell.tsx`, importar o ícone `Tags` de `lucide-react` junto aos outros ícones já importados, e acrescentar ao array `items` do grupo `"Administração"` (mesmo grupo de "Usuários", "Lojas", "Prestadores", "Equipamentos"):

```ts
{
  href: "/taxonomia",
  label: "Taxonomia",
  icon: Tags,
  isActive: pathname?.startsWith("/taxonomia"),
  isVisible: isAdmin,
},
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm test`
Expected: tipos limpos; suíte inteira verde.

Verificação manual: `npm run dev`, logado como admin — o item "Taxonomia" aparece no menu "Administração"; a tela carrega (mesmo vazia, sem sugestões pendentes, o que é esperado antes de qualquer documento novo ser processado nesta fase). Logado como não-admin, o item não aparece e acessar `/taxonomia` diretamente redireciona para `/dashboard`.

- [ ] **Step 4: Commit**

```bash
git add src/app/taxonomia src/components/AppShell.tsx
git commit -m "feat: adiciona tela de revisao de sugestoes de taxonomia"
```

---

## Self-Review

**Cobertura da spec (Fase 2):**
- `taxonomia_termos`, `taxonomia_sinonimos`, `taxonomia_sugestoes` com os campos exatos da spec → Task 1 ✅
- Semente a partir de `SERVICOS_OFICIAIS` + `tipo_equipamento` distintos, com termos relacionados (gerador, refrigeração, elevadores, subestações, incêndio, ar-condicionado explicitamente cobertos) → Task 2 ✅
- Expansão automática com aprovação de admin antes de qualquer termo valer → Tasks 4 (captura), 7 (decisão), 8 (UI) ✅
- `documento_conteudo.termos` gravado por classificação, sem refazer OCR/embeddings para o acervo já indexado → Tasks 1 (coluna), 4 (classificação), 6 (reclassificação em lote) ✅
- Metadados existentes (unidade, fornecedor, data, competência, equipamento) não são tocados — só a ligação nova com a taxonomia foi adicionada ✅

**Divergências conscientes**, documentadas na seção "Decisões deste plano": sem chamada de IA nova (reaproveita `equipamento_tipo` já extraído); coluna `termos_classificado_em` adicional para tornar a reclassificação resumível sem ambiguidade; classificação como passo separado de `indexarConteudoDocumento`; reclassificação sem teto de custo (sem custo externo) nem cursor complexo; reclassificação do acervo não gera sugestões novas (campo não persistido retroativamente).

**Consistência de tipos:** `TaxonomiaIndice`/`classificarTexto` (Task 3) usados com a mesma assinatura em `taxonomiaIndexacao.ts` (Task 4); `ClassificarDocumentoParams`/`ResultadoClassificacao`/`classificarDocumento` (Task 4) consumidos identicamente pelo pipeline (Task 5) e pela reclassificação (Task 6); as rotas de API (Tasks 6-7) devolvem exatamente os campos que a UI (Task 8) espera (`sugestoes[].{id,variacao,termo_sugerido,documento_id,trecho,ocorrencias,created_at}`, `termos[].{id,termo,categoria,tipo}`).
