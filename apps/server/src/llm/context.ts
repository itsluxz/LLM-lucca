import type { ChatMessage } from './types.js';
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
export function buildContext(input: {
  base: string;
  user?: string | null;
  project?: string | null;
  files?: Array<{ filename: string; textContent: string }>;
  history: ChatMessage[];
  contextWindow?: number;
}): ChatMessage[] {
  const system = [
    input.base,
    input.user,
    input.project,
    ...(input.files ?? []).map(
      (f) =>
        `<documento nome="${f.filename.replaceAll('"', '&quot;')}">\n${f.textContent}\n</documento>`,
    ),
  ]
    .filter(Boolean)
    .join('\n\n');
  const history = [...input.history];
  const limit = Math.floor((input.contextWindow ?? 128000) * 0.8);
  while (
    history.length > 1 &&
    estimateTokens(system + history.map((m) => m.content).join('')) > limit
  )
    history.shift();
  return [{ role: 'system', content: system }, ...history];
}
