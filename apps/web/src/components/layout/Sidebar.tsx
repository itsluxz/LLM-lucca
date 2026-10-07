import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  FolderOpen,
  Menu,
  MessageSquarePlus,
  Search,
  Settings,
  PanelLeftClose,
  Pin,
  Trash2,
  LogOut,
  Pencil,
} from 'lucide-react';
import { api } from '../../services/api';
import type { Conversation } from '../../types';
import { Mascot } from '../mascot/Mascot';
import { ProfileSwitcher } from './ProfileSwitcher';
import { useUiStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
function group(date: string, pinned: boolean) {
  if (pinned) return 'Fixadas';
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  return days <= 0
    ? 'Hoje'
    : days === 1
      ? 'Ontem'
      : days < 7
        ? 'Últimos 7 dias'
        : 'Mais antigas';
}
export function Sidebar() {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const { sidebarOpen, setSidebarOpen } = useUiStore();
  const { conversationId } = useParams();
  const query = useQueryClient();
  const navigate = useNavigate();
  const mode = useAuthStore((s) => s.mode);
  const { data } = useQuery({
    queryKey: ['conversations', search],
    queryFn: () =>
      api<{ items: Conversation[] }>(
        '/conversations' +
          (search ? `?search=${encodeURIComponent(search)}` : ''),
      ),
  });
  const groups = new Map<string, Conversation[]>();
  for (const c of data?.items ?? []) {
    const k = group(c.updatedAt, c.pinned);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const close = () => setSidebarOpen(false);
  const remove = async (c: Conversation) => {
    if (!confirm(`Excluir "${c.title}"?`)) return;
    await api(`/conversations/${c.id}`, { method: 'DELETE' });
    query.invalidateQueries({ queryKey: ['conversations'] });
    if (c.id === conversationId) navigate('/');
  };
  const pin = async (c: Conversation) => {
    await api(`/conversations/${c.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned: !c.pinned }),
    });
    query.invalidateQueries({ queryKey: ['conversations'] });
  };
  const rename = async (c: Conversation) => {
    const title = prompt('Novo título da conversa', c.title)?.trim();
    if (!title || title === c.title) return;
    await api(`/conversations/${c.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    query.invalidateQueries({ queryKey: ['conversations'] });
    query.invalidateQueries({ queryKey: ['conversation', c.id] });
  };
  return (
    <>
      <button
        className="mobile-menu icon-button"
        onClick={() => setSidebarOpen(true)}
        aria-label="Abrir menu"
      >
        <Menu size={21} />
      </button>
      {sidebarOpen && <div className="sidebar-scrim" onClick={close} />}
      <aside
        className={`sidebar ${sidebarOpen ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}
      >
        <div className="brand">
          <Mascot mood="idle" size={70} />
          <div>
            <strong>LLM</strong>
            <small>Lucca Language Model</small>
          </div>
          <button
            className="icon-button collapse"
            onClick={() => setCollapsed(!collapsed)}
            aria-label="Recolher menu"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>
        <Link to="/" className="new-chat" onClick={close}>
          <MessageSquarePlus size={19} />
          <span>Nova conversa</span>
        </Link>
        <Link to="/projects" className="side-link" onClick={close}>
          <FolderOpen size={19} />
          <span>Projetos</span>
        </Link>
        <label className="search">
          <Search size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar conversas..."
          />
        </label>
        <div className="conversation-list">
          {[...groups].map(([label, items]) => (
            <section key={label}>
              <h4>{label}</h4>
              {items.map((c) => (
                <div
                  className={`conversation-row ${conversationId === c.id ? 'active' : ''}`}
                  key={c.id}
                >
                  <Link to={`/c/${c.id}`} onClick={close} title={c.title}>
                    {c.title}
                  </Link>
                  <div className="row-actions">
                    <button onClick={() => rename(c)} title="Renomear">
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => pin(c)}
                      title={c.pinned ? 'Desafixar' : 'Fixar'}
                    >
                      <Pin size={14} />
                    </button>
                    <button onClick={() => remove(c)} title="Excluir">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
        <ProfileSwitcher onNavigate={close} />
        <div className="sidebar-bottom">
          <Link to="/settings" onClick={close}>
            <Settings size={18} /> Configurações
          </Link>
          {mode === 'multi' && (
            <button
              onClick={async () => {
                await api('/auth/logout', { method: 'POST' });
                useAuthStore.getState().setSession(null, 'multi', null);
                navigate('/login');
              }}
            >
              <LogOut size={18} /> Sair
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
