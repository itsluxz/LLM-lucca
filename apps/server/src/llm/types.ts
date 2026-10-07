export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Imagens anexadas pelo usuário (visão), já em base64. */
  images?: ImageInput[];
}
export interface ImageInput {
  mimeType: string;
  /** Conteúdo em base64, sem o prefixo data: */
  data: string;
}
export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  contextWindow?: number;
  supportsVision?: boolean;
  supportsWebSearch?: boolean;
  kind?: 'chat' | 'image';
  /** Data de lançamento informada pelo provedor (ms), quando houver. */
  createdAt?: number;
}
export interface ImageParams {
  apiKey: string;
  baseUrl?: string;
  model: string;
  prompt: string;
  /** Imagens de referência: quando houver, a imagem é editada em vez de criada do zero. */
  images?: ImageInput[];
  signal: AbortSignal;
}
export interface ImageResult {
  data: Buffer;
  mimeType: string;
  revisedPrompt?: string;
  usage: TokenUsage | null;
}
export interface TokenUsage {
  inputTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  outputTokens: number | null;
}
/** Ferramenta (extensão) que o modelo pode chamar; executada no servidor. */
export interface ToolSpec {
  name: string;
  /** Texto curto mostrado ao usuário enquanto a ferramenta roda. */
  label: string;
  description: string;
  /** JSON Schema simples (object/properties/required), aceito pelos três formatos. */
  parameters: Record<string, unknown>;
}
export interface StreamParams {
  apiKey: string;
  baseUrl?: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  webSearch?: boolean;
  tools?: ToolSpec[];
  /** Executa a ferramenta pedida pelo modelo; recebe os argumentos em JSON. */
  runTool?: (name: string, args: string) => Promise<string>;
  signal: AbortSignal;
}
export interface WebSource {
  url: string;
  title?: string;
}
export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'status'; text: string }
  | { type: 'source'; source: WebSource };
export interface LLMProvider {
  id: string;
  displayName: string;
  /** Provedor oferece pesquisa na web nativa (StreamParams.webSearch). */
  supportsWebSearch?: boolean;
  /** Modelo gera imagens em vez de texto (usa generateImage). */
  isImageModel?(model: string): boolean;
  generateImage?(params: ImageParams): Promise<ImageResult>;
  listModels(apiKey: string, baseUrl?: string): Promise<ModelInfo[]>;
  streamChat(params: StreamParams): AsyncIterable<StreamEvent>;
}
