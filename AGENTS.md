# LLM — Lucca Language Model

> Documento de especificação para o Codex. Leia tudo antes de começar. Construa o projeto **completo**: frontend, backend e banco de dados.
>
> **Fase atual: execução local.** O projeto roda inteiro na máquina do Lucca com um único comando. Mas toda a arquitetura deve ser preparada para escalar depois (deploy em nuvem, múltiplos usuários, várias instâncias) **sem reescrever código**, apenas trocando variáveis de ambiente e implementações por trás de interfaces. Ver seção 2.1.

---

## 1. Visão geral

**LLM — Lucca Language Model** é um site de chat com IAs, no estilo do ChatGPT/Claude, em que o usuário conecta as APIs de vários provedores (OpenAI, Anthropic, Google, etc.) e escolhe qualquer modelo disponível para conversar.

Funcionalidades obrigatórias:

1. **Chat** com respostas em streaming (token a token), renderização de Markdown, blocos de código com destaque de sintaxe e botão de copiar.
2. **Seleção de modelo** por conversa: um seletor lista todos os modelos de todos os provedores configurados. É possível trocar de modelo no meio da conversa.
3. **Contador de tokens**: cada resposta mostra quantos tokens foram gastos em **entrada** (prompt + contexto), **processamento** (raciocínio/thinking do modelo) e **saída** (texto da resposta), além do total acumulado da conversa (seção 7.7).
4. **Conversas**: criar, listar (sidebar), renomear, fixar, buscar, excluir. Título gerado automaticamente a partir da primeira mensagem.
5. **Projetos**: pastas que agrupam conversas e possuem **instruções personalizadas** (system prompt do projeto) e **arquivos de conhecimento** (texto, .md, .pdf, .txt, código) que são injetados como contexto nas conversas do projeto.
6. **Configuração de provedores**: página onde o usuário cola as chaves de API de cada provedor; as chaves ficam criptografadas no banco. O backend busca a lista de modelos de cada provedor.
7. **Autenticação** com dois modos, controlados por `AUTH_MODE`:
   - `local` (padrão agora): usuário único criado automaticamente no primeiro start; o frontend entra direto, sem tela de login.
   - `multi` (futuro): cadastro/login com e-mail e senha (JWT), múltiplos usuários com dados isolados.
   O código de auth multiusuário deve ser implementado desde já; o modo `local` apenas o contorna. Todas as tabelas já têm `userId`.
8. **Mascote**: as imagens do mascote são a identidade visual do site (ver seção 8).
9. **Execução local com um comando** (`npm run dev` sobe banco, API e frontend), com o caminho de deploy em nuvem já documentado e preparado (seção 10).

---

## 2. Stack

