import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { apiBase, authHeaders } from '../../services/api';

/** Prefixo salvo no Markdown pelo backend para imagens geradas. */
export const generatedImagePrefix = '/api/images/';

/** Busca a imagem com o token de acesso (a rota exige login no modo multi). */
export function GeneratedImage({
  src,
  alt,
  compact = false,
}: {
  src: string;
  alt?: string;
  /** Miniatura sem botão de baixar (imagens enviadas pelo usuário). */
  compact?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetch(apiBase + src.slice('/api'.length), {
      credentials: 'include',
      headers: authHeaders(),
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  if (failed) return <span className="generated-image-error">Imagem indisponível</span>;
  if (!url) return <span className="generated-image loading">Carregando imagem…</span>;
  return (
    <span className={`generated-image${compact ? ' compact' : ''}`}>
      <a href={url} target="_blank" rel="noreferrer" title="Abrir em tamanho cheio">
        <img src={url} alt={alt ?? 'Imagem gerada'} />
      </a>
      {!compact && (
        <a className="generated-image-download" href={url} download="imagem.png">
          <Download size={14} /> Baixar
        </a>
      )}
    </span>
  );
}
