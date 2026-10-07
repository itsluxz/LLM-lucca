import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { FolderPlus, ArrowRight } from 'lucide-react';
import { api, json } from '../services/api';
import type { Project } from '../types';
import { useUiStore } from '../stores/uiStore';
export default function ProjectsPage() {
  const [name, setName] = useState('');
  const query = useQueryClient();
  const navigate = useNavigate();
  const toast = useUiStore((s) => s.showToast);
  const { data = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
  });
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const p = await api<Project>('/projects', {
        method: 'POST',
        body: json({ name: name.trim(), emoji: '✦' }),
      });
      query.invalidateQueries({ queryKey: ['projects'] });
      toast('Projeto criado');
      navigate(`/projects/${p.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro ao criar projeto');
    }
  };
  return (
    <div className="content-page">
      <div className="page-head">
        <div>
          <h1>Projetos</h1>
          <p>Organize conversas, instruções e arquivos de conhecimento.</p>
        </div>
      </div>
      <form className="create-project" onSubmit={create}>
        <FolderPlus size={22} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do novo projeto"
        />
        <button className="primary-button">Criar projeto</button>
      </form>
      <div className="project-grid">
        {data.map((p) => (
          <Link className="project-card" to={`/projects/${p.id}`} key={p.id}>
            <span>{p.emoji || '✦'}</span>
            <h2>{p.name}</h2>
            <p>{p.description || 'Sem descrição'}</p>
            <small>
              {p._count?.conversations ?? 0} conversas · {p._count?.files ?? 0}{' '}
              arquivos
            </small>
            <ArrowRight size={18} />
          </Link>
        ))}
      </div>
    </div>
  );
}
