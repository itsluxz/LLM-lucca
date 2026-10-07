import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
export const signAccess = (userId: string) =>
  jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
export const verifyAccess = (token: string): string => {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (typeof payload === 'string' || !payload.sub)
    throw new Error('Token inválido');
  return payload.sub;
};
