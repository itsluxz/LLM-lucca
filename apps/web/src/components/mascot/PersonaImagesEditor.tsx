import { useRef, useState } from 'react';
import { RotateCcw, Upload } from 'lucide-react';
import { api, json } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import type { MascotMood, User } from '../../types';
import { defaultMascot } from './Mascot';

const poses: Array<{ mood: MascotMood; label: string; where: string }> = [
  { mood: 'hello', label: 'Boas-vindas', where: 'Tela de nova conversa e login' },
  { mood: 'thinking', label: 'Pensando', where: 'Enquanto a IA gera a resposta' },
  { mood: 'wink', label: 'Sucesso', where: 'Avisos de sucesso e página 404' },
  { mood: 'idle', label: 'Avatar', where: 'Respostas, logo da sidebar e erros' },
];
const maxChars = 440_000;

/**
 * Reduz para no máximo `side` px (sem ampliar, para não borrar pixel art) e
 * mantém a transparência (PNG; WebP se o PNG ficar grande demais).
 */
async function resizePersonaImage(file: File, side = 512): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível');
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const png = canvas.toDataURL('image/png');
  if (png.length <= maxChars) return png;
  const webp = canvas.toDataURL('image/webp', 0.9);
  if (webp.startsWith('data:image/webp') && webp.length <= maxChars) return webp;
  if (side > 256) return resizePersonaImage(file, Math.round(side * 0.7));
  throw new Error('Imagem grande demais');
}

export function PersonaImagesEditor() {
  const user = useAuthStore((s) => s.user);
  const toast = useUiStore((s) => s.showToast);
  const [busy, setBusy] = useState<MascotMood | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<MascotMood>('idle');
  const save = async (mood: MascotMood, image: string | null) => {
    setBusy(mood);
    try {
      const u = await api<User>('/users/me/persona-images', {
        method: 'PATCH',
        body: json({ mood, image }),
      });
      useAuthStore.getState().setSession(u, useAuthStore.getState().mode ?? 'local');
      toast(image ? 'Imagem da persona atualizada' : 'Imagem padrão restaurada');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro ao salvar imagem');
    } finally {
      setBusy(null);
    }
  };
  const pick = async (file?: File) => {
    if (!file) return;
    try {
      await save(target.current, await resizePersonaImage(file));
    } catch (e) {
      toast(
        e instanceof Error && e.message === 'Imagem grande demais'
          ? 'Imagem grande demais, tente uma menor'
          : 'Não foi possível ler esta imagem',
      );
    }
  };
  return (
    <div className="persona-images">
      <div>
        <strong>Imagens da persona</strong>
        <p>
          Substituem o mascote em cada situação. Use PNG com fundo transparente
          para o melhor resultado.
        </p>
      </div>
      <div className="persona-grid">
        {poses.map(({ mood, label, where }) => {
          const custom = user?.personaImages?.[mood];
          return (
            <div className="persona-slot" key={mood}>
              <img
                src={custom || defaultMascot(mood)}
                alt={label}
                className="mascot"
              />
              <strong>{label}</strong>
              <small>{where}</small>
              <div className="persona-actions">
                <button
                  className="ghost-button"
                  disabled={busy !== null}
                  onClick={() => {
                    target.current = mood;
                    input.current?.click();
                  }}
                >
                  <Upload size={14} /> {busy === mood ? 'Salvando...' : 'Trocar'}
                </button>
                {custom && (
                  <button
                    className="ghost-button"
                    title="Voltar para a imagem padrão"
                    disabled={busy !== null}
                    onClick={() => save(mood, null)}
                  >
                    <RotateCcw size={14} /> Padrão
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
