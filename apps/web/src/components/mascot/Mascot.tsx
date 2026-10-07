import { useAuthStore, usePersonaName } from '../../stores/authStore';
import type { MascotMood } from '../../types';
/** Imagem padrão de cada pose; o perfil pode substituir qualquer uma. */
export const defaultMascot = (mood: MascotMood) => `/mascot/mascot-${mood}.png`;
export function Mascot({
  mood = 'idle',
  size = 48,
  animated = false,
}: {
  mood?: MascotMood;
  size?: number;
  animated?: boolean;
}) {
  const personaName = usePersonaName();
  const custom = useAuthStore((s) => s.user?.personaImages?.[mood]);
  return (
    <img
      className={`mascot ${animated ? 'mascot-animated ' + mood : ''}`}
      src={custom || defaultMascot(mood)}
      width={size}
      height={size}
      alt={`Mascote ${personaName}`}
    />
  );
}
