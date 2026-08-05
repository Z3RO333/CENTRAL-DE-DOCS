# Auditoria de integridade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os achados reais (Critical/Important/Minor) da auditoria de integridade dos sub-projetos 1-7 da Central de Documentos — sem inventar features novas.

**Architecture:** Onze correções independentes (migrações SQL pontuais + pequenos ajustes de código), ordenadas das mais mecânicas/seguras para as duas mais estruturais e de maior risco (RLS de `formularios` e ativação do webhook de IA), que ficam por último de propósito.

**Tech Stack:** Next.js App Router (TypeScript), Supabase (Postgres + RLS + pg_net + Vault), Vitest.

## Global Constraints

- Nenhuma feature nova além do que já existe — só correção de integridade.
- Toda migração SQL deve ser idempotente onde fizer sentido (`if not exists`/`if exists`) já que roda contra produção com dados reais.
- Nenhum segredo (webhook secret, chaves) pode ser commitado em texto puro em nenhum arquivo do repositório — segredos ficam só no Supabase Vault ou em variável de ambiente do Azure App Service, nunca em migration file.
- Projeto Supabase: `tqzvgqauvbknwdvbtvfr` ("formulario central").
- Host de produção: `https://formscentral-frbnd8hxhkhjh5hn.brazilsouth-01.azurewebsites.net`.

---

### Task 1: `resolverLojaId` — corrige INSERT quebrado em achados críticos por `loja_id` vazio

**Files:**
- Modify: `src/lib/documentAnalysisPipeline.ts`
- Modify: `src/app/api/documentos/[id]/analisar/route.ts`
- Test: `src/lib/documentAnalysisPipeline.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `resolverLojaId(dados)` exportado de `documentAnalysisPipeline.ts`, usado nos dois pontos de entrada do pipeline.

**Contexto do bug:** `documento_recomendacoes_criticas.loja_id` é `uuid`, mas o código deriva `lojaId` com `typeof dados?.loja_id === "string" ? dados.loja_id : null`, que aceita string vazia `""`. Quando isso acontece, o INSERT em `registrarRecomendacoesCriticas` falha com erro de tipo do Postgres (`22P02`), e esse erro é engolido pelo try/catch best-effort — perdendo achados críticos silenciosamente. 18 documentos em produção já têm essa condição.

- [ ] **Step 1: Escrever os testes que falham**

Em `src/lib/documentAnalysisPipeline.test.ts`, adicionar um `describe` novo (após o `describe("temAchadoUrgente", ...)` existente):

```typescript
describe("resolverLojaId", () => {
  it("retorna a string quando loja_id e uma string valida", () => {
    expect(resolverLojaId({ loja_id: "loja-1" })).toBe("loja-1");
  });

  it("retorna null quando loja_id e string vazia", () => {
    expect(resolverLojaId({ loja_id: "" })).toBeNull();
  });

  it("retorna null quando loja_id e so espacos", () => {
    expect(resolverLojaId({ loja_id: "   " })).toBeNull();
  });

  it("retorna null quando loja_id nao e string", () => {
    expect(resolverLojaId({ loja_id: 123 })).toBeNull();
  });

  it("retorna null quando dados e null ou undefined", () => {
    expect(resolverLojaId(null)).toBeNull();
    expect(resolverLojaId(undefined)).toBeNull();
  });

  it("retorna null quando loja_id nao existe no objeto", () => {
    expect(resolverLojaId({})).toBeNull();
  });
});
```

Adicionar `resolverLojaId` ao bloco de import de `@/lib/documentAnalysisPipeline` no topo do arquivo de teste.

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- documentAnalysisPipeline`
Expected: FAIL com "resolverLojaId is not defined"

- [ ] **Step 3: Implementar `resolverLojaId` em `documentAnalysisPipeline.ts`**

Adicionar logo após `deveTentarEquipamento` (antes de `const LIMIAR_CONFIANCA_REVISAO`):

```typescript
export function resolverLojaId(
  dados: Record<string, unknown> | null | undefined,
): string | null {
  return typeof dados?.loja_id === "string" && dados.loja_id.trim()
    ? dados.loja_id
    : null;
}
```

Dentro de `processarDocumentoComIa`, substituir:

```typescript
    const lojaId = typeof dados?.loja_id === "string" ? dados.loja_id : null;
```

por:

```typescript
    const lojaId = resolverLojaId(dados);
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- documentAnalysisPipeline`
Expected: PASS

- [ ] **Step 5: Aplicar a mesma correção na rota manual**

