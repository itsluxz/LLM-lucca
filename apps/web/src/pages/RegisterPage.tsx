import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, json } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { Mascot } from '../components/mascot/Mascot';
export default function RegisterPage() {
  const [name, setName] = useState('');
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
      }>('/auth/register', {
        method: 'POST',
        body: json({ name, email, password }),
      });
      useAuthStore.getState().setSession(data.user, 'multi', data.accessToken);
      navigate('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao cadastrar');
    }
  };
  return (
    <div className="auth-page">
      <Mascot mood="hello" size={160} />
      <h1>Crie sua conta</h1>
      <p>Comece a conversar com seus modelos favoritos.</p>
      <form onSubmit={submit}>
        <input
          required
          placeholder="Seu nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="email"
          required
          placeholder="E-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          minLength={8}
          required
          placeholder="Senha (mínimo 8 caracteres)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <span className="form-error">{error}</span>}
        <button className="primary-button">Criar conta</button>
      </form>
      <p>
        Já tem conta? <Link to="/login">Entrar</Link>
      </p>
    </div>
  );
}
