# Cadastro de equipamentos por loja — sub-projeto 2/8 (Central de Documentos)

## Contexto

Segundo subsistema da reformulação ampla da Central de Documentos (ver
[2026-07-31-analise-ia-automatica-design.md](2026-07-31-analise-ia-automatica-design.md)
para a lista completa dos 8 subsistemas e a ordem de dependência). Este é a
fundação para os sub-projetos 3 (controle mensal por equipamento) e 4
(identificação automática do documento) — nenhum dos dois funciona sem um
cadastro de equipamento existir primeiro.

Levantamento no Supabase (projeto `tqzvgqauvbknwdvbtvfr`) confirmou que
**nenhuma** tabela de equipamento existe hoje. O sistema rastreia documentos
por prestador + loja, nunca por equipamento físico.

## Fonte de referência

O usuário forneceu `VALORES CONTRATOS.xlsx` (planilha de contratos de
manutenção), que já lista os equipamentos reais de ~89 unidades, organizados
por tipo de contrato (uma aba por tipo, não por loja). Achados usados neste
desenho:

- **9 tipos de equipamento reais em uso**: Ar Condicionado (Refrigeração),
  Gerador, Elevador/Escada Rolante/Plataforma/Monta-Carga, Subestação,
  Termografia, Combate a Incêndio, Poço, Controle de Pragas (Dedetização),
  Manutenção E.T.E.
- Atributos que variam por tipo: Gerador e Subestação têm potência (ex.:
  "150KVA"); Elevador tem subtipos (Elevador, Elevador de Carga, Escada
  Rolante, Monta Carga, Plataforma de Acessibilidade); a maioria tem marca
  e/ou modelo; nenhum tem número de série ou localização — esses campos
  não existem na planilha, ficam como opcionais no cadastro para
  preenchimento manual posterior.
- Cada linha da planilha referencia uma **empresa prestadora** (muitas já
  existem em `prestadores`, ex.: PRESTEM, TKE, HVAC) e uma **unidade**, mas
  os nomes de unidade da planilha (ex.: "P. Negra", "G. Circular", "Nova
  Cidade") **não batem exatamente** com `lojas.nome` no banco (ex.: "PONTA
  NEGRA", "GRANDE CIRCULAR" — maiúsculas, sem abreviação, sem acento,
  variações tipo "Farma X" vs "BEMOL FARMA X"). Confirmado comparando as 89
  unidades da aba `UNIDADES` da planilha com as 103 lojas cadastradas.
- A planilha também tem dados financeiros/contratuais (valor, reajuste,
  frequência de pagamento) — **decisão do usuário: fora de escopo**. Só os
  dados de equipamento (tipo, marca, potência, prestador) entram no
  cadastro; nada de controle de valor/contrato.

## Escopo

Cadastro de equipamentos por loja: schema novo, tela de administração
(CRUD), e uma rotina de importação da planilha para popular o cadastro
inicial. **Não inclui** (fica para sub-projetos seguintes):

- Controle mensal de documentos por equipamento (sub-projeto 3).
- Identificação automática de documento → equipamento (sub-projeto 4).
- Qualquer dado financeiro/contratual (valor, reajuste, frequência de
  pagamento) — decisão explícita do usuário.
- Tela de administração de "tipos de equipamento" como entidade separada —
  ver decisão de arquitetura abaixo.

## Decisão de arquitetura: tipo como texto, não tabela de referência

Duas abordagens foram consideradas:

- **Tabela `tipos_equipamento` administrável + `equipamentos` com FK** —
  mais próxima do padrão já usado para `lojas`/`prestadores`, mas exige uma
  tela de CRUD extra só para gerenciar tipos, que não foi pedida.
- **`equipamentos.tipo_equipamento` como texto livre, com sugestões na UI**
  (escolhida) — mesmo padrão já usado em `src/app/formulario/[slug]/page.tsx`
  para `tipo_laudo` (`options: ["Corretiva", "Preventiva"]`): texto livre
  com autocomplete alimentado pelos valores distintos já cadastrados. Evita
  uma tela inteira de administração de tipos para um conjunto que, na
  prática, já é conhecido (os 9 tipos da planilha) e raramente muda.

Atributos que variam por tipo (potência, por exemplo) vão em uma coluna
`atributos jsonb` livre, em vez de uma coluna por atributo — evita migração
toda vez que um tipo de equipamento novo aparecer com um atributo que os
outros não têm.

## Modelo de dados

