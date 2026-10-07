import { rateLimit } from 'express-rate-limit';
export const authLimit = rateLimit({
  windowMs: 60000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
export const chatLimit = rateLimit({
  windowMs: 60000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.userId!,
});