Em `src/app/api/documentos/[id]/analisar/route.ts`, adicionar `resolverLojaId` ao import de `@/lib/documentAnalysisPipeline`, e substituir:

```typescript
    const lojaId = typeof dadosAtuais?.loja_id === "string" ? dadosAtuais.loja_id : null;
```

por:

```typescript
    const lojaId = resolverLojaId(dadosAtuais);
```

- [ ] **Step 6: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
git add src/lib/documentAnalysisPipeline.ts src/lib/documentAnalysisPipeline.test.ts src/app/api/documentos/[id]/analisar/route.ts
git commit -m "fix(documentos): trata loja_id vazio como ausente no pipeline de analise por IA"
```

---

### Task 2: Índices faltando

**Files:**
- Create: `supabase/migrations/202608051000_add_missing_indexes.sql`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: índices novos, sem impacto em código de aplicação.

- [ ] **Step 1: Escrever a migração**

```sql
-- 202608051000_add_missing_indexes.sql
create index if not exists equipamentos_prestador_id_idx
  on public.equipamentos (prestador_id);

create index if not exists documento_recomendacoes_criticas_prioridade_idx
  on public.documento_recomendacoes_criticas (prioridade)
  where prioridade in ('emergencial', 'critica');
```

- [ ] **Step 2: Aplicar a migração no projeto Supabase**

Aplicar via MCP/CLI do projeto `tqzvgqauvbknwdvbtvfr`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202608051000_add_missing_indexes.sql
git commit -m "fix(db): adiciona indices faltando em equipamentos.prestador_id e documento_recomendacoes_criticas.prioridade"
```

---

### Task 3: Revoga grants supérfluos em `equipamentos` e corrige `search_path` da trigger function

**Files:**
- Create: `supabase/migrations/202608051010_harden_equipamentos_grants.sql`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: nenhum código de aplicação depende disso — só o service role (`supabaseAdmin`) acessa `equipamentos`, e essa role não é afetada por `REVOKE ... FROM anon, authenticated`.

- [ ] **Step 1: Escrever a migração**

```sql
-- 202608051010_harden_equipamentos_grants.sql
revoke all on public.equipamentos from anon, authenticated;

create or replace function public.touch_equipamentos_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

- [ ] **Step 2: Aplicar a migração no projeto Supabase**

- [ ] **Step 3: Verificar manualmente**

Confirmar que a tela `/equipamentos` (admin) continua listando, criando e editando equipamentos normalmente após a migração — ela usa `supabaseAdmin` via API, não afetado pelo REVOKE.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202608051010_harden_equipamentos_grants.sql
git commit -m "fix(db): revoga grants de anon/authenticated em equipamentos e fixa search_path da trigger"
```

---

### Task 4: CHECK constraint em `documentos_analises_ia.status` e remove estado morto `aguardando_analise`

**Files:**
- Create: `supabase/migrations/202608051020_status_constraints_cleanup.sql`
- Modify: `src/app/documentos/_components/DocumentDetailsDrawer.tsx`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: nenhuma interface nova — limpeza de schema/UI.

**Contexto:** `documentos_analises_ia.status` nunca teve CHECK constraint (só `'concluida'`/`'erro'` são escritos pelo código hoje, mas nada impede um valor errado no futuro). `formularios.status_analise_ia` permite `'aguardando_analise'` no CHECK, mas nenhum código jamais escreve esse valor (o pipeline vai direto de `'recebido'` pra `'em_analise'`) — é um estado morto com label na UI (`DocumentDetailsDrawer.tsx`) que nunca aparece.

- [ ] **Step 1: Escrever a migração**

```sql
-- 202608051020_status_constraints_cleanup.sql
alter table public.documentos_analises_ia
  add constraint documentos_analises_ia_status_check
  check (status in ('concluida', 'erro'));

alter table public.formularios
  drop constraint if exists formularios_status_analise_ia_check;

alter table public.formularios
  add constraint formularios_status_analise_ia_check
  check (status_analise_ia in (
    'recebido', 'em_analise', 'concluida', 'necessita_revisao', 'erro', 'duplicado'
  ));
```

- [ ] **Step 2: Aplicar a migração no projeto Supabase**

- [ ] **Step 3: Remover o label morto da UI**

Em `src/app/documentos/_components/DocumentDetailsDrawer.tsx`, localizar o mapa de labels de `status_analise_ia` (contém a entrada para `aguardando_analise`) e remover essa entrada — sem substituto, já que o valor nunca é gravado.

