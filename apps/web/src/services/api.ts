import { useAuthStore } from '../stores/authStore';
const base = import.meta.env.VITE_API_URL || '/api';
/** Token de acesso (modo multi) e perfil ativo (modo local). */
export function authHeaders(): Record<string, string> {
  const { token, profileId } = useAuthStore.getState();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(profileId ? { 'X-Profile-Id': profileId } : {}),
  };
}
export async function api<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(authHeaders())) headers.set(k, v);
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const res = await fetch(base + path, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (
    res.status === 401 &&
    retry &&
    path !== '/auth/refresh' &&
    (useAuthStore.getState().mode === 'multi' || path === '/auth/me')
  ) {
    const refresh = await fetch(base + '/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (refresh.ok) {
      const data = (await refresh.json()) as {
        accessToken: string;
        user: import('../types').User;
      };
      useAuthStore.getState().setSession(data.user, 'multi', data.accessToken);
      return api<T>(path, init, false);
    }
    useAuthStore.getState().setSession(null, 'multi', null);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Erro de conexão' }));
    throw new Error(body.error ?? `Erro ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
export const json = (data: unknown) => JSON.stringify(data);
export const apiBase = base;