**Monorepo** com duas aplicações:

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS + React Router + Zustand (estado) + TanStack Query (dados) |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-highlight` (ou `shiki`) + `rehype-katex` para fórmulas |
| Backend | Node.js 20 + Express + TypeScript |
| ORM / Banco | Prisma + PostgreSQL (Docker local agora; gerenciado na nuvem depois) |
| Auth | JWT (access token 15 min + refresh token 30 dias em cookie httpOnly), senha com `bcrypt` |
| Validação | `zod` no backend e no frontend |
| Streaming | Server-Sent Events (SSE) do backend para o frontend |
| Upload | `multer` + extração de texto (`pdf-parse` para PDF); arquivo original salvo via `StorageDriver` |
| Criptografia | AES-256-GCM (módulo `crypto` nativo) para as chaves de API |
| Segurança | `helmet`, `cors`, `express-rate-limit`, `cookie-parser` |
| Logs | `pino` + `pino-http` |

Gerenciador de pacotes: **npm** com workspaces. Postgres local via **Docker Compose** (o mesmo banco usado em produção, para não haver migração de SQLite depois). Execução paralela dos apps com `concurrently`.

### 2.1 Princípios para escalar depois

Tudo que hoje é local e simples fica atrás de uma interface, com a implementação escolhida por variável de ambiente:

| Ponto | Agora (local) | Depois (escala) | Interface |
|---|---|---|---|
| Autenticação | `AUTH_MODE=local`, usuário único | `AUTH_MODE=multi`, JWT | middleware `requireAuth` |
| Arquivos enviados | disco em `./storage/uploads` | S3 / Cloudflare R2 | `StorageDriver` (`put`, `get`, `delete`) em `lib/storage/` |
| Cache de modelos | memória | Redis | `CacheStore` (`get`, `set`, `del`) em `lib/cache/` |
| Rate limit | memória | Redis (`rate-limit-redis`) | configurado em `middlewares/rateLimit.ts` |
| Cancelar stream (stop) | `Map` em memória | Redis pub/sub entre instâncias | `StreamRegistry` em `lib/streams/` |
| Banco | Postgres no Docker | Postgres gerenciado (Render, Neon, Supabase) | só muda `DATABASE_URL` |
| Frontend | servido pelo Vite em dev; em produção local o Express serve `apps/web/dist` | static site/CDN separado | `SERVE_WEB=true/false` |

Regras que garantem isso:
- O backend é **stateless** fora dessas interfaces (nada de estado global além delas).
- Configuração só via `config/env.ts` validado com zod; nenhum valor fixo no código.
- Lógica de negócio nos `service`s, nunca nos controllers, para poder extrair workers ou filas no futuro.
- Migrations sempre pelo Prisma (`migrate dev` local, `migrate deploy` em produção).
- Endpoints versionáveis: prefixo `/api` centralizado em um único lugar.

---

## 3. Estrutura de pastas

```
llm-lucca/
├── AGENTS.md
├── README.md
├── docker-compose.yml           # Postgres local (e Redis comentado, para o futuro)
├── package.json                 # workspaces: ["apps/*"]; scripts dev/setup/start
├── .gitignore                   # inclui storage/ e .env
├── .env.example
├── scripts/setup.mjs            # primeira execução: .env, segredos, banco, migrations, seed
├── storage/                     # uploads locais (gitignored)
├── deploy/
│   ├── render.yaml              # Blueprint pronto para quando for subir
│   └── DEPLOY.md                # guia de escala
│
├── apps/
│   ├── server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── seed.ts
│   │   └── src/
│   │       ├── index.ts                 # bootstrap do Express
│   │       ├── app.ts                   # middlewares e rotas
│   │       ├── config/env.ts            # leitura/validação de env com zod
│   │       ├── lib/
│   │       │   ├── prisma.ts
│   │       │   ├── crypto.ts            # encrypt/decrypt AES-256-GCM
│   │       │   ├── jwt.ts
│   │       │   ├── logger.ts
│   │       │   ├── sse.ts               # helpers de SSE
│   │       │   ├── storage/             # StorageDriver: local.ts (agora), s3.ts (stub documentado)
│   │       │   ├── cache/               # CacheStore: memory.ts (agora), redis.ts (stub)
│   │       │   └── streams/             # StreamRegistry: memory.ts (agora), redis.ts (stub)
│   │       ├── middlewares/
│   │       │   ├── auth.ts              # requireAuth
│   │       │   ├── error.ts             # handler global
│   │       │   ├── rateLimit.ts
│   │       │   └── validate.ts          # valida body/params com zod
│   │       ├── modules/
│   │       │   ├── auth/        (routes, controller, service, schemas)
│   │       │   ├── users/
│   │       │   ├── providers/   # CRUD de chaves + listagem de modelos
│   │       │   ├── models/      # catálogo unificado de modelos
│   │       │   ├── conversations/
│   │       │   ├── messages/
│   │       │   ├── chat/        # endpoint de streaming
│   │       │   ├── projects/
│   │       │   └── files/       # upload e extração de texto
│   │       └── llm/
│   │           ├── types.ts             # interface LLMProvider
│   │           ├── registry.ts          # mapeia providerId -> adapter
│   │           ├── context.ts           # monta o contexto (system + projeto + histórico)
│   │           └── providers/
│   │               ├── openai.ts
│   │               ├── anthropic.ts
│   │               ├── google.ts
│   │               ├── openrouter.ts
│   │               ├── groq.ts
│   │               ├── mistral.ts
│   │               ├── deepseek.ts
│   │               └── openaiCompatible.ts   # qualquer endpoint compatível (Ollama, LM Studio, etc.)
│   │
│   └── web/
│       ├── package.json
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── index.html
│       ├── public/
│       │   ├── favicon.png                  # gerado a partir do mascote
│       │   └── mascot/
│       │       ├── mascot-idle.png
│       │       ├── mascot-thinking.png
│       │       ├── mascot-hello.png
│       │       └── mascot-wink.png
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── routes/                      # definição de rotas
│           ├── pages/
│           │   ├── LoginPage.tsx            # só aparece em AUTH_MODE=multi
│           │   ├── RegisterPage.tsx         # só aparece em AUTH_MODE=multi
│           │   ├── ChatPage.tsx             # /c/:conversationId e /  (nova conversa)
│           │   ├── ProjectsPage.tsx         # /projects
│           │   ├── ProjectPage.tsx          # /projects/:projectId
│           │   └── SettingsPage.tsx         # /settings (provedores, perfil, aparência)
│           ├── components/
│           │   ├── layout/   (Sidebar, Topbar, AppShell)
│           │   ├── chat/     (MessageList, MessageBubble, Composer, ModelPicker, StreamingIndicator, CodeBlock, TokenUsageBar, ConversationUsageChip, ContextMeter)
│           │   ├── projects/ (ProjectCard, ProjectInstructions, ProjectFiles)
│           │   ├── mascot/   (Mascot.tsx, MascotBubble.tsx)
│           │   └── ui/       (Button, Input, Modal, Dropdown, Toast, Tooltip)
│           ├── hooks/        (useChatStream, useAuth, useModels)
│           ├── stores/       (authStore, chatStore, uiStore)
│           ├── services/     (api.ts – fetch com refresh automático, sse.ts)
│           ├── styles/globals.css
│           └── types/
```

---

## 4. Banco de dados (Prisma)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String?          // nulo para o usuário criado em AUTH_MODE=local
  name          String?
  createdAt     DateTime @default(now())
  defaultModel  String?          // ex.: "openai:gpt-4o"
  systemPrompt  String?          // instruções globais do usuário
  providerKeys  ProviderKey[]
  projects      Project[]
  conversations Conversation[]
  refreshTokens RefreshToken[]
}

model RefreshToken {
  id        String   @id @default(cuid())
  userId    String
  tokenHash String   @unique
  expiresAt DateTime
  revokedAt DateTime?
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model ProviderKey {
  id           String   @id @default(cuid())
  userId       String
  provider     String           // "openai" | "anthropic" | "google" | "openrouter" | "groq" | "mistral" | "deepseek" | "custom"
  label        String?
  encryptedKey String           // AES-256-GCM: iv:authTag:ciphertext (base64)
  baseUrl      String?          // usado para "custom" (OpenAI-compatible)
  enabled      Boolean  @default(true)
  createdAt    DateTime @default(now())
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, provider, label])
}

model Project {
  id           String   @id @default(cuid())
  userId       String
  name         String
  description  String?
  instructions String?          // system prompt do projeto
  emoji        String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  files        ProjectFile[]
  conversations Conversation[]
}

model ProjectFile {
  id          String   @id @default(cuid())
  projectId   String
  filename    String
  mimeType    String
  sizeBytes   Int
  storageKey  String           // caminho do original no StorageDriver
  textContent String   @db.Text  // texto extraído, usado como contexto
  tokenEstimate Int
  createdAt   DateTime @default(now())
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model Conversation {
  id        String   @id @default(cuid())
  userId    String
  projectId String?
  title     String   @default("Nova conversa")
  model     String                // "provider:modelId"
  pinned    Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  project   Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)
  messages  Message[]
  @@index([userId, updatedAt])
}

model Message {
  id             String   @id @default(cuid())
  conversationId String
  role           String            // "user" | "assistant" | "system"
  content        String   @db.Text
  model          String?           // modelo que gerou a resposta
  inputTokens     Int?           // entrada: prompt + contexto enviados
  cachedTokens    Int?           // parte da entrada lida do cache do provedor, se informado
  reasoningTokens Int?           // processamento: raciocínio/thinking, se informado
  outputTokens    Int?           // saída: texto visível da resposta (sem o raciocínio)
  usageSource     String?        // "provider" (número oficial) | "estimate" (estimado localmente)
  durationMs      Int?           // tempo total da geração
  error          String?
  createdAt      DateTime @default(now())
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  @@index([conversationId, createdAt])
}
```

