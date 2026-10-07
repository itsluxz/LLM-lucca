import { useEffect, useRef, useState } from 'react';
import { Gauge } from 'lucide-react';
import { useUiStore } from '../../stores/uiStore';

const presets = [1000, 2000, 4000, 8000, 16000, 32000];
const maxAllowed = 1_000_000;

/** 4000 → "4k", 1500 → "1,5k". */
function compact(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
}

/** Botão do composer que define o máximo de tokens de saída por resposta. */
export function MaxTokensButton() {
  const maxTokens = useUiStore((s) => s.maxTokens);
  const setMaxTokens = useUiStore((s) => s.setMaxTokens);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setCustom(maxTokens && !presets.includes(maxTokens) ? String(maxTokens) : '');
    const outside = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, maxTokens]);

  const choose = (v: number | null) => {
    setMaxTokens(v);
    setOpen(false);
  };
  const customValue = Math.floor(Number(custom));
  const customValid = customValue >= 1 && customValue <= maxAllowed;

  return (
    <div className="max-tokens" ref={root}>
      <button
        className={`attach icon-button max-tokens-toggle${maxTokens ? ' active' : ''}`}
        title={
          maxTokens
            ? `Máximo de ${maxTokens.toLocaleString('pt-BR')} tokens de saída`
            : 'Limitar tokens de saída'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Gauge size={21} />
        {maxTokens && <span className="max-tokens-badge">{compact(maxTokens)}</span>}
      </button>
      {open && (
        <div className="max-tokens-panel" role="dialog" aria-label="Máximo de tokens de saída">
          <strong>Máximo de tokens de saída</strong>
          <p>
            Limita o tamanho de cada resposta. Em alguns modelos de raciocínio, o
            processamento também conta para o limite.
          </p>
          <div className="max-tokens-options">
            <button
              className={maxTokens === null ? 'selected' : ''}
              onClick={() => choose(null)}
            >
              Automático
            </button>
            {presets.map((p) => (
              <button
                key={p}
                className={maxTokens === p ? 'selected' : ''}
                onClick={() => choose(p)}
              >
                {p.toLocaleString('pt-BR')}
              </button>
            ))}
          </div>
          <form
            className="max-tokens-custom"
            onSubmit={(e) => {
              e.preventDefault();
              if (customValid) choose(customValue);
            }}
          >
            <input
              type="number"
              min={1}
              max={maxAllowed}
              step={1}
              inputMode="numeric"
              placeholder="Personalizado"
              aria-label="Máximo de tokens personalizado"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            <button type="submit" disabled={!customValid}>
              Aplicar
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
