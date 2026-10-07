import { create } from 'zustand';
type State = {
  theme: 'dark' | 'light';
  showTokens: boolean;
  sidebarOpen: boolean;
  webSearch: boolean;
  /** Limite de tokens de saída por resposta; null = padrão do provedor. */
  maxTokens: number | null;
  toast: string | null;
  setTheme: (v: 'dark' | 'light') => void;
  setShowTokens: (v: boolean) => void;
  setWebSearch: (v: boolean) => void;
  setMaxTokens: (v: number | null) => void;
  setSidebarOpen: (v: boolean) => void;
  showToast: (v: string) => void;
};
export const useUiStore = create<State>((set) => ({
  theme: localStorage.getItem('theme') === 'light' ? 'light' : 'dark',
  showTokens: localStorage.getItem('showTokens') !== 'false',
  sidebarOpen: false,
  webSearch: localStorage.getItem('webSearch') === 'true',
  maxTokens: Number(localStorage.getItem('maxTokens')) || null,
  toast: null,
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    set({ theme });
  },
  setShowTokens: (showTokens) => {
    localStorage.setItem('showTokens', String(showTokens));
    set({ showTokens });
  },
  setWebSearch: (webSearch) => {
    localStorage.setItem('webSearch', String(webSearch));
    set({ webSearch });
  },
  setMaxTokens: (maxTokens) => {
    if (maxTokens) localStorage.setItem('maxTokens', String(maxTokens));
    else localStorage.removeItem('maxTokens');
    set({ maxTokens });
  },
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  showToast: (toast) => {
    set({ toast });
    setTimeout(() => set({ toast: null }), 3500);
  },
}));
