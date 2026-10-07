import { Router } from 'express';
import { keyOwnerId, uid } from '../../middlewares/auth.js';
import { asyncRoute } from '../../middlewares/error.js';
import { listUserModels } from './service.js';
export const modelRoutes = Router();
modelRoutes.get(
  '/',
  asyncRoute(async (req, res) =>
    res.json(await listUserModels(await keyOwnerId(uid(req)))),
  ),
);
