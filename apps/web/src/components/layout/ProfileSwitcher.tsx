import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronsUpDown, Plus, Settings, Trash2 } from 'lucide-react';
import { useProfiles } from '../../hooks/useProfiles';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import type { Profile } from '../../types';

export function Avatar({
  profile,
  size = 32,
}: {
  profile: Pick<Profile, 'name' | 'avatar'> | null | undefined;
  size?: number;
}) {
  const initial = (profile?.name?.trim()[0] ?? '?').toUpperCase();
  return profile?.avatar ? (
    <img
      className="avatar"
      src={profile.avatar}
      alt=""
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="avatar avatar-initial"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {initial}
    </span>
  );
}

/** Rodapé da sidebar: perfil ativo + menu para trocar, criar e excluir perfis. */
export function ProfileSwitcher({ onNavigate }: { onNavigate: () => void }) {
  const user = useAuthStore((s) => s.user);
  const mode = useAuthStore((s) => s.mode);
  const toast = useUiStore((s) => s.showToast);
  const { profiles, owner, switchTo, create, remove } = useProfiles();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const run = async (action: () => Promise<void>, ok?: string) => {
    try {
      await action();
      setOpen(false);
      onNavigate();
      if (ok) toast(ok);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não foi possível concluir');
    }
  };
  return (
    <div className="profile-switcher" ref={box}>
      <button
        className="profile-current"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Avatar profile={user} />
        <span className="profile-names">
          <strong>{user?.name || 'Sem nome'}</strong>
          <small>{mode === 'local' ? 'Trocar de perfil' : user?.email}</small>
        </span>
        <ChevronsUpDown size={16} />
      </button>
      {open && (
        <div className="profile-menu" role="menu">
          {mode === 'local' && (
            <>
              <h4>Perfis</h4>
              {profiles.map((p) => (
                <div className="profile-row" key={p.id}>
                  <button
                    onClick={() =>
                      p.id !== user?.id &&
                      run(() => switchTo(p.id), `Perfil: ${p.name || 'Sem nome'}`)
                    }
                  >
                    <Avatar profile={p} size={28} />
                    <span className="profile-row-name">{p.name || 'Sem nome'}</span>
                    {p.id === user?.id && <Check size={15} />}
                  </button>
                  {p.id !== owner && (
                    <button
                      className="profile-delete"
                      title="Excluir perfil"
                      onClick={() => {
                        if (
                          confirm(
                            `Excluir o perfil "${p.name || 'Sem nome'}"? As conversas e projetos dele serão apagados.`,
                          )
                        )
                          run(() => remove(p.id), 'Perfil excluído');
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              {creating ? (
                <form
                  className="profile-new"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newName.trim()) return;
                    run(async () => {
                      await create(newName.trim());
                      setNewName('');
                      setCreating(false);
                    }, 'Perfil criado');
                  }}
                >
                  <input
                    autoFocus
                    placeholder="Nome do perfil"
                    value={newName}
                    maxLength={100}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <button type="submit" disabled={!newName.trim()}>
                    Criar
                  </button>
                </form>
              ) : (
                <button className="profile-add" onClick={() => setCreating(true)}>
                  <Plus size={16} /> Novo perfil
                </button>
              )}
            </>
          )}
          <Link
            className="profile-add"
            to="/settings?tab=profile"
            onClick={() => {
              setOpen(false);
              onNavigate();
            }}
          >
            <Settings size={16} /> Editar perfil
          </Link>
        </div>
      )}
    </div>
  );
}