- [ ] **Step 4: Rodar o typecheck e os testes**

Run: `npx tsc --noEmit && npm test`
Expected: sem erros novos, todos os testes passam.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608051020_status_constraints_cleanup.sql src/app/documentos/_components/DocumentDetailsDrawer.tsx
git commit -m "fix(db): adiciona CHECK em documentos_analises_ia.status e remove estado morto aguardando_analise"
```

---

### Task 5: FK de `documento_recomendacoes_criticas.loja_id` para `lojas`

**Files:**
- Create: `supabase/migrations/202608051030_add_loja_fk_recomendacoes_criticas.sql`

**Interfaces:**
- Consumes: `resolverLojaId` (Task 1) já garante que só uuids válidos ou `null` chegam nessa coluna daqui pra frente.
- Produces: nenhuma mudança de código necessária — a coluna já é tratada como opcional em todo o código existente.

A tabela está vazia em produção hoje, então a FK pode ser adicionada sem risco de violar dados existentes.

- [ ] **Step 1: Escrever a migração**

```sql
-- 202608051030_add_loja_fk_recomendacoes_criticas.sql
alter table public.documento_recomendacoes_criticas
  add constraint documento_recomendacoes_criticas_loja_id_fkey
  foreign key (loja_id) references public.lojas (id) on delete set null;
```

- [ ] **Step 2: Aplicar a migração no projeto Supabase**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202608051030_add_loja_fk_recomendacoes_criticas.sql
git commit -m "fix(db): adiciona FK de documento_recomendacoes_criticas.loja_id para lojas"
```

---

### Task 6: Erro amigável ao deletar loja com equipamentos vinculados

**Files:**
- Modify: `src/app/api/lojas/route.ts`
- Test: não há suite de teste para rotas de API no projeto (padrão já aceito nos sub-projetos anteriores) — verificação manual no Step 3.

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: nenhuma interface nova consumida por outra task.

**Contexto:** `equipamentos.loja_id` é `ON DELETE RESTRICT` (corrigido corretamente no sub-projeto 2), mas a rota `DELETE /api/lojas` não faz checagem prévia — o erro cru do Postgres (`update or delete on table "lojas" violates foreign key constraint "equipamentos_loja_id_fkey"`) vaza pro admin como um 500 confuso.

- [ ] **Step 1: Adicionar a checagem antes do delete**

Em `src/app/api/lojas/route.ts`, dentro de `DELETE`, substituir:

```typescript
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      throw new HttpError(400, "Informe a loja para remover.");
    }

    const { error } = await supabaseAdmin.from("lojas").delete().eq("id", id);
    if (error) {
      throw error;
    }
```

por:

```typescript
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      throw new HttpError(400, "Informe a loja para remover.");
    }

    const { count: totalEquipamentos, error: countError } = await supabaseAdmin
      .from("equipamentos")
      .select("id", { count: "exact", head: true })
      .eq("loja_id", id);
    if (countError) {
      throw countError;
    }
    if (totalEquipamentos && totalEquipamentos > 0) {
      throw new HttpError(
        409,
        `Esta loja possui ${totalEquipamentos} equipamento(s) cadastrado(s). Remova ou transfira os equipamentos antes de excluir a loja.`,
      );
    }

    const { error } = await supabaseAdmin.from("lojas").delete().eq("id", id);
    if (error) {
      throw error;
    }
```

- [ ] **Step 2: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 3: Verificar manualmente**

Rodar `npm run dev`, tentar excluir (via tela de administração de lojas) uma loja que tenha equipamentos cadastrados, e confirmar que aparece a mensagem amigável em vez de um erro genérico. Confirmar que excluir uma loja sem equipamentos continua funcionando normalmente.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/lojas/route.ts
git commit -m "fix(lojas): retorna erro amigavel ao tentar excluir loja com equipamentos vinculados"
```

---

### Task 7: Impede cadastro de equipamento duplicado (mesma loja + tipo + identificação)

**Files:**
- Modify: `src/app/api/equipamentos/route.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: nenhuma interface nova consumida por outra task.

**Contexto:** Hoje 2 pares de equipamentos já existem duplicados em produção (mesma `loja_id`+`tipo_equipamento`, `identificacao` nula em ambos) — provavelmente artefato da importação inicial. Como `encontrarEquipamentoCorrespondente` só resolve automaticamente quando há exatamente 1 equipamento correspondente, essas duplicatas travam documentos permanentemente em `necessita_revisao`.

