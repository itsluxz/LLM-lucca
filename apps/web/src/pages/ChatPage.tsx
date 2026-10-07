import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowDown, FileText, Pencil, Lightbulb, Code2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api, json } from '../services/api';
import { useModels } from '../hooks/useModels';
import { useChatStream } from '../hooks/useChatStream';
import { useChatStore, draftMessage, liveMessages } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { useUiStore } from '../stores/uiStore';
import type { Conversation, User } from '../types';
import { ModelPicker } from '../components/chat/ModelPicker';
import { ConversationUsageChip } from '../components/chat/ConversationUsageChip';
import { Composer } from '../components/chat/Composer';
import { Mascot } from '../components/mascot/Mascot';
const MessageBubble = lazy(async () => ({
  default: (await import('../components/chat/MessageBubble')).MessageBubble,
}));
const suggestions = [
  [
    'Explicar um conceito',
    'Me explique um conceito difícil em linguagem simples',
  ],
  ['Escrever um texto', 'Me ajude a escrever um texto claro e envolvente'],
  ['Gerar ideias', 'Vamos criar ideias para um projeto novo'],
  ['Ajudar com código', 'Me ajude a revisar e melhorar este código'],
];
export default function ChatPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const query = useQueryClient();
  const { data: models = [] } = useModels();
  const user = useAuthStore((s) => s.user);
  const [model, setModel] = useState('');
  const { stream, stop } = useChatStream();
  const { streaming, draft, usage, status, pending } = useChatStore();
  const toast = useUiStore((s) => s.showToast);
  const webSearchPref = useUiStore((s) => s.webSearch);
  const setWebSearch = useUiStore((s) => s.setWebSearch);
  const webSearchAvailable = Boolean(
    models.find((m) => m.id === model)?.supportsWebSearch,
  );
  const webSearch = webSearchAvailable && webSearchPref;
  const scroll = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  const { data: conversation } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api<Conversation>(`/conversations/${conversationId}`),
    enabled: !!conversationId,
  });
  useEffect(() => {
    setModel(conversation?.model || user?.defaultModel || models[0]?.id || '');
  }, [conversation?.model, user?.defaultModel, models]);
  useEffect(() => {
    // outra conversa abre sempre no fim
    stick.current = true;
    setAwayFromEnd(false);
  }, [conversationId]);
  useEffect(() => {
    if (stick.current)
      scroll.current?.scrollTo({
        top: scroll.current.scrollHeight,
        behavior: 'smooth',
      });
  }, [conversation?.messages, draft]);
  const send = async (text: string) => {
    try {
      if (!model) {
        toast('Configure um provedor e escolha um modelo');
        return;
      }
      let id = conversationId;
      if (!id) {
        const created = await api<Conversation>('/conversations', {
          method: 'POST',
          body: json({ model }),
        });
        id = created.id;
        navigate(`/c/${id}`);
      }
      await stream(id, text, model, webSearch);
      if (user?.defaultModel !== model) {
        const updated = await api<User>('/users/me', {
          method: 'PATCH',
          body: json({ defaultModel: model }),
        }).catch(() => null);
        if (updated)
          useAuthStore
            .getState()
            .setSession(updated, useAuthStore.getState().mode ?? 'local');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não foi possível enviar');
    }
  };
  const regenerate = async () => {
    if (conversationId)
      await stream(conversationId, undefined, undefined, webSearch);
  };
  const edit = async (id: string, content: string) => {
    if (!conversationId) return;
    try {
      await api(`/messages/${id}`, {
        method: 'PATCH',
        body: json({ content }),
      });
      // o servidor apaga as mensagens posteriores à editada
      query.setQueryData<Conversation>(
        ['conversation', conversationId],
        (c) => {
          const list = c?.messages ?? [];
          const i = list.findIndex((m) => m.id === id);
          return c && i >= 0
            ? { ...c, messages: [...list.slice(0, i), { ...list[i], content }] }
            : c;
        },
      );
      await stream(conversationId, undefined, undefined, webSearch);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro ao editar');
    }
  };
  const changeModel = async (id: string) => {
    try {
      const u = await api<User>('/users/me', {
        method: 'PATCH',
        body: json({ defaultModel: id }),
      });
      if (conversationId)
        await api(`/conversations/${conversationId}`, {
          method: 'PATCH',
          body: json({ model: id }),
        });
      setModel(id);
      useAuthStore
        .getState()
        .setSession(u, useAuthStore.getState().mode ?? 'local');
      query.invalidateQueries({ queryKey: ['conversation', conversationId] });
    } catch (e) {
      toast(
        e instanceof Error ? e.message : 'Não foi possível trocar o modelo',
      );
    }
  };
  const saved = conversation?.messages ?? [];
  const messages = streaming ? liveMessages(saved, pending) : saved;
  return (
    <div className="chat-page">
      <header className="topbar">
        <ModelPicker value={model} onChange={changeModel} />
        <span className="top-title">
          {conversation?.title ?? 'Nova conversa'}
        </span>
        <ConversationUsageChip totals={conversation?.usageTotals} />
      </header>
      <div className="messages-area">
        <div
          className="messages-scroll"
          ref={scroll}
          onScroll={(e) => {
            const el = e.currentTarget;
            const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
            stick.current = distance < 120;
            setAwayFromEnd(distance > 400);
          }}
        >
          {messages.length === 0 && !streaming ? (
            <div className="welcome">
              <Mascot mood="hello" size={225} animated />
              <h1>Oi! Como posso ajudar?</h1>
              <p>
                Sua parceira de raciocínio, escrita, aprendizado e criação.
                <br />O que você gostaria de explorar hoje?
              </p>
              <div className="suggestions">
                {suggestions.map(([title, prompt], i) => (
                  <button key={title} onClick={() => send(prompt)}>
                    <strong className={`suggestion-icon icon-${i}`}>
                      {
                        [
                          <FileText size={27} />,
                          <Pencil size={27} />,
                          <Lightbulb size={27} />,
                          <Code2 size={27} />,
                        ][i]
                      }
                    </strong>
                    <b>{title}</b>
                    <small>{prompt}</small>
                    <span>↗</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages-inner">
              <Suspense fallback={null}>
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    onEdit={streaming ? undefined : edit}
                    onRegenerate={
                      m.id === messages[messages.length - 1]?.id && !streaming
                        ? regenerate
                        : undefined
                    }
                  />
                ))}
                {streaming && draft && (
                  <MessageBubble message={draftMessage(draft, usage)} />
                )}
              </Suspense>
              {streaming && (!draft || status) && (
                <div className="thinking">
                  <Mascot mood="thinking" size={46} animated />
                  {status ?? 'Pensando...'}
                </div>
              )}
            </div>
          )}
        </div>
        {awayFromEnd && messages.length > 0 && (
          <button
            className="scroll-to-latest"
            title="Ir para a mensagem mais recente"
            aria-label="Ir para a mensagem mais recente"
            onClick={() => {
              stick.current = true;
              scroll.current?.scrollTo({
                top: scroll.current.scrollHeight,
                behavior: 'smooth',
              });
            }}
          >
            <ArrowDown size={20} />
          </button>
        )}
      </div>
      <Composer
        conversationId={conversationId}
        streaming={streaming}
        webSearch={webSearch}
        webSearchAvailable={webSearchAvailable}
        onToggleWebSearch={() => setWebSearch(!webSearchPref)}
        imageMode={models.find((m) => m.id === model)?.kind === 'image'}
        onSend={send}
        onStop={() => conversationId && stop(conversationId)}
      />
    </div>
  );
}
