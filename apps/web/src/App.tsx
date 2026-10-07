import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { api } from './services/api';
import { useAuthStore } from './stores/authStore';
import { AppShell } from './components/layout/AppShell';
import { Mascot } from './components/mascot/Mascot';
import ChatPage from './pages/ChatPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectPage from './pages/ProjectPage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import type { User } from './types';
export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user, mode, setSession } = useAuthStore();
  useEffect(() => {
    api<{ authMode: 'local' | 'multi'; user: User }>('/auth/me')
      .then((v) => setSession(v.user, v.authMode))
      .catch((e) => {
        if (
          e.message === 'Entre na sua conta' ||
          e.message === 'Sessão inválida ou expirada'
        )
          setSession(null, 'multi');
        else setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [setSession]);
  if (loading)
    return (
      <div className="loading">
        <Mascot mood="thinking" size={85} animated />
        Carregando...
      </div>
    );
  if (error)
    return (
      <div className="loading">
        <Mascot mood="idle" size={85} />
        <p>Não foi possível conectar à API: {error}</p>
        <button onClick={() => location.reload()}>Tentar novamente</button>
      </div>
    );
  if (mode === 'multi' && !user)
    return (
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/c/:conversationId" element={<ChatPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/login" element={<Navigate to="/" />} />
        <Route
          path="*"
          element={
            <div className="not-found">
              <Mascot mood="wink" size={140} />
              <h1>Página não encontrada</h1>
              <Link to="/">Voltar ao chat</Link>
            </div>
          }
        />
      </Routes>
    </AppShell>
  );
}