Este fix previne **novas** duplicatas indo pra frente — não mexe nos 2 pares já existentes, que exigem decisão humana (qual registro manter/renomear) e devem ser resolvidos manualmente pela tela de administração já existente, não por uma migração automática.

- [ ] **Step 1: Adicionar a checagem de duplicidade no POST**

Em `src/app/api/equipamentos/route.ts`, dentro de `POST`, logo após as validações de `lojaId`/`tipoEquipamento` (antes do INSERT):

```typescript
    if (!tipoEquipamento) {
      throw new HttpError(400, "Informe o tipo do equipamento.");
    }

    const identificacaoNormalizada = sanitizeText(body.identificacao);
    let queryDuplicidade = supabaseAdmin
      .from("equipamentos")
      .select("id", { count: "exact", head: true })
      .eq("loja_id", lojaId)
      .eq("tipo_equipamento", tipoEquipamento)
      .eq("status", "ativo");
    queryDuplicidade = identificacaoNormalizada
      ? queryDuplicidade.eq("identificacao", identificacaoNormalizada)
      : queryDuplicidade.is("identificacao", null);
    const { count: duplicados, error: duplicidadeError } = await queryDuplicidade;
    if (duplicidadeError) {
      throw duplicidadeError;
    }
    if (duplicados && duplicados > 0) {
      throw new HttpError(
        409,
        "Ja existe um equipamento ativo com o mesmo tipo e identificacao nesta loja. Use uma identificacao diferente para distinguir os equipamentos.",
      );
    }
```

- [ ] **Step 2: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 3: Verificar manualmente**

Rodar `npm run dev`, tentar cadastrar dois equipamentos com a mesma loja+tipo+identificação (ou ambos sem identificação) e confirmar que o segundo é bloqueado com a mensagem clara. Confirmar que cadastrar com identificações diferentes (ex.: "Gerador 01" e "Gerador 02") continua funcionando.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/equipamentos/route.ts
git commit -m "fix(equipamentos): impede cadastro de equipamento duplicado na mesma loja"
```

---

### Task 8: Corrigir `equipamento_id` manualmente limpa `status_analise_ia` quando apropriado

**Files:**
- Modify: `src/app/api/documentos/route.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: nenhuma interface nova consumida por outra task.

**Contexto:** Quando o pipeline automático não consegue resolver o equipamento (`necessita_revisao`), hoje a única forma de sair desse estado é clicar "Reprocessar com IA" (gastando uma chamada à Azure OpenAI) — mesmo que o admin já tenha corrigido `equipamento_id` manualmente pelo diálogo de edição. O `PATCH` nunca toca `status_analise_ia`.

Este fix é conservador: só reavalia o status quando `equipamento_id` está sendo alterado NA MESMA requisição, e só promove de `necessita_revisao` para `concluida` quando o documento já tinha todo o resto resolvido (não tenta reavaliar confiança/loja/competência, que exigiriam o resultado original da IA).

- [ ] **Step 1: Localizar o PATCH e o payload atual**

Em `src/app/api/documentos/route.ts`, dentro de `PATCH`, o tipo `UpdatePayload` e a montagem do payload de update — ler o arquivo (linhas ~560-650) pra confirmar a estrutura exata antes de editar, já que o nome das variáveis locais pode ter mudado desde a última leitura.

- [ ] **Step 2: Adicionar a lógica de reavaliação de status**

Logo após a leitura do registro atual (`registroAtual`/equivalente, já buscado no início do handler para outras validações) e antes de montar o `updatePayload` final, adicionar:

```typescript
    if (
      Object.prototype.hasOwnProperty.call(body, "equipamento_id") &&
      body.equipamento_id &&
      registroAtual.status_analise_ia === "necessita_revisao"
    ) {
      updatePayload.status_analise_ia = "concluida";
    }
```

(Ajustar o nome exato da variável que contém o registro já buscado antes do update, e o nome do objeto de payload — confirmar contra o código real no Step 1, este é o comportamento a implementar, não um diff literal de linha.)

- [ ] **Step 3: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Verificar manualmente**

