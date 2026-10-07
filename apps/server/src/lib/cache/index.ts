import { env } from '../../config/env.js';
export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
}
class MemoryCache implements CacheStore {
  private values = new Map<string, { data: unknown; expires: number }>();
  async get<T>(key: string): Promise<T | null> {
    const v = this.values.get(key);
    if (!v || v.expires < Date.now()) {
      this.values.delete(key);
      return null;
    }
    return v.data as T;
  }
  async set<T>(key: string, value: T, ttlMs: number) {
    this.values.set(key, { data: value, expires: Date.now() + ttlMs });
  }
  async del(key: string) {
    this.values.delete(key);
  }
}
class RedisCache implements CacheStore {
  get<T>(): Promise<T | null> {
    throw new Error('CACHE_DRIVER=redis ainda não implementado');
  }
  set<T>(_key: string, _value: T, _ttlMs: number): Promise<void> {
    throw new Error('CACHE_DRIVER=redis ainda não implementado');
  }
  del(): Promise<void> {
    throw new Error('CACHE_DRIVER=redis ainda não implementado');
  }
}
export const cache: CacheStore =
  env.CACHE_DRIVER === 'memory' ? new MemoryCache() : new RedisCache();
