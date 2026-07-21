# Cadastro estruturado e controle de NF por conservadora — sub-projeto 1

## Contexto

O usuário pediu uma reformulação completa do controle de notas fiscais das
empresas conservadoras (hoje feito em planilhas manuais), incluindo captura
automática, verificação automática no BTracker, alertas de prazo, dashboard e
auditoria. Investigação da infraestrutura existente revelou duas restrições
importantes:

- **Não existe conta de serviço do BTracker.** O acesso depende sempre de um
  usuário logado via Microsoft SSO (JWT de 23h). Uma consulta automática "sem
  humano" não é viável — a verificação com o BTracker terá que ser desenhada
  como uma ação disparada dentro do sistema por um usuário com sessão ativa,
  não um robô de fundo.
- **Não existe infraestrutura de agendamento (cron)** no projeto hoje (sem
  `vercel.json`, sem `pg_cron`).

Por isso, o pedido foi decomposto em 5 sub-projetos sequenciais, cada um com
seu próprio ciclo spec → plano → implementação:

1. **Cadastro estruturado e controle de NF por conservadora** (este documento)
2. Motor de prazo (7 dias) + alertas
3. Verificação com BTracker disparada pelo sistema (não automática de fundo)
4. Dashboard de acompanhamento
5. Auditoria — **incorporada já neste sub-projeto 1**, por decisão do usuário
   (mais barato incluir desde o início do que encaixar depois)

## Fora de escopo (deste sub-projeto)

- Motor de prazo/alerta de 7 dias e qualquer notificação (e-mail/sistema) —
  sub-projeto 2.
- Qualquer consulta ou sincronização com o BTracker — sub-projeto 3. O campo
  `status` desta tabela só terá os valores `aguardando_verificacao`,
  `concluida` e `rejeitada` por agora; os status específicos de BTracker
  (registrada, não localizada, divergência, etc.) serão adicionados via nova
  migration quando o sub-projeto 3 for desenhado, sem precisar redesenhar esta
  tabela.
- Dashboard/métricas agregadas — sub-projeto 4.
- Nenhuma mudança no fluxo de notas fiscais para fornecedores que não sejam
  categoria=conservação — o formulário genérico (`/formulario/notas_fiscais`)
  continua exatamente como está para eles.
- Nenhuma mudança em `orcamentos_internos` ou em qualquer análise por IA.

## Modelo de dados

Nova tabela `public.notas_fiscais_conservacao`, seguindo o padrão de duas
camadas já usado em `orcamentos_internos`: metadados relacionais nesta tabela
+ um registro espelho em `public.formularios` (`tipo =
'notas_fiscais_conservacao'`) só para reaproveitar a infraestrutura já
existente de storage de arquivo, signed URLs e exclusão.

```sql
create table public.notas_fiscais_conservacao (
  id uuid primary key default gen_random_uuid(),
  formulario_id uuid not null references public.formularios(id) on delete cascade,
  prestador_id uuid not null references public.prestadores(id),
  loja_id uuid not null references public.lojas(id),
  numero_nf text not null,
  numero_pedido text,
  valor numeric,
  competencia text, -- formato "MM/AAAA", mesma convenção de dados.competencia
  data_recebimento date not null,
  observacoes text,
  status text not null default 'aguardando_verificacao'
    check (status in ('aguardando_verificacao', 'concluida', 'rejeitada')),
  motivo_status text, -- obrigatório quando status = 'rejeitada'
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prestador_id, numero_nf)
);
```

- `unique (prestador_id, numero_nf)` impede o cadastro duplicado da mesma nota
  para o mesmo prestador (uma NF que atende várias lojas é lançada como um
  único registro; a loja associada é a loja principal do lançamento).
- `prestador_id` deve apontar para um prestador com `categoria = 'conservacao'`
  — validado na API, não via constraint de banco (evita depender de trigger
  para uma regra que pode mudar).
- Auditoria via a infraestrutura já existente (`documentos_auditoria` +
  `logDocumentoAuditEvent`, hoje usada só para o evento `baixado`): novos
  eventos `nota_conservacao_criada`, `nota_conservacao_status_alterado`,
  `nota_conservacao_excluida` são gravados a cada ação, sempre com
  `actor_email` e, quando houver, o `motivo_status`. Exclusão sem motivo é
  bloqueada.

## Fluxo de cadastro

- Novo formulário em `/formulario/notas-fiscais-conservacao`, com o mesmo
  controle de acesso já usado em `/formulario/[slug]` hoje (usuário interno ou
  usuário autorizado do próprio prestador via `prestadores.usuarios`).
- Campos: Prestador (combobox restrito a `categoria = 'conservacao'`), Loja,
  Número da NF, Número do pedido (opcional), Valor, Competência, Data de
  recebimento, Observações, Anexo em PDF (obrigatório).
- Ao submeter: sobe o PDF pro storage (mesmo bucket `formularios`), cria o
  registro espelho em `formularios` (`tipo = 'notas_fiscais_conservacao'`),
  depois cria o registro em `notas_fiscais_conservacao` vinculado. Se a
  combinação prestador+número da nota já existir, retorna erro 409 com
  mensagem clara antes de subir o arquivo.
- **Guarda no formulário genérico:** em `/formulario/notas_fiscais`, se o
  prestador escolhido no combobox tiver `categoria = 'conservacao'`, o
  formulário exibe um aviso e bloqueia o envio, com link para o formulário
  novo.

## Visão de gestão

Nova sub-aba **"Notas Fiscais"** dentro da área Conservação, com a mesma
restrição de acesso já existente ali (admin + aprovadores de orçamentos
internos — `isAdmin || isAprovadorInterno`).

- Lista agrupada por conservadora, com contagem por status.
- Filtros: conservadora, loja, competência, status, número da nota.
- Ações: mudar status para `concluida` ou `rejeitada` (motivo obrigatório na
  rejeição), excluir (motivo obrigatório), abrir/baixar o PDF anexado (reaproveita
  `getSignedFileUrl`/`resolveSignedPdfPath` já existentes).

## Testes / verificação

- Cadastrar uma NF para um prestador categoria=conservação e confirmar que ela
  aparece na sub-aba "Notas Fiscais", com status inicial
  `aguardando_verificacao`.
- Tentar cadastrar a mesma combinação prestador+número de NF novamente e
  confirmar que é rejeitado com mensagem clara, sem subir o arquivo.
- Tentar cadastrar uma NF de conservadora pelo formulário genérico
  (`/formulario/notas_fiscais`) e confirmar que é bloqueado com link pro
  formulário novo.
- Marcar uma nota como rejeitada sem motivo e confirmar que é bloqueado;
  marcar com motivo e confirmar que o evento de auditoria é gravado.
- Excluir uma nota sem motivo e confirmar que é bloqueado.
- Confirmar que um usuário sem acesso à área Conservação não vê a sub-aba
  "Notas Fiscais" nem consegue acessar a rota diretamente.
