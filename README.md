# Central Inteligente de Documentos

Plataforma Full-Stack para envio, revisão, assinatura, consulta e organização de documentos, com automações e recursos de inteligência artificial.

## Visão geral

A aplicação foi criada para substituir fluxos manuais de documentos por um processo digital centralizado, com autenticação, armazenamento seguro, validações de arquivos, automações e integrações com serviços de IA.

## Principais funcionalidades

- Upload e consulta de documentos
- Fluxos de revisão e assinatura
- Autenticação e controle de acesso
- Armazenamento seguro de arquivos
- Validação server-side de PDFs e imagens
- Integrações com IA para leitura e análise de documentos
- Automação de notificações e processos administrativos
- Histórico e organização centralizada
- Deploy automatizado via CI/CD

## Stack principal

- Next.js
- React
- TypeScript / JavaScript
- Supabase Auth
- PostgreSQL
- Supabase Storage
- Azure OpenAI
- Azure Document Intelligence
- GitHub Actions
- Azure
- Vitest

## Destaques técnicos

- políticas de Row Level Security no banco e Storage
- validação de arquivos pelo conteúdo binário, não apenas pela extensão
- operações privilegiadas isoladas no servidor
- integrações com serviços de inteligência artificial
- migrations versionadas para evolução do banco
- pipeline de CI/CD com lint, testes e build antes do deploy
- arquitetura separada entre interface, regras de negócio e integrações

## Objetivo

Digitalizar o ciclo de vida de documentos e reduzir tarefas manuais, criando uma experiência mais segura, rastreável e preparada para automações e inteligência artificial.

## Estrutura principal

```text
src/app          # páginas, layouts e APIs
src/components   # componentes reutilizáveis
src/hooks        # estado e comportamento do cliente
src/lib          # regras de negócio e integrações
supabase         # migrations e políticas de segurança
.github          # pipelines de CI/CD
```

## Execução local

### Avisos de novas notas fiscais

Cada nova nota fiscal enviada gera um aviso para `ordensmanutencao@bemol.com.br`,
usando o mesmo SendGrid dos avisos de orçamento (`SENDGRID_API_KEY`, `FROM_EMAIL`
e `NEXT_PUBLIC_SITE_URL` para o link de consulta).
As notas comuns usam o webhook de INSERT já existente em `/api/documentos/ia/processar`
(`DOCUMENTOS_IA_WEBHOOK_SECRET` e o segredo correspondente no Vault do Supabase).
O aviso é enviado antes da análise por IA. As notas de conservação são notificadas
após o cadastro na API própria. Edições e a importação de notas antigas para conservação
não disparam avisos. O resultado é registrado em `documentos_auditoria`, no evento
`nota_fiscal_notificacao`; envios já registrados com sucesso não são repetidos.
Falhas de envio são registradas sem interromper o cadastro ou a análise; não há
retentativa automática de e-mail.

### Desenvolvimento

```bash
npm ci
npm run dev
```

Validação:

```bash
npm run lint
npm test
npm run build
```

## Segurança

Credenciais, tokens, dados reais, endpoints privados e informações sensíveis de ambientes corporativos não devem ser versionados ou expostos publicamente.
