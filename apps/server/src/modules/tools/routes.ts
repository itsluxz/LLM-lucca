import { Router } from 'express';
import { tools } from '../../llm/tools/index.js';
export const toolRoutes = Router();
/** Extensões que o usuário pode ligar e desligar nas Configurações. */
toolRoutes.get('/', (_req, res) => {
  res.json(
    tools.map((t) => ({
      id: t.name,
      title: t.title,
      description: t.description,
    })),
  );
});