---

## 5. API do backend

Prefixo: `/api`. Todas as rotas, exceto auth e health, passam por `requireAuth`. Em `AUTH_MODE=multi` ele exige `Authorization: Bearer <accessToken>`; em `AUTH_MODE=local` injeta o usuário local automaticamente, e `/api/auth/register` e `/api/auth/login` respondem 404. Todo acesso a recurso verifica `userId` do dono.

**Saúde**
- `GET /api/health` → `{ ok: true, db: true }` (útil para Docker e futuros health checks)

**Auth**
- `POST /api/auth/register` `{ email, password, name }`
- `POST /api/auth/login` `{ email, password }` → `{ accessToken, user }` + cookie `refresh_token`
- `POST /api/auth/refresh` → novo access token (rotaciona o refresh)
- `POST /api/auth/logout`
- `GET  /api/auth/me`

**Usuário**
- `PATCH /api/users/me` `{ name, defaultModel, systemPrompt }`

**Provedores**
- `GET    /api/providers` → lista provedores suportados + quais o usuário configurou (nunca retorna a chave, só os 4 últimos caracteres)
- `POST   /api/providers` `{ provider, apiKey, label?, baseUrl? }` → valida a chave chamando o endpoint de modelos antes de salvar
- `PATCH  /api/providers/:id` `{ enabled, label, apiKey? }`
- `DELETE /api/providers/:id`

