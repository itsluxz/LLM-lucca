import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, json } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import type { Profile, User } from '../types';
export function useProfiles() {
  const query = useQueryClient();
  const navigate = useNavigate();
  const mode = useAuthStore((s) => s.mode);
  const user = useAuthStore((s) => s.user);
  const list = useQuery({
    queryKey: ['profiles'],
    queryFn: () => api<{ owner: string; profiles: Profile[] }>('/users/profiles'),
    enabled: mode === 'local',
  });
  /** Troca o perfil ativo e recarrega tudo que depende dele. */
  const switchTo = useCallback(
    async (id: string) => {
      const store = useAuthStore.getState();
      store.setProfileId(id === list.data?.owner ? null : id);
      const me = await api<{ authMode: 'local' | 'multi'; user: User }>('/auth/me');
      store.setSession(me.user, me.authMode);
      query.removeQueries({ predicate: (q) => q.queryKey[0] !== 'profiles' });
      navigate('/');
    },
    [list.data?.owner, navigate, query],
  );
  const create = useCallback(
    async (name: string) => {
      const profile = await api<Profile>('/users/profiles', {
        method: 'POST',
        body: json({ name }),
      });
      await query.invalidateQueries({ queryKey: ['profiles'] });
      await switchTo(profile.id);
    },
    [query, switchTo],
  );
  const remove = useCallback(
    async (id: string) => {
      await api(`/users/profiles/${id}`, { method: 'DELETE' });
      if (id === user?.id && list.data) await switchTo(list.data.owner);
      await query.invalidateQueries({ queryKey: ['profiles'] });
    },
    [list.data, query, switchTo, user?.id],
  );
  return {
    profiles: list.data?.profiles ?? [],
    owner: list.data?.owner,
    switchTo,
    create,
    remove,
  };
}
