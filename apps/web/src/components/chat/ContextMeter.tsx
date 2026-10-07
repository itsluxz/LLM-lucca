export function ContextMeter({
  tokens,
  window,
}: {
  tokens: number;
  window: number;
}) {
  const pct = Math.round((tokens / window) * 100);
  return (
    <span
      className={`context-meter ${pct > 90 ? 'danger' : pct > 70 ? 'warn' : ''}`}
      title="Estimativa de entrada da próxima mensagem, incluindo contexto"
    >
      ◫ {tokens.toLocaleString('pt-BR')} / {window.toLocaleString('pt-BR')}{' '}
      tokens · {pct}%
    </span>
  );
}
