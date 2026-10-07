import { create } from 'zustand';
type State = {
  theme: 'dark' | 'light';
  showTokens: boolean;
  sidebarOpen: boolean;
  webSearch: boolean;
  /** Limite de tokens de saída por resposta; null = padrão do provedor. */
  maxTokens: number | null;
  /** Extensões desligadas pelo usuário (as novas já vêm ligadas). */
  disabledTools: string[];
  toast: string | null;
  setTheme: (v: 'dark' | 'light') => void;
  setShowTokens: (v: boolean) => void;
  setWebSearch: (v: boolean) => void;
  setMaxTokens: (v: number | null) => void;
  setToolEnabled: (id: string, enabled: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  showToast: (v: string) => void;
};
function readList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
}
export const useUiStore = create<State>((set) => ({
  theme: localStorage.getItem('theme') === 'light' ? 'light' : 'dark',
  showTokens: localStorage.getItem('showTokens') !== 'false',
  sidebarOpen: false,
  webSearch: localStorage.getItem('webSearch') === 'true',
  maxTokens: Number(localStorage.getItem('maxTokens')) || null,
  disabledTools: readList('disabledTools'),
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
  setToolEnabled: (id, enabled) =>
    set((s) => {
      const disabledTools = enabled
        ? s.disabledTools.filter((t) => t !== id)
        : [...new Set([...s.disabledTools, id])];
      localStorage.setItem('disabledTools', JSON.stringify(disabledTools));
      return { disabledTools };
    }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  showToast: (toast) => {
    set({ toast });
    setTimeout(() => set({ toast: null }), 3500);
  },
}));