**Modelos**
- `GET /api/models` → catálogo unificado `[{ id: "anthropic:claude-...", provider, name, contextWindow?, supportsVision? }]`, com cache de 10 min por usuário via `CacheStore`

**Projetos**
- `GET/POST /api/projects`
- `GET/PATCH/DELETE /api/projects/:id`
- `POST   /api/projects/:id/files` (multipart, limite 10 MB por arquivo; aceitar .txt .md .pdf .json .csv e extensões de código)
- `DELETE /api/projects/:id/files/:fileId`

**Conversas**
- `GET  /api/conversations?projectId=&search=&cursor=` (paginação por cursor, ordenado por `pinned desc, updatedAt desc`)
- `POST /api/conversations` `{ model, projectId? }`
- `GET  /api/conversations/:id` (com mensagens e o objeto `usageTotals` somando entrada, processamento e saída de todas as respostas)
- `PATCH /api/conversations/:id` `{ title, pinned, model, projectId }`
- `DELETE /api/conversations/:id`

**Chat (streaming)**
- `POST /api/chat/:conversationId/stream` `{ content, model? }`
  1. Salva a mensagem do usuário.
  2. Monta o contexto (seção 6.3).
  3. Abre SSE e repassa os eventos do provedor.
  4. Ao terminar, salva a mensagem do assistente com os tokens de entrada, processamento e saída (seção 6.4) e envia o evento `usage`.
  5. Se for a primeira troca, gera o título (chamada curta ao mesmo modelo, ou primeiras ~6 palavras como fallback) e envia evento `title`.
- `POST /api/chat/:conversationId/regenerate` → apaga a última resposta do assistente e gera de novo
- `POST /api/chat/:conversationId/stop` → aborta o stream em andamento (o `AbortController` é registrado no `StreamRegistry` pela chave da conversa)
- Editar mensagem do usuário: `PATCH /api/messages/:id` apaga as mensagens posteriores e o frontend chama o stream de novo.

Formato dos eventos SSE:
```
event: delta     data: {"text":"..."}
event: usage     data: {"inputTokens":123,"cachedTokens":0,"reasoningTokens":80,"outputTokens":456,"source":"provider","durationMs":3200}
event: title     data: {"title":"..."}
event: done      data: {"messageId":"..."}
event: error     data: {"message":"..."}
```
Enviar `: ping` a cada 15 s para manter a conexão viva atrás de proxies (necessário quando for para a nuvem).

---

## 6. Camada de provedores de IA

### 6.1 Interface comum

```ts
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

export interface StreamParams {
  apiKey: string;
  baseUrl?: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null; // null = o provedor não separa o raciocínio
  outputTokens: number | null;
}

export interface LLMProvider {
  id: string;
  displayName: string;
  listModels(apiKey: string, baseUrl?: string): Promise<ModelInfo[]>;
  streamChat(params: StreamParams): AsyncIterable<
    { type: "delta"; text: string } |
    { type: "usage"; usage: TokenUsage }
  >;
}
```

### 6.2 Adaptadores

Implementar com `fetch` nativo e parsing de SSE manual (sem SDKs pesados, para facilitar manutenção), tratando as diferenças de cada API:

- **OpenAI** e todos os **compatíveis com OpenAI** (OpenRouter, Groq, Mistral, DeepSeek, custom/Ollama): `POST {baseUrl}/chat/completions` com `stream: true`; modelos em `GET {baseUrl}/models`. Criar um adaptador base reutilizável e os específicos só mudam `baseUrl` e filtros de modelo.
- **Anthropic**: `POST https://api.anthropic.com/v1/messages` com headers `x-api-key` e `anthropic-version`; o `system` vai separado do array de mensagens; eventos `content_block_delta` e `message_delta`; modelos em `GET /v1/models`.
- **Google Gemini**: `POST .../models/{model}:streamGenerateContent?alt=sse`; papel `assistant` vira `model`; system vai em `systemInstruction`; modelos em `GET .../models` filtrando os que suportam `generateContent`.

Não fixe nomes de modelos no código: sempre busque a lista na API do provedor. Erros do provedor (401, 429, 500) devem virar mensagens amigáveis no evento `error`.

