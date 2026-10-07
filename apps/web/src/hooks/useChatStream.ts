import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, apiBase, authHeaders, json } from '../services/api';
import { readSse } from '../services/sse';
import { draftMessage, liveMessages, useChatStore } from '../stores/chatStore';
import { useUiStore } from '../stores/uiStore';
import type { Conversation, Usage } from '../types';
export function useChatStream() {
  const query = useQueryClient();
  const state = useChatStore();
  const toast = useUiStore((s) => s.showToast);
  const stream = useCallback(
    async (id: string, content?: string, model?: string, webSearch = false) => {
      state.start(content ?? null);
      const maxTokens = useUiStore.getState().maxTokens ?? undefined;
      try {
        const res = await fetch(
          `${apiBase}/chat/${id}/${content === undefined ? 'regenerate' : 'stream'}`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              ...authHeaders(),
            },
            body: json(
              content === undefined
                ? { webSearch, maxTokens }
                : { content, model, webSearch, maxTokens },
            ),
          },
        );
        await readSse(res, (event, data) => {
          if (event === 'delta')
            useChatStore.getState().append(String(data.text ?? ''));
          if (event === 'status')
            useChatStore.getState().setStatus(String(data.text ?? ''));
          if (event === 'usage')
            useChatStore.getState().setUsage(data as Usage);
          if (event === 'error')
            toast(String(data.message ?? 'Erro na geração'));
          if (event === 'title')
            query.invalidateQueries({ queryKey: ['conversations'] });
        });
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Erro na geração');
      } finally {
        // mantém na tela o que foi exibido até o recarregamento trazer o salvo
        const { draft, usage, pending } = useChatStore.getState();
        query.setQueryData<Conversation>(['conversation', id], (c) =>
          c && {
            ...c,
            messages: [
              ...liveMessages(c.messages ?? [], pending),
              ...(draft ? [draftMessage(draft, usage)] : []),
            ],
          },
        );
        state.clear();
        query.invalidateQueries({ queryKey: ['conversation', id] });
        query.invalidateQueries({ queryKey: ['conversations'] });
      }
    },
    [query, state, toast],
  );
  const stop = useCallback(async (id: string) => {
    await api(`/chat/${id}/stop`, { method: 'POST' });
  }, []);
  return { stream, stop };
}
