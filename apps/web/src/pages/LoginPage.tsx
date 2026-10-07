import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, json } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { Mascot } from '../components/mascot/Mascot';
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = await api<{
        accessToken: string;
        user: import('../types').User;
      }>('/auth/login', { method: 'POST', body: json({ email, password }) });
      useAuthStore.getState().setSession(data.user, 'multi', data.accessToken);
      navigate('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao entrar');
    }
  };
  return (
    <div className="auth-page">
      <Mascot mood="hello" size={160} />
      <h1>Bem-vindo de volta</h1>
      <p>Entre para continuar suas conversas.</p>
      <form onSubmit={submit}>
        <input
          type="email"
          required
          placeholder="E-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          required
          placeholder="Senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <span className="form-error">{error}</span>}
        <button className="primary-button">Entrar</button>
      </form>
      <p>
        Primeira vez aqui? <Link to="/register">Criar conta</Link>
      </p>
    </div>
  );
}
