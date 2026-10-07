# LLM — Lucca Language Model

Site de chat com IAs no estilo ChatGPT/Claude. Você cola as chaves de API dos seus provedores (OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Mistral, DeepSeek ou qualquer endpoint compatível com OpenAI, como Ollama e LM Studio) e conversa com qualquer modelo disponível, trocando de modelo até no meio da conversa.

## Sumário

1. [Funcionalidades](#funcionalidades)
2. [Instalação e uso](#instalação-e-uso)
3. [Arquitetura](#arquitetura)
4. [Estrutura de pastas](#estrutura-de-pastas)
5. [Backend em detalhe](#backend-em-detalhe)
6. [Frontend em detalhe](#frontend-em-detalhe)
7. [Fluxo completo de uma mensagem](#fluxo-completo-de-uma-mensagem)
8. [Banco de dados](#banco-de-dados)
9. [Segurança](#segurança)
10. [Configuração (.env)](#configuração-env)
11. [Banco e backup](#banco-e-backup)
12. [Adicionar um provedor](#adicionar-um-provedor)
13. [Caminho de escala](#caminho-de-escala)
14. [Testes](#testes)

## Funcionalidades

- **Chat com streaming** token a token, Markdown, fórmulas (KaTeX), blocos de código com destaque e botão de copiar.
- **Troca de modelo por conversa**; a lista vem em tempo real da API de cada provedor (nada de nomes de modelo fixos no código).
- **Contador de tokens** por resposta: entrada, processamento (raciocínio) e saída, com total acumulado da conversa e medidor da janela de contexto no campo de mensagem. Valores estimados são marcados com `≈`.
- **Conversas**: criar, buscar, renomear, fixar, excluir; título automático.
- **Projetos**: pastas com instruções próprias e arquivos de conhecimento (.txt, .md, .pdf, código…) injetados como contexto.
- **Imagens**: envio de imagens para modelos com visão e geração de imagens por modelos que suportam.
- **Pesquisa na web** nativa nos provedores que oferecem (ex.: Anthropic), com lista de fontes.
- **Perfis e persona**: no modo local há vários perfis; cada um pode ter nome e imagens próprias para a assistente (substituindo o mascote) e paleta de cores.
- **Autenticação em dois modos**: `local` (usuário único, sem login) e `multi` (e-mail e senha, JWT).
- **Chaves criptografadas** no banco (AES-256-GCM).

## Instalação e uso

Requisitos: **Node.js 20 ou superior**, npm e **Docker Desktop** aberto.

No Windows, dê dois cliques em `iniciar.bat`. Ele instala as dependências se necessário, prepara o banco e inicia o projeto. Depois, abra <http://localhost:5173>.

Pelo terminal:

```sh
npm install
npm run setup
npm run dev
```

Abra <http://localhost:5173>. No modo local o usuário Lucca entra automaticamente. Vá a **Configurações → Provedores**, cole uma chave, clique **Testar e salvar** e escolha um modelo no topo do chat. O teste chama a API de modelos do provedor, então é preciso internet para provedores remotos. Para Ollama ou LM Studio, use **Personalizado** e informe a URL compatível com OpenAI terminada em `/v1`.

`npm run setup` cria o `.env` com segredos aleatórios, inicia o PostgreSQL, aplica as migrations e cria o usuário local. É seguro rodar de novo: mantém os segredos existentes. **Não envie o `.env` ao Git nem perca a `ENCRYPTION_KEY`**: sem ela, as chaves de API salvas ficam ilegíveis.

`npm run build && npm start` roda a versão de produção local em um único processo: o Express serve a API e o frontend buildado em <http://127.0.0.1:3000>.

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe o Postgres (Docker), a API (porta 3000) e o Vite (porta 5173) |
| `npm run build` | Compila frontend e backend |
| `npm start` | Produção local, tudo em um processo |
| `npm test` | Testes (Vitest) |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run db:migrate` | Cria/aplica migrations Prisma |
| `npm run db:studio` | Interface visual do banco |
| `npm run qa:visual` | Capturas de tela automatizadas (Playwright) |

## Arquitetura

```
┌────────────────────┐   HTTP + SSE    ┌──────────────────────────┐        ┌───────────────┐
│ Frontend (React)   │ ──────────────▶ │ Backend (Express)        │ ─────▶ │ PostgreSQL    │
│ Vite · Zustand ·   │ ◀────────────── │ rotas → services → Prisma│        └───────────────┘
│ TanStack Query     │   deltas de     │                          │        ┌───────────────┐
└────────────────────┘   texto         │ lib/: Storage · Cache ·  │ ─────▶ │ Disco (uploads)│
                                       │       StreamRegistry     │        └───────────────┘
                                       │                          │        ┌───────────────┐
                                       │ llm/: adaptadores        │ ─────▶ │ APIs dos      │
                                       └──────────────────────────┘  fetch │ provedores    │
                                                                          └───────────────┘
```

Monorepo com **npm workspaces** (`apps/server` e `apps/web`). Decisões principais:

1. **Adaptadores por trás de uma interface (`LLMProvider`)**. O resto do sistema só conhece `streamChat()` e `listModels()`. Cada provedor traduz seu formato próprio de requisição, streaming e contagem de tokens para um formato comum. Isso torna trivial adicionar provedores.
2. **SSE em vez de WebSocket**. A resposta do modelo é um fluxo só de servidor para cliente; SSE é mais simples, passa por proxies e reconecta bem. Como o `EventSource` do navegador só aceita GET, o frontend lê o SSE de um `POST` com `fetch` + `ReadableStream`.
3. **Drivers plugáveis** (`StorageDriver`, `CacheStore`, `StreamRegistry`). Hoje usam disco e memória; para escalar basta trocar a variável de ambiente e implementar o driver (S3, Redis). O backend é *stateless* fora dessas interfaces.
4. **Configuração só por `config/env.ts`**, validada com zod na inicialização; combinações inválidas (ex.: `STORAGE_DRIVER=s3` sem bucket) impedem o servidor de subir, com mensagem clara.
5. **Camadas**: rotas validam entrada e delegam; regra de negócio fica em `service`s; só os services/rotas falam com o Prisma. Toda query filtra por `userId`.
6. **Dois modos de auth no mesmo código**: o middleware `requireAuth` decide. Em `local` injeta o usuário local; em `multi` exige JWT. Nada mais no sistema muda entre os dois.
7. **Sem SDKs dos provedores**: `fetch` nativo e parser de SSE próprio, para controlar as diferenças de cada API e manter poucas dependências.

## Estrutura de pastas

```
apps/server/
  prisma/               schema.prisma, migrations, seed.ts
  src/
    index.ts            bootstrap: escuta em HOST:PORT
    app.ts              middlewares globais e montagem das rotas em /api
    config/env.ts       leitura e validação do ambiente (zod)
    lib/                prisma, crypto (AES-GCM), jwt, logger, sse,
                        storage/ cache/ streams/  (drivers plugáveis)
    middlewares/        auth, error, rateLimit, validate
    modules/            auth, users, providers, models, conversations,
                        messages, chat, projects, images
    llm/                types, registry, context, modelFilters,
                        providers/ (um adaptador por provedor)
    tests/              Vitest
apps/web/src/
  App.tsx, main.tsx     entrada e rotas
  pages/                Chat, Projects, Project, Settings, Login, Register
  components/           chat/ layout/ mascot/
  hooks/                useChatStream, useModels, useProfiles, useAuth
  stores/               authStore, chatStore, uiStore (Zustand)
  services/             api.ts (fetch + refresh), sse.ts (leitor de SSE)
scripts/                setup.mjs, start.mjs, run-prisma.mjs, visual-qa.mjs
deploy/                 render.yaml e DEPLOY.md (preparados, não executados)
```

## Backend em detalhe

### Bootstrap e pipeline HTTP (`app.ts`)

Ordem dos middlewares: `helmet` → `cors` (só `CLIENT_URL`, com credenciais) → `pino-http` (logs, com `authorization` e cookies **redigidos**) → `express.json` (limite de 2 MB) → `cookie-parser`. Tudo vive sob um `Router` montado em `/api` (um único lugar para versionar). `/health` e `/auth` ficam antes do `requireAuth`; todo o resto passa por ele. Se `SERVE_WEB=true`, o Express serve também `apps/web/dist` e devolve `index.html` para qualquer rota (SPA). O `errorHandler` global fica por último.

### Autenticação (`middlewares/auth.ts`, `modules/auth`)

- **Modo `local`**: `localOwnerId()` faz um `upsert` do usuário `local@llm.lucca` e guarda o id em memória. O cabeçalho `X-Profile-Id` permite alternar entre perfis (outros usuários com o mesmo domínio de e-mail); se o perfil for inválido, cai no principal. As **chaves de API são compartilhadas**: `keyOwnerId()` sempre aponta para o perfil principal.
- **Modo `multi`**: `Authorization: Bearer <accessToken>` (JWT de 15 min). O refresh token (30 dias) é um valor aleatório enviado em cookie `httpOnly`; no banco fica só o **hash SHA-256**. A cada `/auth/refresh` o token antigo é revogado e um novo é emitido (**rotação**), então um token vazado e reutilizado é detectado como revogado.
- Senhas: `bcrypt` com custo 12. Login com erro devolve a mesma mensagem para e-mail inexistente e senha errada (evita enumerar usuários).

### Criptografia das chaves (`lib/crypto.ts`)

```ts
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
// grava iv:authTag:ciphertext em base64
```

AES-256-GCM é criptografia **autenticada**: além de esconder o conteúdo, a `authTag` faz a descriptografia falhar se alguém adulterar o valor no banco. Cada chave usa um IV aleatório novo, então a mesma API key gera textos diferentes. A API nunca devolve a chave; só os últimos 4 caracteres.

### A interface de provedores (`llm/types.ts`)

```ts
interface LLMProvider {
  id: string; displayName: string;
  listModels(apiKey, baseUrl?): Promise<ModelInfo[]>;
  streamChat(params: StreamParams): AsyncIterable<StreamEvent>;
  // opcionais: supportsWebSearch, isImageModel, generateImage
}
type StreamEvent =
  | { type: 'delta'; text: string }       // pedaço de texto
  | { type: 'usage'; usage: TokenUsage }  // contagem oficial
  | { type: 'status'; text: string }      // "Pesquisando na web…"
  | { type: 'source'; source: WebSource };// fonte citada
```

`streamChat` é um **gerador assíncrono** (`async function*`): o adaptador faz `yield` de cada evento assim que o provedor o envia, e o chamador consome com `for await`. Isso desacopla totalmente a rota de chat do formato de cada API. O `registry.ts` mapeia `"openai"` → adaptador, e `resolveModel("anthropic:claude-x")` separa provedor e modelo no primeiro `:`.

### Adaptadores (`llm/providers/`)

- **`openaiCompatible.ts`** é a classe base: `POST {baseUrl}/chat/completions` com `stream: true` e `stream_options: { include_usage: true }` (o uso chega no último chunk). OpenAI, OpenRouter, Groq, Mistral, DeepSeek e "Personalizado" são só instâncias com outra URL/filtros (arquivos de ~6 linhas).
- **`anthropic.ts`**: `system` vai separado das mensagens; lê `message_start` (entrada), `content_block_delta` (texto/thinking/citações) e `message_delta` (saída). Suporta pesquisa na web, inclusive o *loop de continuação* quando a API responde `pause_turn`, e faz *fallback* para a variante antiga da ferramenta se o modelo recusar a nova.
- **`google.ts`**: `streamGenerateContent?alt=sse`; papel `assistant` vira `model`; system vai em `systemInstruction`.
- **`sseParser.ts`**: `parseSse()` lê o `ReadableStream`, acumula num buffer, divide por `\n\n` e produz `{event, data}`. Trata `\r\n` e eventos que chegam quebrados entre chunks. `checked()` converte falhas HTTP em mensagens amigáveis (401 → "Chave de API inválida", 429 → limite atingido, 5xx → provedor indisponível) e anexa o detalhe do provedor em 400/403/404.

### Normalização de tokens

Cada provedor informa o uso de um jeito; os adaptadores normalizam para `TokenUsage { inputTokens, cachedTokens, reasoningTokens, outputTokens }`:

| Provedor | Entrada | Raciocínio | Saída |
|---|---|---|---|
| OpenAI e compatíveis | `prompt_tokens` | `completion_tokens_details.reasoning_tokens` | `completion_tokens` − raciocínio |
| Anthropic | `input_tokens` + cache lido | estimado pelo texto dos `thinking_delta` (caracteres ÷ 4) | `output_tokens` − raciocínio estimado |
| Gemini | `promptTokenCount` | `thoughtsTokenCount` | `candidatesTokenCount` |

A regra central: **o raciocínio nunca é contado duas vezes**. Se o provedor não informa um valor, `normalizeUsage()` (em `chat/service.ts`) estima (≈ caracteres ÷ 4) e marca `usageSource = "estimate"`; o frontend mostra `≈`. Raciocínio não informado fica `null`, não 0.

### Montagem do contexto (`llm/context.ts` e `chat/service.ts`)

`buildContext()` monta o *system prompt* nesta ordem: prompt base do site (com `{persona}` substituído) → instruções globais do usuário → instruções do projeto → cada arquivo do projeto envolvido em `<documento nome="...">…</documento>`. Depois vem o histórico. Se a estimativa passar de **80% da janela de contexto** do modelo, remove as mensagens mais antigas primeiro (nunca as instruções nem a última mensagem).

`chatContext()` (a "cola" do chat) verifica o dono da conversa, resolve o modelo, busca a chave do provedor, descobre a janela de contexto (cache de 10 min), carrega o histórico e as imagens anexadas e devolve tudo pronto, incluindo `inputEstimate`. O endpoint `/estimate` reaproveita a mesma função, por isso o contador do composer bate com o envio real.

### Rota de streaming (`modules/chat/routes.ts`)

A função `generate()` serve tanto `stream` quanto `regenerate`. Em ordem:

1. Verifica o dono da conversa e monta o contexto.
2. Registra um `AbortController` no `StreamRegistry` (só **uma geração por conversa**; tentar outra dá erro).
3. Salva a mensagem do usuário (ou apaga a última resposta, no caso de regenerar).
4. Abre o SSE (`openSse`: cabeçalhos + `: ping` a cada 15 s para manter a conexão atrás de proxies).
5. `for await` sobre os eventos do adaptador, repassando `delta`/`status` ao cliente e acumulando o texto.
6. Se o cliente fechar a aba (`res.on('close')`) ou chamar `/stop`, o `AbortController` cancela o `fetch` ao provedor. O que já foi gerado **é salvo**, com saída estimada.
7. Salva a mensagem do assistente com tokens, duração e erro (se houver); gera o título (primeiras ~6 palavras) na primeira troca; envia `usage`, `error` e `done`.

Eventos SSE: `delta`, `status`, `usage`, `title`, `error`, `done`.

### Drivers plugáveis (`lib/`)

`StreamRegistry` é o exemplo mais claro: uma interface com `register/stop/remove`, implementada hoje por `MemoryStreams` (um `Map` em memória) e por `RedisStreams` (stub que lança "não implementado"). O `export const streams` escolhe pela env. O mesmo padrão vale para `storage/` e `cache/`. Quando houver várias instâncias do servidor, só o driver Redis precisa ser escrito: o botão "parar" passará a funcionar de qualquer instância.

### Outros módulos

- **`models`**: agrega os modelos de todos os provedores ativos do usuário em paralelo (`Promise.all`; um provedor que falha vira lista vazia, sem derrubar os outros), remove *snapshots* datados e modelos antigos (`MODEL_MAX_AGE_MONTHS`) e guarda em cache por 10 min.
- **`providers`**: CRUD de chaves; ao salvar, **valida a chave** chamando `listModels` antes de gravar.
- **`projects`**: upload com `multer` (10 MB), extração de texto (`pdf-parse` para PDF), original salvo via `StorageDriver`, texto e estimativa de tokens no banco.
- **`images`**: serve imagens enviadas/geradas, sempre checando o dono.
- **`middlewares/rateLimit.ts`**: 10 req/min em auth; 30 req/min no chat, por usuário.

## Frontend em detalhe

- **`App.tsx`**: ao iniciar chama `GET /auth/me`, que devolve `authMode` e o usuário. Em `local` mostra o app direto; em `multi` sem sessão mostra Login/Cadastro. Define as rotas: `/`, `/c/:id`, `/projects`, `/projects/:id`, `/settings`.
- **Estado em três camadas**:
  - **TanStack Query** → dados do servidor (conversas, modelos, projetos), com cache e invalidação.
  - **Zustand** → estado de interface e do streaming em andamento (`chatStore`: `draft`, `usage`, `status`; `authStore`; `uiStore`).
  - **Estado local** do componente para o resto.
- **`services/api.ts`**: wrapper do `fetch` que injeta `Authorization` e `X-Profile-Id`; em 401 tenta `/auth/refresh` **uma vez** e repete a requisição.
- **`services/sse.ts` + `hooks/useChatStream.ts`**: `readSse` lê o corpo da resposta com `getReader()`, junta pedaços, separa blocos por linha em branco e chama um callback por evento. O hook faz o `POST`, e a cada `delta` chama `chatStore.append()`; a tela renderiza `draft` como uma mensagem provisória (`id: 'streaming'`), contando a saída ao vivo por estimativa até chegar o `usage` oficial. No fim (`finally`) limpa o store e **invalida** as queries, que recarregam a conversa já salva do banco.
- **Componentes de chat**: `MessageBubble` (Markdown, ações), `Composer` (auto-altura, anexos, Enter/Shift+Enter), `ModelPicker` (busca, agrupado por provedor), `TokenUsageBar` (linha `↓ Entrada · ⚙ Processamento · ↑ Saída · Σ`), `ConversationUsageChip` (total e barra empilhada), `ContextMeter` (estimativa de entrada com debounce de 400 ms; amarelo > 70%, vermelho > 90%).
- **Mascote**: `Mascot` escolhe a imagem por humor (`hello`, `thinking`, `wink`, `idle`), com `image-rendering: pixelated` e animações CSS que respeitam `prefers-reduced-motion`. Imagens da persona do perfil substituem as do mascote.

## Fluxo completo de uma mensagem

```
Composer ──▶ useChatStream.stream()
              │ POST /api/chat/:id/stream {content, model}
              ▼
        requireAuth ─▶ chatLimit ─▶ validate(zod)
              ▼
        chatContext(): dono → modelo → chave → janela → histórico → buildContext()
              ▼
        StreamRegistry.register()  ·  salva mensagem do usuário  ·  openSse()
              ▼
        adapter.streamChat()  ──fetch──▶  API do provedor
              │ yield delta/usage         (SSE do provedor → parseSse)
              ▼
        sendSse('delta')  ──────────────▶  readSse → chatStore.append → tela
              ▼
        fim/stop/erro: normalizeUsage → salva mensagem do assistente
              ▼
        sendSse('usage' · 'title' · 'done')  →  invalida queries → recarrega do banco
```

## Banco de dados

PostgreSQL via Prisma (`apps/server/prisma/schema.prisma`):

| Modelo | Função |
|---|---|
| `User` | Conta; `passwordHash` é nulo no modo local. Guarda modelo padrão, instruções globais, nome/imagens da persona e paleta |
| `RefreshToken` | Hash do refresh token, validade e revogação |
| `ProviderKey` | Chave criptografada por provedor (`@@unique([userId, provider, label])`), `baseUrl` para endpoints custom |
| `Project` / `ProjectFile` | Instruções do projeto e arquivos com o texto extraído |
| `Conversation` | Título, modelo atual, fixada, projeto opcional; índice `[userId, pinned, updatedAt]` |
| `Message` | Papel, conteúdo, modelo, tokens (entrada/cache/raciocínio/saída), `usageSource`, duração, erro; índice `[conversationId, createdAt]` |

Exclusões em cascata (apagar usuário apaga tudo dele; apagar projeto só desvincula as conversas — `SetNull`).

## Segurança

- Chaves de API: AES-256-GCM; nunca logadas nem devolvidas inteiras.
- Senhas: bcrypt (custo 12). Refresh tokens: só o hash SHA-256 no banco, rotacionados a cada uso, em cookie `httpOnly`.
- No modo local o servidor escuta só em `127.0.0.1`, para não expor suas chaves na rede.
- CORS restrito a `CLIENT_URL`; `helmet`; limite de 2 MB de JSON e 10 MB de upload; rate limit em auth e chat.
- Toda consulta filtra pelo dono (`userId`); entradas validadas com zod.
- Erros de rede/TLS do provedor viram mensagens claras (inclusive o caso de antivírus/proxy interceptando HTTPS).

## Configuração (.env)

O `.env.example` lista todas as variáveis; o servidor valida valores e combinações na inicialização.

| Variável | Uso |
|---|---|
| `NODE_ENV` | `development`, `production` ou `test` |
| `AUTH_MODE` | `local` entra direto; `multi` exige cadastro/login |
| `HOST`, `PORT` | Interface e porta da API; local usa `127.0.0.1:3000` |
| `SERVE_WEB` | Serve `apps/web/dist` pelo Express quando `true` |
| `CLIENT_URL` | Origem autorizada pelo CORS |
| `DATABASE_URL` | Conexão PostgreSQL |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Segredos de autenticação; gerados no setup |
| `ENCRYPTION_KEY` | 32 bytes em base64 para criptografar as chaves de API |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_PATH` | `local` salva originais em `storage/uploads`; `s3` ainda não implementado |
| `CACHE_DRIVER` | `memory` (10 min de cache de modelos); `redis` ainda não implementado |
| `STREAM_REGISTRY_DRIVER` | `memory` controla o botão parar; `redis` ainda não implementado |
| `REDIS_URL` | Exigida se algum driver Redis for escolhido |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Reservadas ao driver S3/R2 |
| `TRUST_PROXY` | Nº de proxies à frente do servidor (Render = 1), para o rate limit ver o IP real |
| `ALLOW_REGISTER` | Em `multi`, `false` bloqueia novos cadastros |
| `COOKIE_SECURE`, `COOKIE_SAMESITE` | Política do cookie de renovação; `none` exige `secure=true` |
| `MODEL_MAX_AGE_MONTHS` | Esconde modelos mais antigos que isso (0 desativa o filtro) |
| `BASE_SYSTEM_PROMPT` | Instrução base enviada ao modelo (`{persona}` é substituído) |
| `VITE_API_URL` | URL da API para o frontend; `/api` usa proxy do Vite em dev |

## Banco e backup

As tabelas são criadas por migrations Prisma em `apps/server/prisma/migrations`. O banco local fica no volume Docker `pgdata`. Para gerar um backup SQL:

```sh
docker compose exec -T db sh -c "pg_dump -U lucca llm_lucca > /tmp/backup.sql"
docker compose cp db:/tmp/backup.sql ./backup.sql
```

Para restaurar, copie o arquivo para o container e use `psql -U lucca -d llm_lucca -f /tmp/backup.sql`. Faça backup também do `.env` e de `storage/uploads`: o banco sozinho não contém os arquivos originais.

## Adicionar um provedor

1. Crie o adaptador em `apps/server/src/llm/providers/`. Se a API for compatível com OpenAI, basta uma instância de `OpenAiCompatible` com outra URL (veja `groq.ts`, 6 linhas). Senão, implemente `LLMProvider`: `listModels` em tempo real e `streamChat` como `async function*` que dá `yield` de `delta` e, no fim, de `usage` normalizado.
2. Registre em `llm/registry.ts`.
3. Inclua o identificador no schema de `modules/providers/routes.ts`.
4. Adicione testes de parsing e de uso em `src/tests`.

## Caminho de escala

Hoje tudo roda na sua máquina, mas cada ponto local está atrás de uma interface:

| Ponto | Agora | Depois |
|---|---|---|
| Auth | `AUTH_MODE=local` | `AUTH_MODE=multi` |
| Uploads | disco | S3/R2 (`StorageDriver`) |
| Cache de modelos | memória | Redis (`CacheStore`) |
| Parar geração | `Map` em memória | Redis pub/sub (`StreamRegistry`) |
| Banco | Postgres no Docker | Postgres gerenciado (só `DATABASE_URL`) |
| Frontend | Express serve o build | CDN / static site |

Os drivers S3 e Redis estão declarados e validam a configuração, mas **ainda lançam erro de "não implementado"**; implemente-os antes de usar essas opções em nuvem ou com várias instâncias. O guia completo está em [deploy/DEPLOY.md](deploy/DEPLOY.md) e o blueprint em `deploy/render.yaml`. Nenhum deploy é executado pelo setup.

## Testes

`npm test` roda testes unitários de criptografia, montagem de contexto, filtros de modelo, parsing SSE, normalização de uso, visão e pesquisa web. Os testes HTTP (rotas de auth e conversas) precisam de **um banco de teste isolado**: defina `TEST_DATABASE_URL` e rode `npm test`; sem a variável, eles são ignorados.

Para revisão visual, inicie `npm -w apps/web run preview` e rode `npm run qa:visual`. O script abre o frontend no Chrome, simula respostas da API e salva capturas em `docs/`; não substitui o teste com PostgreSQL e uma chave real. Use `QA_URL` se o frontend não estiver em `http://127.0.0.1:4173/`.
