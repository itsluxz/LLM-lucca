import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, json } from '../services/api';
import type { ColorTheme, ProviderKey, User } from '../types';
import { useUiStore } from '../stores/uiStore';
import {
  defaultPersonaName,
  useAuthStore,
  usePersonaName,
} from '../stores/authStore';
import { Avatar } from '../components/layout/ProfileSwitcher';
import { PersonaImagesEditor } from '../components/mascot/PersonaImagesEditor';
import { useTools } from '../hooks/useTools';
import {
  ImageUp,
  KeyRound,
  UserRound,
  Palette,
  Puzzle,
  Trash2,
  Save,
} from 'lucide-react';
type ProviderData = {
  supported: Array<{ id: string; name: string }>;
  configured: ProviderKey[];
};
type Tab = 'providers' | 'profile' | 'extensions' | 'appearance';
const colorOptions: Array<{ id: ColorTheme; label: string; colors: string }> = [
  { id: 'roxo', label: 'Roxo', colors: '#7b3fe4, #e8336e' },
  { id: 'rosa', label: 'Rosa', colors: '#d63384, #7b3fe4' },
  { id: 'azul', label: 'Azul', colors: '#2f6fde, #e8336e' },
  { id: 'verde', label: 'Verde', colors: '#1f9d6b, #f5a524' },
  { id: 'laranja', label: 'Laranja', colors: '#e8722b, #d63384' },
  { id: 'vermelho', label: 'Vermelho', colors: '#d63a3a, #f5a524' },
];
/** Recorta no centro e reduz para 160×160, para caber no banco como data URL. */
async function resizeAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 160;
  canvas
    .getContext('2d')
    ?.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      160,
      160,
    );
  bitmap.close();
  const webp = canvas.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp')
    ? webp
    : canvas.toDataURL('image/jpeg', 0.85);
}
export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab =
    tabParam === 'profile' ||
    tabParam === 'extensions' ||
    tabParam === 'appearance'
      ? tabParam
      : 'providers';
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const query = useQueryClient();
  const toast = useUiStore((s) => s.showToast);
  const { theme, setTheme, showTokens, setShowTokens } = useUiStore();
  const user = useAuthStore((s) => s.user);
  const personaName = usePersonaName();
  const [name, setName] = useState('');
  const [persona, setPersona] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const avatarInput = useRef<HTMLInputElement>(null);
  // recarrega o formulário só ao trocar de perfil: salvar uma imagem da persona
  // atualiza o usuário e não deve apagar o que ainda não foi salvo aqui
  const userId = user?.id;
  useEffect(() => {
    const u = useAuthStore.getState().user;
    setName(u?.name ?? '');
    setPersona(u?.personaName ?? '');
    setAvatar(u?.avatar ?? null);
    setPrompt(u?.systemPrompt ?? '');
    setDefaultModel(u?.defaultModel ?? '');
  }, [userId]);
  const updateMe = async (data: Partial<User>) => {
    const u = await api<User>('/users/me', {
      method: 'PATCH',
      body: json(data),
    });
    useAuthStore.getState().setSession(u, useAuthStore.getState().mode ?? 'local');
    query.invalidateQueries({ queryKey: ['profiles'] });
    return u;
  };
  const pickAvatar = async (file?: File) => {
    if (!file) return;
    try {
      setAvatar(await resizeAvatar(file));
    } catch {
      toast('Não foi possível ler esta imagem');
    }
  };
  const chooseColor = async (colorTheme: ColorTheme) => {
    try {
      await updateMe({ colorTheme });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  };
  const { data } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api<ProviderData>('/providers'),
  });
  const { data: models = [] } = useQuery({
    queryKey: ['models'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/models'),
  });
  const saveProfile = async () => {
    try {
      await updateMe({
        name,
        personaName: persona.trim() || null,
        avatar,
        systemPrompt: prompt,
        defaultModel: defaultModel || null,
      });
      toast('Perfil salvo');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  };
  return (
    <div className="content-page settings-page">
      <div className="page-head">
        <div>
          <h1>Configurações</h1>
          <p>Personalize sua experiência com a {personaName}.</p>
        </div>
      </div>
      <div className="tabs">
        <button
          className={tab === 'providers' ? 'active' : ''}
          onClick={() => setTab('providers')}
        >
          <KeyRound size={17} /> Provedores
        </button>
        <button
          className={tab === 'profile' ? 'active' : ''}
          onClick={() => setTab('profile')}
        >
          <UserRound size={17} /> Perfil
        </button>
        <button
          className={tab === 'extensions' ? 'active' : ''}
          onClick={() => setTab('extensions')}
        >
          <Puzzle size={17} /> Extensões
        </button>
        <button
          className={tab === 'appearance' ? 'active' : ''}
          onClick={() => setTab('appearance')}
        >
          <Palette size={17} /> Aparência
        </button>
      </div>
      {tab === 'providers' && useAuthStore.getState().mode === 'local' && (
        <p className="settings-note">
          As chaves de API são compartilhadas entre todos os perfis.
        </p>
      )}
      {tab === 'providers' && (
        <div className="provider-grid">
          {data?.supported.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              entries={data.configured.filter((k) => k.provider === p.id)}
              onChange={() => {
                query.invalidateQueries({ queryKey: ['providers'] });
                query.invalidateQueries({ queryKey: ['models'] });
              }}
            />
          ))}
        </div>
      )}
      {tab === 'profile' && (
        <div className="settings-panel">
          <div className="avatar-field">
            <Avatar profile={{ name, avatar }} size={72} />
            <button
              className="ghost-button"
              onClick={() => avatarInput.current?.click()}
            >
              <ImageUp size={17} /> Trocar foto
            </button>
            {avatar && (
              <button className="ghost-button" onClick={() => setAvatar(null)}>
                Remover
              </button>
            )}
            <input
              ref={avatarInput}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                pickAvatar(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <label>
            Seu nome
            <input
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Nome da persona
            <input
              value={persona}
              maxLength={60}
              placeholder={defaultPersonaName}
              onChange={(e) => setPersona(e.target.value)}
            />
          </label>
          <PersonaImagesEditor />
          <label>
            Instruções globais
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              placeholder={`Como a ${personaName} deve responder a você?`}
            />
          </label>
          <label>
            Modelo padrão
            <select
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
            >
              <option value="">Automático</option>
              {models.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" onClick={saveProfile}>
            <Save size={17} /> Salvar perfil
          </button>
        </div>
      )}
      {tab === 'extensions' && <ExtensionsPanel />}
      {tab === 'appearance' && (
        <div className="settings-panel">
          <div>
            Cores do perfil
            <div className="color-swatches" role="radiogroup">
              {colorOptions.map((c) => (
                <button
                  key={c.id}
                  role="radio"
                  aria-checked={(user?.colorTheme ?? 'roxo') === c.id}
                  className={`color-swatch${(user?.colorTheme ?? 'roxo') === c.id ? ' active' : ''}`}
                  onClick={() => chooseColor(c.id)}
                >
                  <i style={{ background: `linear-gradient(135deg, ${c.colors})` }} />
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <label>
            Tema
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}
            >
              <option value="dark">Escuro</option>
              <option value="light">Claro</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={showTokens}
              onChange={(e) => setShowTokens(e.target.checked)}
            />{' '}
            Mostrar tokens em cada resposta
          </label>
        </div>
      )}
    </div>
  );
}
function ExtensionsPanel() {
  const { data: tools = [], isLoading, error } = useTools();
  const disabled = useUiStore((s) => s.disabledTools);
  const setToolEnabled = useUiStore((s) => s.setToolEnabled);
  return (
    <div className="settings-panel extensions-panel">
      <p className="settings-note">
        Extensões são ferramentas que o modelo pode usar sozinho durante a
        resposta. Funcionam nos modelos com suporte a ferramentas; nos demais,
        a resposta segue normalmente sem elas. Com a pesquisa na web da OpenAI
        ligada, as extensões não são usadas.
      </p>
      {isLoading && <p>Carregando…</p>}
      {error && <p>Não foi possível carregar as extensões.</p>}
      {tools.map((t) => (
        <label key={t.id} className="check extension-item">
          <input
            type="checkbox"
            checked={!disabled.includes(t.id)}
            onChange={(e) => setToolEnabled(t.id, e.target.checked)}
          />
          <span>
            <strong>{t.title}</strong>
            <small>{t.description}</small>
          </span>
        </label>
      ))}
    </div>
  );
}
function ProviderCard({
  provider,
  entries,
  onChange,
}: {
  provider: { id: string; name: string };
  entries: ProviderKey[];
  onChange: () => void;
}) {
  const [key, setKey] = useState('');
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useUiStore((s) => s.showToast);
  const save = async () => {
    if (!key.trim()) return;
    setBusy(true);
    try {
      await api('/providers', {
        method: 'POST',
        body: json({
          provider: provider.id,
          apiKey: key,
          label,
          baseUrl: provider.id === 'custom' ? url : undefined,
        }),
      });
      setKey('');
      onChange();
      toast('Chave salva e validada');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Chave inválida');
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (k: ProviderKey) => {
    await api(`/providers/${k.id}`, {
      method: 'PATCH',
      body: json({ enabled: !k.enabled }),
    });
    onChange();
  };
  const remove = async (k: ProviderKey) => {
    if (!confirm('Remover esta chave?')) return;
    await api(`/providers/${k.id}`, { method: 'DELETE' });
    onChange();
  };
  return (
    <section className="provider-card">
      <div className="provider-head">
        <h2>{provider.name}</h2>
        <span className={entries.some((e) => e.enabled) ? 'connected' : ''}>
          {entries.some((e) => e.enabled) ? 'Conectado' : 'Não configurado'}
        </span>
      </div>
      {entries.map((k) => (
        <div className="key-row" key={k.id}>
          <span>
            {k.label || provider.name} ·•••• {k.last4}
          </span>
          <button onClick={() => toggle(k)}>
            {k.enabled ? 'Desativar' : 'Ativar'}
          </button>
          <button onClick={() => remove(k)} aria-label="Remover">
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <input
        type="password"
        placeholder="Cole sua chave de API"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      {provider.id === 'custom' && (
        <input
          type="url"
          placeholder="https://servidor/v1"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      )}
      <input
        placeholder="Rótulo (opcional)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <button className="ghost-button" disabled={busy || !key} onClick={save}>
        {busy ? 'Validando...' : 'Testar e salvar'}
      </button>
    </section>
  );
}
