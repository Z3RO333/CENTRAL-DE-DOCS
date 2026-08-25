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
