import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import type { Model } from '../types';
export const useModels = () =>
  useQuery({
    queryKey: ['models'],
    queryFn: () => api<Model[]>('/models'),
    staleTime: 600000,
  });
