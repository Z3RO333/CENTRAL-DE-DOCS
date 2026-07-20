# Aba "Conservação" — separação de documentos de empresas conservadoras

## Contexto

Documentos (retenção trabalhista, laudos, notas fiscais, orçamentos, contratos) de
prestadores classificados como "empresas conservadoras" (ex.: JanPro) hoje ficam
misturados na listagem geral de `Documentos`, junto com todos os outros fornecedores.
É necessário separá-los numa aba própria, seguindo o mesmo padrão já usado para
separar a aba "Contratos" da listagem geral (commits `df2e24d`, `387337c`, `35e8a51`).

## Fora de escopo (decidido explicitamente)

- Nenhum novo fluxo de aprovação/reprovação de orçamentos. O módulo `orcamentos_internos`
  (com `status`, `gestor_id`, aprovadores) permanece intocado e não relacionado a esta feature.
  Documentos tipo `orcamentos` desta aba continuam com o status genérico já existente
  (`em_analise` / `revisado`).
- Nenhuma nova avaliação de IA. A extração de campos já existente em
  `src/lib/openAiDocumentAnalysis.ts` continua igual; não haverá comparação/julgamento
  automático de preços entre orçamentos.
- Acesso à aba nova restrito a admin (mesma restrição da aba Contratos hoje).

## Modelo de dados

Adicionar coluna `categoria` na tabela `public.prestadores`:

- Valores fixos: `'conservacao' | 'outro'`.
- Default: `'outro'`.
- Coexiste com o campo `tipo_servico` (texto livre) já existente — não o substitui.
  `tipo_servico` continua sendo exibido como está hoje; `categoria` é apenas o campo
  estruturado usado para filtrar/separar as conservadoras.
- Editável no cadastro/edição de prestadores em `src/app/prestadores/page.tsx`
  (novo select no formulário, ao lado do campo de tipo de serviço).

## Backend / API

`src/app/api/documentos/route.ts`:

- Hoje a rota já exclui por padrão `tipo=orcamentos_internos` (sempre) e `tipo=contratos`
  (a menos que `tipo=contratos` seja pedido explicitamente).
- Acrescentar: por padrão, excluir também qualquer documento cujo `prestador.categoria =
  'conservacao'` (requer join com `prestadores`), a menos que a query receba
  `categoriaPrestador=conservacao` explicitamente. Mesmo padrão usado hoje para `contratos`,
  mas filtrando por categoria do prestador em vez de por tipo de documento — logo, **todos os
  tipos** de documento desse prestador saem da listagem geral e vão para a aba nova.
- Coluna "Valor": quando o documento listado tiver `tipo === "orcamentos"`, expor
  `dados.valor` (campo já preenchido pelo colaborador no formulário de orçamento, sem
  depender de IA) para exibição em coluna própria, ordenável. Isso vale tanto na listagem
  geral quanto na aba Conservação — não é exclusivo desta aba, é uma melhoria geral para
  qualquer documento tipo `orcamentos`.

Nenhuma mudança no fluxo de cadastro (`/formulario/[slug]`) nem no `PrestadorCombobox.tsx`:
o colaborador cadastra documentos normalmente escolhendo o prestador; se o prestador for
categoria `conservacao`, o documento automaticamente aparece na aba nova em vez da geral.

## Frontend

Nova página `src/app/documentos/conservacao/page.tsx`, replicando o padrão de
`src/app/documentos/contratos/page.tsx`:

- Busca via `GET /api/documentos?categoriaPrestador=conservacao` (sem filtro fixo de
  `tipo` — mostra todos os tipos), com filtro de `tipo` disponível no dropdown para o
  usuário refinar dentro da aba se quiser.
- Reaproveita `DocumentActions`, `DocumentDetailsDrawer`, filtros de prestador/loja,
  paginação — mesmos componentes já usados em `documentos/page.tsx` e `contratos/page.tsx`.
- Coluna "Valor" visível quando a linha for `tipo === "orcamentos"` (ver seção Backend).
- Restrita a admin: usa `useDocumentsAccess().isAdmin`, mesma checagem usada em
  `contratos/page.tsx:78-80`.
- Novo item de menu em `src/components/AppShell.tsx` (`navGroups`), com
  `isVisible: isAdmin`, mesmo padrão do item "Contratos".

## Testes / verificação

- Cadastrar um documento de qualquer tipo para um prestador com `categoria='conservacao'`
  e confirmar que ele não aparece na listagem geral de Documentos, mas aparece na aba
  Conservação.
- Cadastrar um documento para um prestador `categoria='outro'` e confirmar que continua
  aparecendo na listagem geral normalmente.
- Confirmar que a coluna "Valor" aparece e ordena corretamente para documentos
  `tipo=orcamentos` tanto na listagem geral quanto na aba Conservação.
- Confirmar que usuários não-admin não veem o item de menu "Conservação" nem conseguem
  acessar a rota diretamente.
