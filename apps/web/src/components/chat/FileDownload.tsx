import { useState, type ReactNode } from 'react';
import { FileSpreadsheet, FileText, Loader2, Presentation } from 'lucide-react';
import { apiBase, authHeaders } from '../../services/api';
import { useUiStore } from '../../stores/uiStore';

/** Prefixo dos links de arquivos criados pelas extensões. */
export const downloadPrefix = '/api/downloads/';

const icons = {
  xlsx: FileSpreadsheet,
  pptx: Presentation,
  docx: FileText,
  pdf: FileText,
};

/** Botão de download: busca o arquivo com o token de acesso (a rota exige login no modo multi). */
export function FileDownload({ href, children }: { href: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const toast = useUiStore((s) => s.showToast);
  const filename = decodeURIComponent(href.split('/').pop() ?? 'arquivo');
  const ext = filename.split('.').pop()?.toLowerCase() as keyof typeof icons;
  const Icon = icons[ext] ?? FileText;
  const download = async () => {
    setBusy(true);
    try {
      const res = await fetch(apiBase + href.slice('/api'.length), {
        credentials: 'include',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(res.status === 404 ? 'Arquivo não encontrado' : `Erro ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não foi possível baixar');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={`file-download ${ext ?? ''}`} onClick={download} disabled={busy}>
      {busy ? <Loader2 size={16} className="spin" /> : <Icon size={16} />}
      <span>{children}</span>
    </button>
  );
}
