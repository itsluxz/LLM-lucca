# Caminho de implantação

Este diretório prepara a implantação; nenhum serviço externo é criado pelo projeto local. Confirme os planos, preços e limites atuais do provedor antes de usar `render.yaml`.

## Passo a passo no Render (Blueprint)

1. Envie o projeto para o GitHub. O `render.yaml` da raiz é uma cópia de `deploy/render.yaml`; mantenha os dois iguais.
2. No Render: *New → Blueprint*, escolha o repositório.
3. Preencha `ENCRYPTION_KEY` (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`; guarde-a) e `CLIENT_URL` (a URL pública do serviço, ex.: `https://llm-lucca.onrender.com`; se o Render usar outro nome, corrija depois e faça redeploy).
4. Abra a URL, crie sua conta em `/register` e cadastre as chaves em Configurações → Provedores.
5. Em *Environment*, mude `ALLOW_REGISTER` para `false` e salve, para ninguém mais se cadastrar.

`TRUST_PROXY=1` faz o Express confiar no proxy do Render, para o rate limit enxergar o IP real de cada visitante. A versão do Node é fixada em `24.x` pelo campo `engines` do `package.json`.

O build usa `npm install --include=dev` porque `NODE_ENV=production` omitiria `typescript`, `vite` e `prisma`, necessários para compilar e migrar. No plano free, uploads e imagens geradas somem a cada deploy/reinício, o serviço hiberna sem uso e o Postgres free expira; veja os limites atuais no Render.

## 1. Uso pessoal em um serviço

Crie PostgreSQL gerenciado, defina `DATABASE_URL`, `AUTH_MODE=multi`, `HOST=0.0.0.0`, `NODE_ENV=production`, `SERVE_WEB=true`, `COOKIE_SECURE=true`, `COOKIE_SAMESITE=lax` e `CLIENT_URL` igual à URL pública do serviço. Gere segredos diferentes para `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` e uma chave base64 de 32 bytes para `ENCRYPTION_KEY`. Guarde a chave fora do repositório. Rode `npm install`, `npm -w apps/server exec prisma generate`, `npm run build`, `npm -w apps/server run db:deploy` e `npm -w apps/server run start`. Não use `npm start` da raiz no Render, pois ele inicia Docker local.

Antes de enviar arquivos, implemente `StorageDriver` para S3/R2: o armazenamento local é efêmero em hospedagens comuns. O serviço de um processo pode usar cache e registro de streams em memória. A saúde é verificada em `/api/health`.

## 2. Frontend separado e vários usuários

Publique `apps/web/dist` como site estático, defina `VITE_API_URL` com a URL pública da API no build e restrinja `CLIENT_URL` à origem do site. Para domínios diferentes, configure `COOKIE_SAMESITE=none` e `COOKIE_SECURE=true`. Implemente o `CacheStore` Redis e o rate limit compartilhado antes de aumentar réplicas. Use armazenamento S3/R2 para os arquivos.

## 3. Várias instâncias

Implemente `StreamRegistry` com Redis pub/sub para que **Parar geração** chegue à instância que abriu o stream. Execute migrations uma vez antes do rollout. Considere fila para extração de PDFs e títulos e busca vetorial quando o volume de arquivos justificar. Revise a janela de contexto e o custo de arquivos grandes antes de ampliar limites.

O código atual inclui interfaces e stubs explícitos para S3 e Redis; escolher esses drivers somente por variável de ambiente antes de implementá-los falha com mensagem clara.
