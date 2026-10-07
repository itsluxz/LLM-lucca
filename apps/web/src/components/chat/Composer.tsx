import { useEffect, useRef, useState } from 'react';
import { FileText, Globe, Paperclip, Send, Square, X } from 'lucide-react';
import { api, json } from '../../services/api';
import { useUiStore } from '../../stores/uiStore';
import {
  describeSize,
  withAttachments,
  type Attachment,
} from '../../utils/attachments';
import { ContextMeter } from './ContextMeter';
import { MaxTokensButton } from './MaxTokensButton';
type PendingImage = { id: string; name: string; preview: string; url?: string };
const maxImageSide = 2048;
const maxImageBytes = 4 * 1024 * 1024;
/**
 * Mantém a imagem original quando já é pequena; senão reduz para 2048 px no
 * lado maior em JPEG (os provedores limitam o tamanho de cada imagem).
 */
async function prepareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxImageSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= maxImageBytes) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível processar a imagem');
  ctx.fillStyle = '#fff'; // JPEG não tem transparência
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao comprimir a imagem'))),
      'image/jpeg',
      0.88,
    ),
  );
}
/** Limites do backend: 200 mil caracteres por mensagem. */
const maxMessageChars = 200_000;
const maxFileChars = 150_000;
export function Composer({
  conversationId,
  streaming,
  webSearch,
  webSearchAvailable,
  onToggleWebSearch,
  imageMode = false,
  onSend,
  onStop,
}: {
  imageMode?: boolean;
  conversationId?: string;
  streaming: boolean;
  webSearch: boolean;
  webSearchAvailable: boolean;
  onToggleWebSearch: () => void;
  onSend: (v: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [images, setImages] = useState<PendingImage[]>([]);
  const toast = useUiStore((s) => s.showToast);
  const uploading = images.some((i) => !i.url);
  const [estimate, setEstimate] = useState({
    inputTokensEstimate: 0,
    contextWindow: 128000,
  });
  const file = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const message = withAttachments(
    text,
    files,
    images.flatMap((i) => (i.url ? [{ name: i.name, url: i.url }] : [])),
  );
  useEffect(() => {
    if (!conversationId) return;
    const timer = setTimeout(() => {
      api<typeof estimate>(`/chat/${conversationId}/estimate`, {
        method: 'POST',
        body: json({ content: message }),
      })
        .then(setEstimate)
        .catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [message, conversationId]);
  const send = () => {
    if (!message || streaming || uploading) return;
    if (message.length > maxMessageChars) {
      toast('Mensagem grande demais: remova algum anexo');
      return;
    }
    onSend(message);
    setText('');
    setFiles([]);
    images.forEach((i) => URL.revokeObjectURL(i.preview));
    setImages([]);
  };
  const addImage = async (f: File) => {
    const id = crypto.randomUUID();
    const preview = URL.createObjectURL(f);
    setImages((v) => [...v, { id, name: f.name || 'imagem', preview }]);
    try {
      const body = new FormData();
      body.append('file', await prepareImage(f), f.name || 'imagem');
      const { url } = await api<{ url: string }>('/images', {
        method: 'POST',
        body,
      });
      setImages((v) => v.map((i) => (i.id === id ? { ...i, url } : i)));
    } catch (e) {
      URL.revokeObjectURL(preview);
      setImages((v) => v.filter((i) => i.id !== id));
      toast(e instanceof Error ? e.message : 'Não foi possível enviar a imagem');
    }
  };
  const removeImage = (id: string) =>
    setImages((v) => {
      const gone = v.find((i) => i.id === id);
      if (gone) URL.revokeObjectURL(gone.preview);
      return v.filter((i) => i.id !== id);
    });
  const attach = async (list: FileList | null) => {
    for (const f of Array.from(list ?? [])) {
      if (f.type.startsWith('image/')) {
        addImage(f);
        continue;
      }
      const content = await f.text();
      if (content.length > maxFileChars)
        toast(`"${f.name}" foi cortado nos primeiros ${maxFileChars / 1000} mil caracteres`);
      setFiles((v) => [...v, { name: f.name, content: content.slice(0, maxFileChars) }]);
    }
  };
  return (
    <div className="composer-wrap">
      {images.length > 0 && (
        <div className="image-thumbs">
          {images.map((i) => (
            <span className={`image-thumb${i.url ? '' : ' uploading'}`} key={i.id}>
              <img src={i.preview} alt={i.name} />
              <button
                title="Remover imagem"
                aria-label={`Remover ${i.name}`}
                onClick={() => removeImage(i.id)}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="attachment-chips">
          {files.map((f, i) => (
            <span className="attachment-chip" key={`${f.name}-${i}`}>
              <FileText size={15} />
              <span>
                <strong>{f.name}</strong>
                <small>{describeSize(f.content)}</small>
              </span>
              <button
                title="Remover anexo"
                aria-label={`Remover ${f.name}`}
                onClick={() => setFiles((v) => v.filter((_, j) => j !== i))}
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer">
        <button
          className="attach icon-button"
          title="Anexar imagem ou arquivo de texto"
          onClick={() => file.current?.click()}
        >
          <Paperclip size={21} />
        </button>
        {webSearchAvailable && (
          <button
            className={`attach icon-button web-toggle${webSearch ? ' active' : ''}`}
            title={
              webSearch
                ? 'Pesquisa na web ativada (clique para desativar)'
                : 'Pesquisar na web'
            }
            aria-pressed={webSearch}
            onClick={onToggleWebSearch}
          >
            <Globe size={21} />
          </button>
        )}
        {!imageMode && <MaxTokensButton />}
        <input
          ref={file}
          type="file"
          hidden
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.json,.csv,.ts,.tsx,.js,.py,.html,.css"
          onChange={(e) => {
            attach(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="composer-body">
          <textarea
            ref={area}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height =
                Math.min(e.target.scrollHeight, 180) + 'px';
            }}
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.files).filter((f) =>
                f.type.startsWith('image/'),
              );
              if (!pasted.length) return;
              e.preventDefault();
              pasted.forEach(addImage);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              imageMode
                ? 'Descreva a imagem que você quer gerar...'
                : 'Digite sua mensagem aqui...'
            }
            rows={1}
          />
          <ContextMeter
            tokens={estimate.inputTokensEstimate || Math.ceil(message.length / 4)}
            window={estimate.contextWindow}
          />
        </div>
        {streaming ? (
          <button
            className="send-button"
            onClick={onStop}
            title="Parar geração"
          >
            <Square size={18} fill="currentColor" />
          </button>
        ) : (
          <button
            className="send-button"
            onClick={send}
            title="Enviar mensagem"
            disabled={!message || uploading}
          >
            <Send size={20} />
          </button>
        )}
      </div>
      <small>Enter envia · Shift + Enter quebra linha</small>
    </div>
  );
}
