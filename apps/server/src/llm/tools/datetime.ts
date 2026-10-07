import { z } from 'zod';
import { ToolError, type Tool } from './types.js';

export const datetime: Tool<{ timezone?: string }> = {
  name: 'data_hora',
  title: 'Data e hora',
  label: 'Consultando a data e a hora',
  description:
    'Retorna a data e a hora atuais. Use quando a pergunta depender de hoje, de agora ou do dia da semana.',
  parameters: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description:
          'Fuso horário IANA, ex.: America/Sao_Paulo (padrão), Europe/Lisbon, UTC',
      },
    },
  },
  schema: z.object({ timezone: z.string().max(64).optional() }),
  async execute({ timezone }) {
    const timeZone = timezone || 'America/Sao_Paulo';
    try {
      const text = new Intl.DateTimeFormat('pt-BR', {
        timeZone,
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(new Date());
      return `${text} (fuso ${timeZone}; ISO UTC ${new Date().toISOString()})`;
    } catch {
      throw new ToolError(`Fuso horário inválido: ${timeZone}`);
    }
  },
};
