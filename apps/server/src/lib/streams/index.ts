import { env } from '../../config/env.js';
export interface StreamRegistry {
  register(key: string, controller: AbortController): Promise<void>;
  stop(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}
class MemoryStreams implements StreamRegistry {
  private map = new Map<string, AbortController>();
  async register(key: string, c: AbortController) {
    if (this.map.has(key))
      throw new Error('Já existe uma geração nesta conversa');
    this.map.set(key, c);
  }
  async stop(key: string) {
    const c = this.map.get(key);
    if (!c) return false;
    c.abort();
    return true;
  }
  async remove(key: string) {
    this.map.delete(key);
  }
}
class RedisStreams implements StreamRegistry {
  register(): Promise<void> {
    throw new Error('STREAM_REGISTRY_DRIVER=redis ainda não implementado');
  }
  stop(): Promise<boolean> {
    throw new Error('STREAM_REGISTRY_DRIVER=redis ainda não implementado');
  }
  remove(): Promise<void> {
    throw new Error('STREAM_REGISTRY_DRIVER=redis ainda não implementado');
  }
}
export const streams: StreamRegistry =
  env.STREAM_REGISTRY_DRIVER === 'memory'
    ? new MemoryStreams()
    : new RedisStreams();
