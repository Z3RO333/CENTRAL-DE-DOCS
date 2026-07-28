# Central de Documentos

Aplicação interna em Next.js para envio, revisão, assinatura e consulta de documentos. O sistema usa Supabase para autenticação, banco e armazenamento, além de integrações opcionais com Azure OpenAI, Azure Document Intelligence, SendGrid e BTracker.

## Requisitos

- Node.js 22
- npm
- Projeto Supabase com as migrations deste repositório aplicadas

## Configuração local

1. Instale as dependências:

   ```bash
   npm ci
   ```

2. Copie o arquivo de exemplo e preencha as credenciais do ambiente:

   ```bash
   cp .env.example .env.local
   ```

3. Inicie o ambiente de desenvolvimento:

   ```bash
   npm run dev
   ```

O app ficará disponível em `http://localhost:3000`.

## Comandos de qualidade

```bash
npm run lint      # ESLint e regras do React/Next.js
npm test          # testes unitários com Vitest
npm run build     # build de produção e verificação TypeScript
```

Antes de abrir um pull request, execute os três comandos.

## Variáveis de ambiente

As variáveis obrigatórias e opcionais estão documentadas em `.env.example`. Nunca versione `.env`, `.env.local`, chaves de serviço ou tokens do BTracker.

O limite dos uploads originais é controlado por `MAX_DOCUMENT_UPLOAD_MB` e assume 15 MB quando não configurado. PDF, PNG e JPEG são validados no servidor pelo conteúdo binário, não apenas pela extensão.

## Banco e Storage

As alterações de banco ficam em `supabase/migrations`. Aplique migrations novas no ambiente de homologação antes da produção e valide as políticas de RLS tanto nas tabelas quanto no bucket `formularios`.

Operações administrativas do servidor usam `SUPABASE_SERVICE_ROLE_KEY`; essa variável jamais deve ser exposta com prefixo `NEXT_PUBLIC_`.

## Implantação no Azure

O deploy de produção é feito pelo GitHub Actions em `.github/workflows/master_formscentral.yml` quando há push na branch `master` ou execução manual do workflow.

O pipeline:

1. instala dependências com Node.js 22;
2. executa lint, testes e build;
3. monta o bundle standalone do Next.js;
4. publica no Azure Web App `FORMSCENTRAL`.

Os segredos devem ser configurados em **GitHub → Settings → Secrets and variables → Actions**. O workflow de cobrança agendada também exige `CRON_SECRET`.

## Estrutura principal

- `src/app`: páginas e rotas da API
- `src/components`: componentes compartilhados
- `src/hooks`: estado e acesso do cliente
- `src/lib`: regras de negócio e integrações
- `supabase/migrations`: evolução do banco e políticas RLS
- `.github/workflows`: deploy e automações agendadas
