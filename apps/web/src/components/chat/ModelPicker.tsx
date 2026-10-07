import { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useModels } from '../../hooks/useModels';
import type { Model } from '../../types';
export function ModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { data = [] } = useModels();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = useMemo(
    () =>
      data.filter(
        (m) =>
          m.name.toLowerCase().includes(search.toLowerCase()) ||
          m.id.toLowerCase().includes(search.toLowerCase()),
      ),
    [data, search],
  );
  const selected = data.find((m) => m.id === value);
  const groups = filtered.reduce<Record<string, Model[]>>((a, m) => {
    (a[m.provider] ??= []).push(m);
    return a;
  }, {});
  return (
    <div className="model-picker">
      <button className="model-trigger" onClick={() => setOpen(!open)}>
        <span className="model-mark">✺</span>
        {selected?.name ?? (value || 'Escolha um modelo')}
        <ChevronDown size={17} />
      </button>
      {open && (
        <div className="model-dropdown">
          <label>
            <Search size={16} />
            <input
              autoFocus
              placeholder="Buscar modelo"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="model-list">
            {data.length === 0 ? (
              <p>
                Nenhum provedor configurado.{' '}
                <Link to="/settings" onClick={() => setOpen(false)}>
                  Configurar agora
                </Link>
              </p>
            ) : (
              Object.entries(groups).map(([provider, models]) => (
                <div key={provider}>
                  <h4>{provider}</h4>
                  {models.map((m) => (
                    <button
                      key={m.id}
                      className={m.id === value ? 'selected' : ''}
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                      }}
                    >
                      <span>{m.name}</span>
                      <small>
                        {m.kind === 'image'
                          ? '🖼 Gera imagens'
                          : m.contextWindow
                            ? `${Math.round(m.contextWindow / 1000)} mil tokens`
                            : ''}
                      </small>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