Nova tabela `public.equipamentos`:

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `loja_id` | uuid FK → `lojas.id` | obrigatório |
| `tipo_equipamento` | text | obrigatório; texto livre com sugestões na UI |
| `identificacao` | text | opcional; ex. "Gerador 01" quando há mais de um do mesmo tipo na loja |
| `marca` | text | opcional |
| `modelo` | text | opcional |
| `numero_serie` | text | opcional — não presente na planilha, preenchimento manual futuro |
| `potencia` | text | opcional; texto livre (ex. "150KVA") para não forçar formato numérico único entre tipos diferentes |
| `localizacao` | text | opcional — não presente na planilha, preenchimento manual futuro |
| `prestador_id` | uuid FK → `prestadores.id`, nullable | quem atende o equipamento; não cria prestador novo automaticamente na importação |
| `documento_tipo_obrigatorio` | text, nullable | referência a um `formularios.tipo` esperado mensalmente para este equipamento; campo existe desde já mas **sem lógica de cobrança** — isso é sub-projeto 3 |
| `data_instalacao` | date, nullable | |
| `data_ativacao` | date, nullable | |
| `data_desativacao` | date, nullable | |
| `status` | text, default `'ativo'` | `ativo` \| `inativo`; CHECK constraint |
| `atributos` | jsonb, default `'{}'` | extras livres por tipo (ex. dados que não couberam nas colunas fixas) |
| `origem_importacao` | text, nullable | `'planilha_valores_contratos'` quando veio da importação, `null` quando cadastrado manualmente — permite auditar/filtrar o que veio de import |
| `created_at`, `updated_at` | timestamptz | |
| `created_by` | uuid, nullable FK → `auth.users.id` | segue padrão de `prestadores.created_by` |

RLS: leitura para quem já tem acesso a `documentos` (mesmo padrão de
`documentos_acesso`); escrita restrita a admin, seguindo o padrão de
`prestadores`/`lojas` (só admin cria/edita lojas e prestadores hoje).

## Rotina de importação

Script único (rodado manualmente por mim, não uma feature da UI) que:

1. Lê as 9 abas de equipamento da planilha (`ETE MANUTENÇÃO`,
   `DEDETIZAÇÃO`, `REFRIGERAÇÃO`, `ELEVADO ESCADA ROL`, `GERADOR`,
   `SUBESTAÇÃO`, `TEMOGRAFIA`, `COMBATE A INCÊNDIO`, `POÇO`).
2. Para cada linha com uma `Unidade` preenchida, normaliza o nome (maiúsculas,
   remove acentos, remove prefixos como "Farma"/"Bemol Farma" para
   comparação) e tenta casar contra `lojas.nome` (e contra `lojas.codigo`
   quando a planilha tiver um código equivalente).
3. Casos de match exato (ou normalizado) → insere o equipamento vinculado
   àquela loja, com `origem_importacao = 'planilha_valores_contratos'`.
4. Casos sem match → **não insere** — entram num relatório de conferência
   (arquivo de saída, ou lista impressa) para eu revisar com você antes de
   decidir o vínculo manualmente. Linhas marcadas como "N/C" ou "desativa"
   na planilha são ignoradas (não geram equipamento).
5. Tenta casar `Empresa`/prestadora da linha contra `prestadores.nome`; sem
   match, importa o equipamento sem `prestador_id` (não cria prestador).
6. Ignora todas as colunas financeiras (Valor, Aumento, Reajuste, VL Por
   Ano) — não lidas, não importadas.

Este script roda uma vez, direto no ambiente, não vira uma tela de "importar
planilha" reutilizável — não foi pedido e a estrutura da planilha não é
estável o suficiente para virar um importador genérico.

## Tela de administração

Nova rota (ex. `/lojas/[id]/equipamentos` ou aba dentro da tela de loja
existente — a decidir durante o plano de implementação, olhando a estrutura
atual de `src/app/lojas`): lista de equipamentos da loja, com
adicionar/editar/desativar. Reaproveita os padrões visuais já usados em
`usuarios`/`prestadores` (tabela + modal de edição). Campo `tipo_equipamento`
como input com `<datalist>` sugerindo os tipos já cadastrados no sistema.

## Fora de escopo (explícito)

- Dados financeiros/contratuais da planilha (valor, reajuste, empresa,
  frequência de pagamento) — decisão do usuário.
- Tela de administração de tipos de equipamento como entidade própria.
- Cobrança/controle mensal de documento por equipamento — sub-projeto 3.
- Vínculo automático documento↔equipamento — sub-projeto 4.
- Criação automática de prestador durante a importação quando não houver
  match — fica sem vínculo, sem inventar cadastro novo.

## Testes necessários

- Normalização de nome de unidade (remoção de acento, maiúsculas, remoção
  de prefixo "Farma"/"Bemol Farma") produz o match esperado para os casos
  conhecidos da planilha (ex. "P. Negra" → "PONTA NEGRA", "G. Circular" →
  "GRANDE CIRCULAR", "Farma Torquato" → "BEMOL FARMA TORQUATO").
- Linha sem `Unidade` preenchida, ou com `N/C`/"desativa", não gera
  equipamento.
- Linha cuja unidade não bate com nenhuma loja cai no relatório de
  conferência, não é inserida silenciosamente.
- CRUD da tela de equipamentos: criar, editar, desativar (não deleta —
  `status = 'inativo'` + `data_desativacao`).
- RLS: usuário sem acesso a documentos não consegue ler `equipamentos`;
  usuário não-admin não consegue criar/editar.
