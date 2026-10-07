import { create } from 'zustand';
import type { Message, Usage } from '../types';
type State = {
  streaming: boolean;
  draft: string;
  usage: Usage | null;
  status: string | null;
  /** Pergunta enviada nesta geração; null em regenerar/editar. */
  pending: string | null;
  setStreaming: (value: boolean) => void;
  start: (pending?: string | null) => void;
  append: (text: string) => void;
  setUsage: (usage: Usage) => void;
  setStatus: (status: string | null) => void;
  clear: () => void;
};
export const useChatStore = create<State>((set) => ({
  streaming: false,
  draft: '',
  usage: null,
  status: null,
  pending: null,
  setStreaming: (streaming) => set({ streaming }),
  start: (pending = null) =>
    set({ streaming: true, draft: '', usage: null, status: null, pending }),
  append: (text) => set((s) => ({ draft: s.draft + text, status: null })),
  setUsage: (usage) => set({ usage }),
  setStatus: (status) => set({ status }),
  clear: () =>
    set({ streaming: false, draft: '', usage: null, status: null, pending: null }),
}));
export const draftMessage = (draft: string, usage: Usage | null): Message => ({
  id: 'streaming',
  role: 'assistant',
  content: draft,
  inputTokens: usage?.inputTokens ?? null,
  cachedTokens: usage?.cachedTokens ?? null,
  reasoningTokens: usage?.reasoningTokens ?? null,
  outputTokens: usage?.outputTokens ?? Math.ceil(draft.length / 4),
  usageSource: usage?.source ?? 'estimate',
});
/**
 * Mensagens salvas como devem aparecer durante a geração: com a pergunta
 * enviada (o cache só é recarregado no fim) e sem a resposta sendo regenerada.
 */
export function liveMessages(saved: Message[], pending: string | null): Message[] {
  const last = saved.at(-1);
  if (pending === null)
    return last?.role === 'assistant' ? saved.slice(0, -1) : saved;
  if (last?.role === 'user' && last.content === pending) return saved;
  return [
    ...saved,
    {
      id: 'pending',
      role: 'user',
      content: pending,
      inputTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
      outputTokens: null,
    },
  ];
}