### 6.3 Montagem do contexto (`llm/context.ts`)

Ordem do system prompt:
1. Prompt base do site: “Você é o assistente do LLM — Lucca Language Model…” (curto, configurável por env `BASE_SYSTEM_PROMPT`).
2. `user.systemPrompt` (instruções globais do usuário), se houver.
3. `project.instructions`, se a conversa pertence a um projeto.
4. Arquivos do projeto, cada um envolvido em `<documento nome="...">...</documento>`.

Depois, o histórico da conversa. Se a estimativa de tokens (≈ caracteres / 4) passar de 80% da janela do modelo, cortar as mensagens mais antigas primeiro (nunca as instruções nem a última mensagem do usuário).

### 6.4 Contagem de tokens por etapa

Cada adaptador deve extrair o uso **oficial** reportado pelo provedor e normalizar para `TokenUsage`:

| Provedor | Entrada | Processamento (raciocínio) | Saída |
|---|---|---|---|
| OpenAI e compatíveis | `usage.prompt_tokens` (enviar `stream_options: { include_usage: true }` para receber no último chunk); cache em `prompt_tokens_details.cached_tokens` | `completion_tokens_details.reasoning_tokens` | `completion_tokens` menos `reasoning_tokens` |
| Anthropic | `usage.input_tokens` do `message_start` (+ `cache_read_input_tokens`) | quando houver blocos `thinking`, estimar pelo texto dos `thinking_delta` | `output_tokens` do `message_delta` final menos o raciocínio estimado |
| Google Gemini | `usageMetadata.promptTokenCount` (cache em `cachedContentTokenCount`) | `usageMetadata.thoughtsTokenCount` | `usageMetadata.candidatesTokenCount` |

Regras:
- Saída = só o texto visível. O raciocínio nunca é contado duas vezes.
- Se o provedor não informar algum valor (comum em endpoints compatíveis/Ollama), estimar com `js-tiktoken` (ou caracteres ÷ 4 como último recurso) e marcar `usageSource = "estimate"`. Raciocínio não informado e não estimável fica `null`, e não 0.
- Se a geração for interrompida pelo “parar”, salvar o que já foi gerado com a saída estimada.
- Antes de enviar, o backend calcula a **estimativa de entrada** do contexto montado (6.3) e devolve no endpoint `POST /api/chat/:id/estimate` `{ content }` → `{ inputTokensEstimate, contextWindow }`, usado pelo composer.

---

## 7. Frontend

### 7.1 Layout
- **Sidebar** (recolhível; vira drawer no celular): logo com mascote + nome, botão “Nova conversa”, link “Projetos”, campo de busca, lista de conversas agrupadas (Fixadas, Hoje, Ontem, 7 dias, Mais antigas), menu do usuário no rodapé (Configurações, Sair).
- **Área principal**: topbar com `ModelPicker` e título da conversa; lista de mensagens; `Composer` fixo embaixo.

### 7.2 Chat
- `Composer`: textarea com auto-altura, Enter envia, Shift+Enter quebra linha, botão de parar durante o streaming, anexar arquivo (texto colado como contexto da mensagem).
- `MessageBubble`: Markdown completo, blocos de código com linguagem + botão copiar, ações por mensagem (copiar, editar mensagem do usuário, regenerar resposta), rótulo pequeno com o modelo usado.
- Auto-scroll para o fim, que pausa se o usuário rolar para cima.
- Estado vazio (nova conversa): mascote grande + saudação + 4 sugestões de prompt clicáveis.

### 7.3 ModelPicker
Dropdown com busca, agrupado por provedor, mostrando nome e janela de contexto. Último modelo usado vira o padrão. Se nenhum provedor estiver configurado, mostrar aviso com link para Configurações.

### 7.4 Projetos
- `/projects`: grade de cards (emoji, nome, descrição, nº de conversas).
- `/projects/:id`: coluna esquerda com conversas do projeto + botão “Nova conversa no projeto”; coluna direita com editor de instruções (salvar com debounce) e lista de arquivos (upload por drag-and-drop, tamanho, tokens estimados, excluir).

### 7.5 Configurações
Abas: **Provedores** (card por provedor: status, colar chave, testar, ativar/desativar, remover; para “custom” pedir baseUrl), **Perfil** (nome, instruções globais, modelo padrão), **Aparência** (tema escuro/claro, sempre escuro como padrão).

