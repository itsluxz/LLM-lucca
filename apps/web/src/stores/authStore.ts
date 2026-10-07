import { create } from 'zustand';
import type { User } from '../types';
export const defaultPersonaName = 'AI Hoshino';
const readProfile = () => {
  try {
    return localStorage.getItem('profileId');
  } catch {
    return null;
  }
};
type State = {
  user: User | null;
  mode: 'local' | 'multi' | null;
  token: string | null;
  /** Perfil ativo no modo local (enviado em X-Profile-Id). */
  profileId: string | null;
  setSession: (
    user: User | null,
    mode: 'local' | 'multi',
    token?: string | null,
  ) => void;
  setProfileId: (id: string | null) => void;
};
export const useAuthStore = create<State>((set) => ({
  user: null,
  mode: null,
  token: null,
  profileId: readProfile(),
  setSession: (user, mode, token) =>
    set((s) => ({ user, mode, token: token === undefined ? s.token : token })),
  setProfileId: (profileId) => {
    try {
      if (profileId) localStorage.setItem('profileId', profileId);
      else localStorage.removeItem('profileId');
    } catch {
      // armazenamento indisponível: o perfil vale só nesta aba
    }
    set({ profileId });
  },
}));
/** Nome da assistente escolhido no perfil ativo. */
export const usePersonaName = () =>
  useAuthStore((s) => s.user?.personaName?.trim() || defaultPersonaName);