Rodar `npm run dev`, abrir um documento com `status_analise_ia = 'necessita_revisao'` (ou simular via SQL de teste), corrigir o equipamento manualmente pelo diálogo de edição, e confirmar que o badge de status da IA muda para "Análise concluída" sem precisar clicar em reprocessar.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/documentos/route.ts
git commit -m "fix(documentos): promove status_analise_ia para concluida ao corrigir equipamento manualmente"
```

---

### Task 9: Campo `documento_tipo_obrigatorio` na tela de administração de equipamentos

**Files:**
- Modify: `src/app/equipamentos/page.tsx`

**Interfaces:**
- Consumes: nada de tasks anteriores — `documento_tipo_obrigatorio` já existe na coluna do banco, no tipo `Equipamento` (`src/hooks/useEquipamentos.ts`) e é aceito pelas rotas POST/PATCH de `src/app/api/equipamentos/route.ts` (nenhuma dessas três camadas precisa mudar).
- Produces: nenhuma interface nova consumida por outra task.

**Contexto:** Esta coluna tem write-path completo no hook e na API, mas nenhum campo na tela de admin — write-path incompleto na prática porque ninguém consegue preenchê-la. Fora de escopo: usar esse campo na lógica de `equipamentos_pendencias_ano` (isso seria uma mudança de comportamento de negócio, não uma correção de integridade).

- [ ] **Step 1: Adicionar o estado do formulário**

Em `src/app/equipamentos/page.tsx`, junto dos outros `formX` states (após `formDataAtivacao`, linha ~47):

```typescript
  const [formDataAtivacao, setFormDataAtivacao] = useState("");
  const [formDocumentoTipoObrigatorio, setFormDocumentoTipoObrigatorio] = useState("");
```

- [ ] **Step 2: Incluir no reset, na edição e no submit**

Em `resetForm`:

```typescript
    setFormDataAtivacao("");
    setFormDocumentoTipoObrigatorio("");
```

Em `openEdit`:

```typescript
    setFormDataAtivacao(equipamento.data_ativacao ?? "");
    setFormDocumentoTipoObrigatorio(equipamento.documento_tipo_obrigatorio ?? "");
```

Em `handleSubmit`, nos dois payloads (`updateEquipamento` e `createEquipamento`), adicionar o campo junto dos demais:

```typescript
          data_ativacao: formDataAtivacao || null,
          documento_tipo_obrigatorio: formDocumentoTipoObrigatorio || null,