### 7.6 Comunicação com a API
- `services/api.ts`: wrapper de `fetch` que injeta o access token e, ao receber 401, chama `/auth/refresh` uma vez e repete a requisição.
- `hooks/useChatStream.ts`: usa `fetch` + `ReadableStream` para ler o SSE do POST (o `EventSource` nativo não aceita POST), atualiza o `chatStore` a cada delta.
- URL da API via `VITE_API_URL` (padrão `/api`, com proxy do Vite em dev).
- No início, o frontend chama `GET /api/auth/me`; a resposta inclui `authMode`, e em `local` o app pula login/cadastro e esconde “Sair”.

### 7.7 Exibição de tokens

- **Em cada resposta do assistente**, abaixo do texto, uma linha discreta com ícones:
  `↓ Entrada 1.234 · ⚙ Processamento 380 · ↑ Saída 512 · Σ 2.126 · 3,2 s`
  Valores com separador de milhar pt-BR. Processamento aparece como “—” quando o modelo não informa raciocínio. Valores estimados levam “≈” na frente e um tooltip explicando que o provedor não informou o número oficial. Cachê de entrada aparece no tooltip da entrada (“1.000 lidos do cache”).
- **Durante o streaming**, a saída conta ao vivo (estimada pelos deltas) e é substituída pelo valor oficial quando chega o evento `usage`.
- **No topo da conversa** (ao lado do `ModelPicker`), um chip com o total da conversa; ao clicar, abre um painel com entrada, processamento e saída somados, número de respostas e uma barra empilhada mostrando a proporção das três etapas (cores: entrada `--primary`, processamento `--star`, saída `--accent`).
- **No composer**, um contador cinza mostra a estimativa de entrada da próxima mensagem (contexto + texto digitado, com debounce de 400 ms) e a porcentagem da janela de contexto do modelo; fica amarelo acima de 70% e vermelho acima de 90%.
- Configuração em **Aparência**: mostrar/ocultar a linha de tokens nas mensagens (padrão: mostrar).
- Componentes: `TokenUsageBar.tsx` (linha da mensagem), `ConversationUsageChip.tsx` (chip + painel), `ContextMeter.tsx` (composer).

---

## 8. Mascote e identidade visual

O mascote é a “persona” do site. São 4 imagens em pixel art (500×500, fundo transparente). Salvar em `apps/web/public/mascot/` com estes nomes e usos:

| Arquivo | Pose | Onde usar |
|---|---|---|
| `mascot-hello.png` | segurando microfone e apontando, animada | Estado vazio da nova conversa, tela de login/cadastro (boas-vindas) |
| `mascot-thinking.png` | mãos no rosto, pensativa | Indicador enquanto a IA está gerando (substitui o “digitando…”) |
| `mascot-wink.png` | piscando e fazendo sinal de paz | Toasts de sucesso (chave salva, projeto criado), página 404 amigável |
| `mascot-idle.png` | olhando em frente, neutra | Avatar das mensagens do assistente, logo na sidebar, favicon, estados de erro |

Componente `Mascot.tsx`:
```tsx
type MascotMood = "hello" | "thinking" | "wink" | "idle";
<Mascot mood="thinking" size={48} animated />
```
- Sempre aplicar `image-rendering: pixelated` para manter o pixel art nítido.
- Animações leves com CSS: flutuar (translateY 4px, 3 s) no estado vazio; balançar suave no “thinking”; respeitar `prefers-reduced-motion`.
- `MascotBubble`: balão de fala ao lado do mascote para mensagens curtas (ex.: “Escolha um modelo pra começar!”).

**Paleta** (extraída do mascote), definida como variáveis CSS e no Tailwind:
```
--bg:          #14101f   (fundo escuro arroxeado)
--surface:     #1e1830
--surface-2:   #2a2142
--primary:     #7b3fe4   (roxo do cabelo)
--primary-2:   #b44de8   (roxo-rosado)
--accent:      #e8336e   (rosa do laço)
--star:        #f5c542   (amarelo das estrelas)
--text:        #f3eefc
--text-muted:  #a99cc4
```
Tema claro: fundo `#faf7ff`, superfícies brancas, mesmos tons de destaque.

**Tipografia**: `Inter` para o texto; `Silkscreen` ou `Press Start 2P` (Google Fonts) só no logotipo “LLM” e em títulos curtos, combinando com o pixel art. Detalhes decorativos: pequenas estrelas ✦ e coração em pixel na tela de login.

**Logotipo**: “LLM” em fonte pixel com degradê `--primary → --accent`, e abaixo “Lucca Language Model” em Inter, ao lado do `mascot-idle`.

---

## 9. Segurança

