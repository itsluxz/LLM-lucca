import type { Usage } from '../../types';
import { useUiStore } from '../../stores/uiStore';
const fmt = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('pt-BR').format(n);
export function TokenUsageBar({ usage }: { usage: Usage }) {
  const show = useUiStore((s) => s.showTokens);
  if (!show) return null;
  const estimated = (usage.usageSource ?? usage.source) === 'estimate';
  const total =
    (usage.inputTokens ?? 0) +
    (usage.reasoningTokens ?? 0) +
    (usage.outputTokens ?? 0);
  return (
    <div
      className="usage-line"
      title={`${estimated ? 'Estimativa: o provedor não informou todos os números oficiais. ' : 'Dados oficiais do provedor. '}${usage.cachedTokens ? fmt(usage.cachedTokens) + ' tokens de entrada lidos do cache.' : ''}`}
    >
      <span>
        ↓ Entrada {estimated ? '≈' : ''}
        {fmt(usage.inputTokens)}
      </span>
      <span>⚙ Processamento {fmt(usage.reasoningTokens)}</span>
      <span>
        ↑ Saída {estimated ? '≈' : ''}
        {fmt(usage.outputTokens)}
      </span>
      <span>Σ {fmt(total)}</span>
      {usage.durationMs != null && (
        <span>
          {(usage.durationMs / 1000).toLocaleString('pt-BR', {
            maximumFractionDigits: 1,
          })}{' '}
          s
        </span>
      )}
    </div>
  );
}
