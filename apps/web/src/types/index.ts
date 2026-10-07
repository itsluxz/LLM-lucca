export type User = {
  id: string;
  email: string;
  name: string | null;
  defaultModel: string | null;
  systemPrompt: string | null;
  avatar: string | null;
  personaName: string | null;
  colorTheme: ColorTheme | null;
  personaImages: Partial<Record<MascotMood, string>>;
};
export type MascotMood = 'hello' | 'thinking' | 'wink' | 'idle';
export type ColorTheme =
  | 'roxo'
  | 'rosa'
  | 'azul'
  | 'verde'
  | 'laranja'
  | 'vermelho';
export type Profile = Pick<
  User,
  'id' | 'name' | 'avatar' | 'personaName' | 'colorTheme'
>;
export type Model = {
  id: string;
  provider: string;
  name: string;
  contextWindow?: number;
  supportsVision?: boolean;
  supportsWebSearch?: boolean;
  kind?: 'chat' | 'image';
};
export type Usage = {
  inputTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  outputTokens: number | null;
  usageSource?: string;
  source?: string;
  durationMs?: number | null;
};
export type Message = Usage & {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string | null;
  createdAt?: string;
  error?: string | null;
};
export type Conversation = {
  id: string;
  title: string;
  model: string;
  projectId?: string | null;
  pinned: boolean;
  updatedAt: string;
  messages?: Message[];
  usageTotals?: {
    inputTokens: number;
    reasoningTokens: number;
    outputTokens: number;
    responses: number;
  };
};
export type Project = {
  id: string;
  name: string;
  emoji?: string | null;
  description?: string | null;
  instructions?: string | null;
  _count?: { conversations: number; files: number };
  files?: Array<{
    id: string;
    filename: string;
    sizeBytes: number;
    tokenEstimate: number;
  }>;
};
export type ProviderKey = {
  id: string;
  provider: string;
  label: string;
  last4: string;
  enabled: boolean;
  baseUrl?: string | null;
};
export type ToolInfo = {
  id: string;
  title: string;
  description: string;
};