```

- [ ] **Step 3: Adicionar o `<select>` no JSX do formulário**

Localizar o bloco do `<select>` de frequência no JSX (`formFrequencia`) e adicionar um campo irmão logo depois, seguindo o mesmo padrão visual:

```tsx
                <label className="text-xs font-semibold text-slate-600">
                  Tipo de documento obrigatorio
                  <select
                    value={formDocumentoTipoObrigatorio}
                    onChange={(e) => setFormDocumentoTipoObrigatorio(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  >
                    <option value="">Nenhum</option>
                    <option value="registro_laudos">Registro e Laudos</option>
                    <option value="notas_fiscais">Notas Fiscais</option>
                    <option value="retencao_trabalhista">Retencao Trabalhista</option>
                    <option value="contratos">Contratos</option>
                    <option value="orcamentos">Orcamentos</option>
                  </select>
                </label>
```

- [ ] **Step 4: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Verificar manualmente**

Rodar `npm run dev`, abrir `/equipamentos`, editar um equipamento, selecionar um tipo de documento obrigatório, salvar, reabrir a edição e confirmar que o valor persistiu.

- [ ] **Step 6: Commit**

```bash
git add src/app/equipamentos/page.tsx
git commit -m "feat(equipamentos): adiciona campo documento_tipo_obrigatorio na tela de administracao"
```

---

### Task 10: RLS de `formularios` — remove policy sem escopo, adiciona policy corretamente restrita por loja/prestador

**Files:**
- Create: `supabase/migrations/202608051040_scope_formularios_rls.sql`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: nenhuma mudança de código de aplicação necessária — a API já faz sua própria checagem via `supabaseAdmin` (que ignora RLS); esta task só afeta o acesso direto ao Supabase REST, usado hoje por: (a) o insert de novos documentos direto do navegador em várias telas (`policies` de INSERT, não tocadas aqui), e (b) a tela de assinatura de laudo em `src/app/documentos/[id]/page.tsx`, que faz um `SELECT *` e um `UPDATE` direto no Supabase (não tocados na lógica, só no escopo de quais linhas ficam visíveis/editáveis).

**Contexto do bug:** As policies `formularios_select_only_approved` e `formularios_update_only_approved` (anteriores a esta reformulação) só checam `EXISTS (SELECT 1 FROM documentos_acesso WHERE user_id = auth.uid())` — ou seja, qualquer usuário com QUALQUER linha em `documentos_acesso` (27 gerentes hoje) enxerga e edita TODOS os documentos do sistema via API REST direta do Supabase, contornando toda a lógica de escopo por loja/prestador que já existe na camada de API do Next.js (`buildDocumentosAccessOr`).

A correção replica em SQL a mesma lógica de acesso já implementada em `src/lib/apiAuth.ts`/`src/lib/documentosAccessFilters.ts`:
- admin (`is_documentos_admin()`, já existe) → acesso total;
- usuário dono do próprio documento (`user_id = auth.uid()`) → sempre pode ver/editar o que ele mesmo enviou;
- prestador cujo e-mail está no array `prestadores.usuarios` → acesso aos documentos daquele `prestador_id`;
- gerente/fornecedor com linha em `documentos_acesso` (`scope in ('gerente','fornecedor')`) escopada por `loja_id` (`dados->>'loja_id'`) e, quando não `can_view_all`, também por `prestador_id`.

Também restringe, por segurança adicional (defesa em profundidade), quais colunas um usuário comum pode alterar via UPDATE direto — hoje a única tela que faz isso é a de assinatura, que só altera `status`, `arquivo_assinado_path` e `assinado_por`.

- [ ] **Step 1: Escrever a migração**

```sql
-- 202608051040_scope_formularios_rls.sql
drop policy if exists "formularios_select_only_approved" on public.formularios;
drop policy if exists "formularios_update_only_approved" on public.formularios;

create policy "formularios_select_scoped" on public.formularios
for select
to authenticated
using (
  is_documentos_admin()
  or user_id = auth.uid()
  or prestador_id in (
    select p.id from public.prestadores p
    where auth.email() = any(p.usuarios)
  )
  or exists (
    select 1 from public.documentos_acesso da
    where da.scope in ('gerente', 'fornecedor')
      and (da.user_id = auth.uid() or da.email = auth.email())
      and da.loja_id is not null
      and da.loja_id::text = (formularios.dados ->> 'loja_id')
      and (
        da.can_view_all
        or (da.prestador_id is not null and da.prestador_id = formularios.prestador_id)
      )
  )
);

create policy "formularios_update_scoped" on public.formularios
for update
to authenticated
using (
  is_documentos_admin()
  or user_id = auth.uid()
  or prestador_id in (
    select p.id from public.prestadores p
    where auth.email() = any(p.usuarios)
  )
  or exists (
    select 1 from public.documentos_acesso da
    where da.scope in ('gerente', 'fornecedor')
      and (da.user_id = auth.uid() or da.email = auth.email())
      and da.loja_id is not null
      and da.loja_id::text = (formularios.dados ->> 'loja_id')
      and (
        da.can_view_all
        or (da.prestador_id is not null and da.prestador_id = formularios.prestador_id)
      )
  )
)
with check (
  is_documentos_admin()
  or user_id = auth.uid()
  or prestador_id in (
    select p.id from public.prestadores p
    where auth.email() = any(p.usuarios)
  )
  or exists (
    select 1 from public.documentos_acesso da
    where da.scope in ('gerente', 'fornecedor')
      and (da.user_id = auth.uid() or da.email = auth.email())
      and da.loja_id is not null
      and da.loja_id::text = (formularios.dados ->> 'loja_id')
      and (
        da.can_view_all
        or (da.prestador_id is not null and da.prestador_id = formularios.prestador_id)
      )
  )
);

-- Defesa em profundidade: usuarios comuns (nao-admin) so alteram os 3 campos
-- que a tela de assinatura de laudo realmente usa via update direto.
-- supabaseAdmin (service role) nao e afetado por privilegios de coluna.
revoke update on public.formularios from authenticated;
grant update (status, arquivo_assinado_path, assinado_por) on public.formularios to authenticated;
```

- [ ] **Step 2: Aplicar a migração no projeto Supabase**

- [ ] **Step 3: Verificar a correção com simulação de sessão (read-only, dentro de uma transação com rollback)**

Rodar via SQL, substituindo `<uuid-de-um-gerente-real>` por um `user_id` real de uma linha `scope='gerente'` em `documentos_acesso` (consultar antes com `select user_id, loja_id from documentos_acesso where scope = 'gerente' limit 1`):

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "<uuid-de-um-gerente-real>", "role": "authenticated"}';

-- Deve retornar SO os documentos da loja desse gerente, nao a tabela inteira.
select count(*) from public.formularios;

-- Comparar com o total real da tabela (rodado antes da simulacao, fora da
-- transacao, como admin/service role) para confirmar que o numero caiu.
rollback;
```

Confirmar que a contagem dentro da simulação é bem menor que o total real de `formularios` (855 linhas na auditoria). Se vier igual ao total, a policy não está filtrando e a migração precisa ser revista antes de prosseguir — não seguir para o Step 4 nesse caso.

- [ ] **Step 4: Verificar que os fluxos legítimos continuam funcionando**

Rodar `npm run dev` e, com uma conta de teste real (ou revisão de código cuidadosa se não houver conta de teste disponível), confirmar que: (a) o insert de novos documentos pelas telas de formulário continua funcionando (não afetado, as policies de INSERT não foram tocadas); (b) a tela de assinatura de laudo (`/documentos/[id]`, ação de assinar) continua conseguindo ler o documento e gravar a assinatura.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608051040_scope_formularios_rls.sql
git commit -m "fix(seguranca): escopa RLS de formularios por loja/prestador em vez de liberar acesso total a qualquer usuario com documentos_acesso"
```

---

### Task 11: Ativa o pipeline de análise por IA em produção (webhook) e processa o backlog

**Files:**
- Create: `supabase/migrations/202608051050_create_documentos_ia_webhook.sql`

**Interfaces:**
- Consumes: `resolverLojaId` (Task 1) — importante que essa correção já esteja em produção antes deste task rodar, para não perder achados críticos dos 18 documentos já identificados assim que a análise automática começar a rodar de verdade.
- Produces: nada consumido por outra task — última task do plano.

**Contexto:** Nenhum Database Webhook foi criado no Supabase para este projeto (confirmado: `supabase_functions.hooks` nem existe). O trigger de auditoria (`documentos_auditoria_insert_trigger`) é o único gatilho em `formularios`. Resultado: 855/855 documentos travados em `status_analise_ia = 'recebido'` para sempre, `documento_recomendacoes_criticas` permanentemente vazia, `equipamento_id` nunca vinculado automaticamente.

Este task tem uma dependência externa que não pode ser fechada só com código: a variável de ambiente `DOCUMENTOS_IA_WEBHOOK_SECRET` precisa estar configurada no Azure App Service de produção com o MESMO valor armazenado no Supabase Vault por este task, e a branch com a Task 1 (e idealmente todas as anteriores) precisa estar implantada em produção antes do backfill do Step 5 rodar — senão o backfill vai reproduzir o mesmo bug de `loja_id` vazio que a Task 1 corrige.

- [ ] **Step 1: Escrever a migração do trigger (sem segredo em texto puro)**

```sql
-- 202608051050_create_documentos_ia_webhook.sql
create extension if not exists pg_net with schema extensions;

create or replace function public.notificar_documentos_ia_processar()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'documentos_ia_webhook_secret'
  limit 1;

  if webhook_secret is null then
    raise warning 'documentos_ia_webhook_secret nao configurado no Vault; pulando notificacao.';
    return new;
  end if;

  perform net.http_post(
    url := 'https://formscentral-frbnd8hxhkhjh5hn.brazilsouth-01.azurewebsites.net/api/documentos/ia/processar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || webhook_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'formularios',
      'record', jsonb_build_object('id', new.id)
    )
  );

  return new;
end;
$$;

revoke all on function public.notificar_documentos_ia_processar() from public, anon, authenticated;

drop trigger if exists documentos_ia_processar_trigger on public.formularios;
create trigger documentos_ia_processar_trigger
  after insert on public.formularios
  for each row
  execute function public.notificar_documentos_ia_processar();
```

- [ ] **Step 2: Aplicar a migração no projeto Supabase**

- [ ] **Step 3: Armazenar o segredo no Vault (NÃO commitar este valor em nenhum arquivo)**

Rodar diretamente via SQL/MCP, fora de qualquer arquivo versionado:

```sql
select vault.create_secret(
  '<VALOR_DO_SEGREDO_GERADO>',
  'documentos_ia_webhook_secret',
  'Segredo do header Authorization enviado por formularios ao processar documentos via IA'
);
```

- [ ] **Step 4: Configurar `DOCUMENTOS_IA_WEBHOOK_SECRET` no Azure App Service**

Ação externa (fora deste repositório): configurar a variável de ambiente `DOCUMENTOS_IA_WEBHOOK_SECRET` nas configurações do Azure App Service de produção com o MESMO valor usado no Step 3, e reiniciar/reimplantar o app para o valor ser lido. Confirmar que a branch com a Task 1 já está implantada nesse momento.

- [ ] **Step 5: Verificar que o webhook dispara**

Inserir um documento de teste (ou aguardar o próximo envio real de um tipo em escopo — `notas_fiscais`, `registro_laudos`, `retencao_trabalhista`, `contratos`, `orcamentos`) e confirmar, consultando `documentos_analises_ia` e `formularios.status_analise_ia` para aquele id, que o status saiu de `'recebido'` para `'em_analise'` e depois para um estado final (`concluida`/`necessita_revisao`/`erro`) em até alguns minutos.

- [ ] **Step 6: Processar o backlog de 855 documentos**

Com o webhook confirmado funcionando (Step 5) e a Task 1 já implantada, disparar a análise para cada documento do backlog chamando a mesma rota do webhook diretamente (mesmo secret, mesmo formato de payload), em lotes pequenos com espaçamento entre chamadas (ex.: lotes de 10, aguardando alguns segundos entre lotes) para não sobrecarregar a Azure OpenAI/Document Intelligence nem estourar limites de taxa — não disparar as 855 chamadas de uma vez em paralelo. Consultar `formularios` filtrando por `status_analise_ia = 'recebido'` e tipo em escopo para obter a lista de ids a processar. Acompanhar o progresso consultando periodicamente a contagem de documentos que ainda restam em `'recebido'`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/202608051050_create_documentos_ia_webhook.sql
git commit -m "feat(documentos): cria webhook do Supabase para disparar analise por IA automaticamente"
```

---

## Self-Review

**Cobertura dos achados da auditoria:**
- Critical #1 (pipeline nunca dispara) → Task 11. ✅
- Critical #2 (RLS de formularios sem escopo) → Task 10. ✅
- Critical #3 (loja_id vazio quebra INSERT de achados) → Task 1. ✅
- Important (equipamentos duplicados) → Task 7 (previne novos; os 2 pares existentes ficam para resolução manual via tela de admin, documentado explicitamente). ✅
- Important (loja_id sem FK) → Task 5. ✅
- Important (DELETE de loja com equipamentos retorna 500 cru) → Task 6. ✅
- Important (RLS de documentos_analises_ia sem escopo) → **não incluído neste plano**: hoje só 2 usuários admin têm a permissão que ativaria o vazamento, risco latente mas não ativo; decisão consciente de não empilhar uma segunda mudança de RLS de alto risco na mesma rodada — registrar como pendência para revisão futura, não esquecimento.
- Important (equipamento_id não limpa status_analise_ia) → Task 8. ✅
- Important (documento_tipo_obrigatorio sem UI) → Task 9. ✅
- Important (duplicação de linhas em documentos_analises_ia) → **não é um bug**: confirmado que `documentos_analises_ia` é uma tabela de histórico por design (um row por tentativa de análise), e todo consumidor já lê com `order by created_at desc limit 1`. Achado da auditoria descartado como falso positivo.
- Minor (CHECK em documentos_analises_ia.status, estado morto aguardando_analise) → Task 4. ✅
- Minor (índices faltando) → Task 2. ✅
- Minor (grants de equipamentos, search_path da trigger) → Task 3. ✅
- Minor (snapshot fields nunca atualizados em documento_recomendacoes_criticas) → **não incluído**: comportamento aceito explicitamente pelo próprio sub-projeto 5 (achado é uma fotografia do momento da análise); baixo impacto hoje com a tabela vazia.
- Minor (equipamentos.atributos e origem_importacao sem uso) → **não incluído**: `origem_importacao` é metadado de importação intencionalmente não editável; `atributos` é um campo de extensibilidade genérico sem uso ainda — nenhum dos dois é um bug de integridade, seriam features novas se alguém decidir usá-los.

**Varredura de placeholders:** nenhum "TBD"/"TODO" nas tasks; todo SQL e código é completo e verbatim. Task 8 tem uma nota explícita pedindo confirmação do nome exato de variáveis locais antes de editar (não é um placeholder de conteúdo, é uma instrução de verificação porque o arquivo é grande e mutável).

**Ordem e risco:** tasks 1-9 são mecânicas e de baixo risco, executadas primeiro para build de confiança nas revisões. Tasks 10 (RLS) e 11 (webhook + backfill) são as de maior risco/impacto e ficam por último, cada uma com passos explícitos de verificação antes de prosseguir — Task 11 depende de uma ação externa (configurar variável de ambiente no Azure) que não pode ser automatizada por um subagente.