- Chaves de API criptografadas com AES-256-GCM usando `ENCRYPTION_KEY` (32 bytes em base64). Nunca logar nem retornar a chave completa.
- Senhas com bcrypt (custo 12). Refresh tokens salvos como hash SHA-256 e rotacionados a cada uso.
- Cookie de refresh: `httpOnly`, `sameSite: "lax"` localmente; em produção com domínios separados, `secure` + `sameSite: "none"` (definido por env).
- CORS restrito a `CLIENT_URL`, com `credentials: true`.
- No modo `local`, o servidor escuta apenas em `127.0.0.1` por padrão (`HOST` configurável), para não expor as chaves na rede.
- Rate limit: 10 req/min em auth, 30 req/min no chat por usuário.
- Toda query filtra por `userId`. Validar todos os inputs com zod.
- Limitar tamanho de body (2 MB JSON) e de upload (10 MB).

---

## 10. Execução local e caminho de escala

### 10.1 Rodar localmente (fase atual)

Requisitos: Node.js 20+, Docker Desktop.

`docker-compose.yml` na raiz:
```yaml
services:
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: lucca
      POSTGRES_PASSWORD: lucca
      POSTGRES_DB: llm_lucca
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  # redis:                      # habilitar quando for escalar
  #   image: redis:7
  #   ports: ["6379:6379"]
volumes:
  pgdata:
```

Scripts do `package.json` raiz:
```json
"scripts": {
  "setup": "node scripts/setup.mjs",
  "dev": "docker compose up -d db && concurrently -n api,web \"npm -w apps/server run dev\" \"npm -w apps/web run dev\"",
  "build": "npm -w apps/web run build && npm -w apps/server run build",
  "start": "docker compose up -d db && npm -w apps/server run start",
  "db:migrate": "npm -w apps/server run db:migrate",
  "db:studio": "npm -w apps/server exec prisma studio"
}
```

`scripts/setup.mjs` (primeira execução): copia `.env.example` para `.env` se não existir, **gera automaticamente** `ENCRYPTION_KEY` e os segredos JWT, cria `storage/uploads`, sobe o banco, roda `prisma migrate dev` e o seed (que cria o usuário local).

Fluxo do Lucca:
```
npm install
npm run setup     # só na primeira vez
npm run dev       # abre http://localhost:5173
```
`npm run build && npm start` roda a versão de produção local em um único processo: o Express serve a API em `/api` e o frontend buildado (`SERVE_WEB=true`) em `http://localhost:3000`.

Scripts do servidor:
```json
"scripts": {
  "dev": "tsx watch src/index.ts",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/index.js",
  "db:migrate": "prisma migrate dev",
  "db:deploy": "prisma migrate deploy",
  "db:seed": "tsx prisma/seed.ts"
}
```
O servidor escuta em `HOST`:`PORT`.

### 10.2 `.env.example`
```
# geral
NODE_ENV=development
AUTH_MODE=local                 # local | multi
HOST=127.0.0.1
PORT=3000
SERVE_WEB=false                 # true no "npm start" local
CLIENT_URL=http://localhost:5173

# banco
DATABASE_URL=postgresql://lucca:lucca@localhost:5432/llm_lucca

# segredos (gerados pelo npm run setup)
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
ENCRYPTION_KEY=

# drivers plugáveis
STORAGE_DRIVER=local            # local | s3
STORAGE_LOCAL_PATH=./storage/uploads
CACHE_DRIVER=memory             # memory | redis
STREAM_REGISTRY_DRIVER=memory   # memory | redis
REDIS_URL=
S3_BUCKET=
S3_REGION=
S3_ENDPOINT=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=

# cookies (produção com domínios separados)
COOKIE_SECURE=false
COOKIE_SAMESITE=lax

BASE_SYSTEM_PROMPT=

# web
VITE_API_URL=/api               # em dev o Vite faz proxy de /api para localhost:3000
```
O `config/env.ts` deve recusar combinações inválidas (ex.: `STORAGE_DRIVER=s3` sem `S3_BUCKET`, `CACHE_DRIVER=redis` sem `REDIS_URL`) com mensagem clara.

### 10.3 Caminho de escala (documentar em `deploy/DEPLOY.md`, não executar agora)

**Etapa 1 – Uso pessoal na nuvem:** um único serviço no Render (ou Railway/Fly) rodando `npm run build && npm start` com `SERVE_WEB=true`, Postgres gerenciado, `AUTH_MODE=multi`, `HOST=0.0.0.0`, `COOKIE_SECURE=true`. Mesmo domínio, então `sameSite=lax` continua funcionando.

