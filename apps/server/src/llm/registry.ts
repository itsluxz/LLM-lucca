import type { LLMProvider } from './types.js';
import { OpenAiCompatible } from './providers/openaiCompatible.js';
import { anthropic } from './providers/anthropic.js';
import { google } from './providers/google.js';
import { openai } from './providers/openai.js';
import { openrouter } from './providers/openrouter.js';
import { groq } from './providers/groq.js';
import { mistral } from './providers/mistral.js';
import { deepseek } from './providers/deepseek.js';
export const providers: Record<string, LLMProvider> = {
  openai,
  anthropic,
  google,
  openrouter,
  groq,
  mistral,
  deepseek,
  custom: new OpenAiCompatible(
    'custom',
    'Personalizado',
    'http://127.0.0.1:11434/v1',
  ),
};
export function resolveModel(id: string) {
  const at = id.indexOf(':');
  const provider = id.slice(0, at);
  const model = id.slice(at + 1);
  if (at < 1 || !model || !providers[provider])
    throw new Error('Modelo inválido');
  return { provider, model, adapter: providers[provider] };
}
