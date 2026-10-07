import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { Copy, FileText, Pencil, RotateCcw, Send } from 'lucide-react';
import {
  describeSize,
  splitAttachments,
  withAttachments,
} from '../../utils/attachments';
import type { Message } from '../../types';
import { Mascot } from '../mascot/Mascot';
import { TokenUsageBar } from './TokenUsageBar';
import { GeneratedImage, generatedImagePrefix } from './GeneratedImage';
import { Avatar } from '../layout/ProfileSwitcher';
import { useAuthStore, usePersonaName } from '../../stores/authStore';
export function MessageBubble({
  message,
  onEdit,
  onRegenerate,
}: {
  message: Message;
  onEdit?: (id: string, text: string) => void;
  onRegenerate?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  // anexos só existem nas mensagens do usuário; as respostas ficam intactas
  const { text: visibleText, files, images } =
    message.role === 'user'
      ? splitAttachments(message.content)
      : { text: message.content, files: [], images: [] };
  const [text, setText] = useState(visibleText);
  const personaName = usePersonaName();
  const user = useAuthStore((s) => s.user);
  return (
    <article className={`message ${message.role}`}>
      <div className="message-avatar">
        {message.role === 'assistant' ? (
          <Mascot mood="idle" size={38} />
        ) : user?.avatar ? (
          <Avatar profile={user} size={38} />
        ) : (
          <span>Você</span>
        )}
      </div>
      <div className="message-content">
        <div className="message-meta">
          {message.role === 'assistant' ? personaName : user?.name || 'Você'}
          {message.model && <small>{message.model}</small>}
        </div>
        {editing ? (
          <div className="edit-box">
            <textarea value={text} onChange={(e) => setText(e.target.value)} />
            <button
              onClick={() => {
                onEdit?.(message.id, withAttachments(text, files, images));
                setEditing(false);
              }}
            >
              <Send size={15} /> Salvar e enviar
            </button>
            <button onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        ) : (
          <>
          {images.length > 0 && (
            <div className="sent-images">
              {images.map((img, i) => (
                <GeneratedImage
                  key={`${img.url}-${i}`}
                  src={img.url}
                  alt={img.name}
                  compact
                />
              ))}
            </div>
          )}
          {files.length > 0 && (
            <div className="attachment-chips sent">
              {files.map((f, i) => (
                <details className="attachment-chip" key={`${f.name}-${i}`}>
                  <summary>
                    <FileText size={15} />
                    <span>
                      <strong>{f.name}</strong>
                      <small>{describeSize(f.content)}</small>
                    </span>
                  </summary>
                  <pre>{f.content}</pre>
                </details>
              ))}
            </div>
          )}
          {visibleText && (
          <div className="markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeHighlight, rehypeKatex]}
              components={{
                img({ src, alt }) {
                  if (typeof src === 'string' && src.startsWith(generatedImagePrefix))
                    return <GeneratedImage src={src} alt={alt} />;
                  return <img src={src} alt={alt} />;
                },
                code(props) {
                  const { children, className, ...rest } = props;
                  return (
                    <code className={className} {...rest}>
                      {children}
                    </code>
                  );
                },
                pre(props) {
                  const text = String(
                    (props.children as { props?: { children?: string } })?.props
                      ?.children ?? '',
                  );
                  return (
                    <div className="code-block">
                      <button
                        onClick={() => navigator.clipboard.writeText(text)}
                      >
                        <Copy size={14} /> Copiar código
                      </button>
                      <pre>{props.children}</pre>
                    </div>
                  );
                },
              }}
            >
              {visibleText}
            </ReactMarkdown>
          </div>
          )}
          </>
        )}
        {message.error && <p className="message-error">{message.error}</p>}
        {message.role === 'assistant' && <TokenUsageBar usage={message} />}
        <div className="message-actions">
          <button
            title="Copiar"
            onClick={() => navigator.clipboard.writeText(visibleText)}
          >
            <Copy size={15} />
          </button>
          {message.role === 'user' && onEdit && (
            <button title="Editar" onClick={() => setEditing(true)}>
              <Pencil size={15} />
            </button>
          )}
          {message.role === 'assistant' && onRegenerate && (
            <button title="Regenerar" onClick={onRegenerate}>
              <RotateCcw size={15} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