**Etapa 2 – Vários usuários:** frontend como static site/CDN separado, `COOKIE_SAMESITE=none`, `STORAGE_DRIVER=s3` (R2/S3) porque o disco do servidor é efêmero, Redis para cache e rate limit.

**Etapa 3 – Várias instâncias:** `STREAM_REGISTRY_DRIVER=redis` para que o “parar geração” funcione em qualquer instância; considerar fila (BullMQ) para tarefas pesadas como extração de PDF e geração de título; busca vetorial (pgvector) nos arquivos de projeto quando o contexto ficar grande.

`deploy/render.yaml` já deve vir pronto para a Etapa 1:
```yaml
databases:
  - name: llm-lucca-db
    plan: free
    databaseName: llm_lucca
    user: llm_lucca

services:
  - type: web
    name: llm-lucca
    runtime: node
    plan: free
    buildCommand: npm install && npm -w apps/server exec prisma generate && npm run build
    preDeployCommand: npm -w apps/server run db:deploy
    startCommand: npm -w apps/server run start
    healthCheckPath: /api/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: AUTH_MODE
        value: multi
      - key: HOST
        value: 0.0.0.0
      - key: SERVE_WEB
        value: "true"
      - key: COOKIE_SECURE
        value: "true"
      - key: DATABASE_URL
        fromDatabase: { name: llm-lucca-db, property: connectionString }
      - key: JWT_ACCESS_SECRET
        generateValue: true
      - key: JWT_REFRESH_SECRET
        generateValue: true
      - key: ENCRYPTION_KEY
        sync: false        # openssl rand -base64 32 (guardar: sem ela as chaves salvas ficam ilegíveis)
      - key: CLIENT_URL
        sync: false
```

### 10.4 README
Escrever um README com: requisitos, instalação local em 3 comandos, explicação de cada variável de ambiente, como fazer backup do banco local (`pg_dump` via Docker), como adicionar um novo provedor de IA, e um resumo do caminho de escala apontando para `deploy/DEPLOY.md`.

---

## 11. Ordem de implementação

1. Monorepo, configs de TypeScript, ESLint e Prettier.
2. Backend: env, Prisma schema + primeira migration, auth completa (modos `local` e `multi`), interfaces `StorageDriver`, `CacheStore` e `StreamRegistry` com as implementações locais.
3. Provedores: criptografia, CRUD de chaves, adaptadores OpenAI-compatível, Anthropic e Gemini, `GET /models`.
4. Conversas, mensagens e endpoint de chat com SSE (stop, regenerate, título automático), com extração de tokens por etapa em todos os adaptadores.
5. Projetos e upload de arquivos com extração de texto e injeção no contexto.
6. Frontend: shell, auth, sidebar, chat com streaming, ModelPicker.
7. Projetos e Configurações no frontend.
8. Mascote, tema, animações, responsividade e estados vazios/erro.
9. `docker-compose.yml`, `scripts/setup.mjs`, README; por último `deploy/render.yaml` e `deploy/DEPLOY.md` (preparados, não executados).
10. Testes: unitários para `crypto`, `context`, parsers de SSE dos adaptadores e normalização de `TokenUsage` de cada provedor (Vitest); teste de integração das rotas de auth e conversas (Supertest).

## 12. Critérios de aceite

- Com `npm install`, `npm run setup` e `npm run dev` o site abre em localhost já logado, sem configurar nada à mão.
- Colo uma chave de qualquer provedor suportado e vejo os modelos dele no seletor.
- Converso com streaming, paro a geração, regenero e edito mensagens; tudo fica salvo e reaparece após recarregar.
- Cada resposta mostra tokens de entrada, processamento e saída (oficiais quando o provedor informa, marcados com ≈ quando estimados), e a conversa mostra o total acumulado.
- Crio um projeto com instruções e arquivos, e as conversas dele usam esse contexto.
- O mascote aparece nos estados corretos (boas-vindas, pensando, sucesso, avatar).
- Funciona bem no celular.
- Trocar `AUTH_MODE` para `multi` habilita login/cadastro sem mudar código.
- Trocar `STORAGE_DRIVER`, `CACHE_DRIVER` e `STREAM_REGISTRY_DRIVER` só exige variáveis de ambiente (os drivers `s3`/`redis` podem ser stubs bem documentados que lançam erro claro de “não implementado”).

## 13. Regras para o Codex

- Código em TypeScript estrito, sem `any` desnecessário.
- Textos da interface em **português do Brasil**.
- Não deixar TODOs no lugar de funcionalidades obrigatórias.
- Não commitar `.env` nem chaves.
- Ao terminar cada etapa da seção 11, garantir que `npm run build` passa nos dois apps.
