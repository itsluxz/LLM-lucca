import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, Plus, Trash2, Upload } from 'lucide-react';
import { api, json } from '../services/api';
import type { Project, Conversation, Model } from '../types';
import { useUiStore } from '../stores/uiStore';
import { useAuthStore, usePersonaName } from '../stores/authStore';
export default function ProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const query = useQueryClient();
  const toast = useUiStore((s) => s.showToast);
  const defaultModel = useAuthStore((s) => s.user?.defaultModel);
  const personaName = usePersonaName();
  const { data: p } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<Project>(`/projects/${projectId}`),
    enabled: !!projectId,
  });
  const { data: list } = useQuery({
    queryKey: ['conversations', projectId],
    queryFn: () =>
      api<{ items: Conversation[] }>(`/conversations?projectId=${projectId}`),
    enabled: !!projectId,
  });
  const { data: models = [] } = useQuery({
    queryKey: ['models'],
    queryFn: () => api<Model[]>('/models'),
  });
  const [instructions, setInstructions] = useState('');
  useEffect(() => setInstructions(p?.instructions ?? ''), [p?.instructions]);
  useEffect(() => {
    if (!p || instructions === p.instructions) return;
    const timer = setTimeout(() => {
      api(`/projects/${projectId}`, {
        method: 'PATCH',
        body: json({ instructions }),
      })
        .then(() =>
          query.invalidateQueries({ queryKey: ['project', projectId] }),
        )
        .catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [instructions, p, projectId, query]);
  const newChat = async () => {
    if (!models[0]) {
      navigate('/settings');
      return;
    }
    const preferred =
      models.find((model) => model.id === defaultModel) ?? models[0];
    const c = await api<Conversation>('/conversations', {
      method: 'POST',
      body: json({ model: preferred.id, projectId }),
    });
    navigate(`/c/${c.id}`);
  };
  const upload = async (file?: File) => {
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    try {
      await api(`/projects/${projectId}/files`, { method: 'POST', body });
      query.invalidateQueries({ queryKey: ['project', projectId] });
      toast('Arquivo adicionado');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro no upload');
    }
  };
  const removeFile = async (id: string) => {
    await api(`/projects/${projectId}/files/${id}`, { method: 'DELETE' });
    query.invalidateQueries({ queryKey: ['project', projectId] });
  };
  const removeProject = async () => {
    if (
      !confirm(
        `Excluir o projeto "${p?.name}"? As conversas continuarão fora dele.`,
      )
    )
      return;
    await api(`/projects/${projectId}`, { method: 'DELETE' });
    navigate('/projects');
  };
  if (!p) return <div className="content-page">Carregando projeto...</div>;
  return (
    <div className="content-page">
      <div className="page-head">
        <div>
          <Link to="/projects" className="back">
            <ArrowLeft size={16} /> Projetos
          </Link>
          <h1>
            {p.emoji} {p.name}
          </h1>
          <p>
            {p.description ||
              'Instruções e arquivos compartilhados com as conversas deste projeto.'}
          </p>
        </div>
        <button className="ghost-button danger" onClick={removeProject}>
          <Trash2 size={17} /> Excluir
        </button>
      </div>
      <div className="project-detail">
        <section>
          <div className="section-head">
            <h2>Conversas</h2>
            <button className="primary-button" onClick={newChat}>
              <Plus size={17} /> Nova conversa
            </button>
          </div>
          {list?.items?.map((c) => (
            <Link className="project-conversation" to={`/c/${c.id}`} key={c.id}>
              {c.title}
            </Link>
          ))}
        </section>
        <section>
          <h2>Instruções personalizadas</h2>
          <p className="help">
            Estas instruções entram no contexto de todas as conversas deste
            projeto.
          </p>
          <textarea
            className="instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={`Como a ${personaName} deve responder neste projeto?`}
          />
          <h2>Arquivos de conhecimento</h2>
          <label
            className="upload"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              upload(e.dataTransfer.files[0]);
            }}
          >
            <Upload size={24} />
            <span>Arraste um arquivo ou clique para enviar</span>
            <small>PDF, texto, Markdown, JSON, CSV e código · até 10 MB</small>
            <input
              hidden
              type="file"
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </label>
          {p.files?.map((f) => (
            <div className="file-row" key={f.id}>
              <FileText size={18} />
              <span>
                {f.filename}
                <small>
                  {Math.round(f.sizeBytes / 1024)} KB · ≈{f.tokenEstimate}{' '}
                  tokens
                </small>
              </span>
              <button
                onClick={() => removeFile(f.id)}
                aria-label="Excluir arquivo"
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
