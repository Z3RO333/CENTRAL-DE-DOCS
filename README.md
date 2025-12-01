## Visão geral

Aplicação Next.js (App Router) que integra com Supabase para autenticação e armazenamento de documentos. Foi pensada para ser executada na Vercel, mas também pode rodar localmente via Node.js 18+.

## Dependências

- Node.js 18.18 ou 20+
- npm (ou pnpm/yarn/bun) – o projeto usa `npm` nos exemplos
- Conta Supabase com as chaves públicas disponíveis

## Configuração de variáveis

1. Copie o arquivo de exemplo:

   ```bash
   cp .env.example .env.local
   ```

2. Preencha `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` com os valores do seu projeto Supabase.  
   Essas mesmas variáveis devem ser configuradas no painel da Vercel (Project Settings → Environment Variables).

## Scripts principais

```bash
npm install        # instala dependências
npm run dev        # modo desenvolvimento em http://localhost:3000
npm run lint       # checa problemas com ESLint
npm run build      # gera build de produção
npm run start      # executa o build localmente
```

> A Vercel utilizará automaticamente `npm install`, `npm run build` e `npm run start` no deploy.

## Implantação na Vercel

1. Faça o push do repositório para GitHub/GitLab/Bitbucket.
2. Em [vercel.com](https://vercel.com), clique em **New Project** e importe o repositório.
3. Defina as variáveis da seção acima em *Environment Variables*.  
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. O comando de build padrão já é `npm run build`. Não modifique a pasta de saída (`.vercel` cuida do ambiente Next).
5. Finalize a importação. A Vercel executará o build e exibirá a URL pública.

Sempre que fizer push na branch monitorada (por exemplo `main` ou `master`), a Vercel criará um novo deploy automaticamente.
