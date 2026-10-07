import { useState } from 'react';
import { Database } from 'lucide-react';
export function ConversationUsageChip({
  totals,
}: {
  totals?: {
    inputTokens: number;
    reasoningTokens: number;
    outputTokens: number;
    responses: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const t = totals ?? {
    inputTokens: 0,
    reasoningTokens: 0,
    outputTokens: 0,
    responses: 0,
  };
  const total = t.inputTokens + t.reasoningTokens + t.outputTokens;
  const fmt = (n: number) => n.toLocaleString('pt-BR');
  return (
    <div className="usage-chip-wrap">
      <button className="usage-chip" onClick={() => setOpen(!open)}>
        <Database size={16} />
        {fmt(total)} tokens
      </button>
      {open && (
        <div className="usage-popover">
          <strong>Uso da conversa</strong>
          <p>{t.responses} respostas</p>
          <div className="stacked">
            <i
              style={{
                width: `${total ? (t.inputTokens / total) * 100 : 0}%`,
                background: 'var(--primary)',
              }}
            />
            <i
              style={{
                width: `${total ? (t.reasoningTokens / total) * 100 : 0}%`,
                background: 'var(--star)',
              }}
            />
            <i
              style={{
                width: `${total ? (t.outputTokens / total) * 100 : 0}%`,
                background: 'var(--accent)',
              }}
            />
          </div>
          <p>Entrada: {fmt(t.inputTokens)}</p>
          <p>Processamento: {fmt(t.reasoningTokens)}</p>
          <p>Saída: {fmt(t.outputTokens)}</p>
        </div>
      )}
    </div>
  );
}
