import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { useUiStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { Mascot } from '../mascot/Mascot';
export function AppShell({ children }: { children: ReactNode }) {
  const { theme, toast } = useUiStore();
  const color = useAuthStore((s) => s.user?.colorTheme) ?? 'roxo';
  return (
    <div className={`app ${theme} color-${color}`}>
      <Sidebar />
      <main className="main">{children}</main>
      {toast && (
        <div role="status" className="toast">
          <Mascot mood="wink" size={38} />
          {toast}
        </div>
      )}
    </div>
  );
}
