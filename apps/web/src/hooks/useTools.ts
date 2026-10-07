import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import type { ToolInfo } from '../types';
/** Extensões disponíveis no servidor (a lista só muda com um deploy). */
export const toolsQuery = {
  queryKey: ['tools'],
  queryFn: () => api<ToolInfo[]>('/tools'),
  staleTime: Infinity,
};
export const useTools = () => useQuery(toolsQuery);
