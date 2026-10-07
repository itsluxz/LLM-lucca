import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.js';
export interface StorageDriver { put(key: string, data: Buffer): Promise<void>; get(key: string): Promise<Buffer>; delete(key: string): Promise<void> }
class LocalStorage implements StorageDriver {
  private base = path.resolve(existsSync(path.join(process.cwd(),'apps','server','package.json'))?process.cwd():path.resolve(process.cwd(),'../..'),env.STORAGE_LOCAL_PATH);
  private location(key:string) { if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Chave de arquivo inválida'); return path.join(this.base,key); }
  async put(key:string,data:Buffer) { await mkdir(this.base,{recursive:true}); await writeFile(this.location(key),data); }
  get(key:string) { return readFile(this.location(key)); }
  async delete(key:string) { await unlink(this.location(key)); }
}
class S3Storage implements StorageDriver {
  put():Promise<void> { throw new Error('STORAGE_DRIVER=s3 ainda não implementado'); }
  get():Promise<Buffer> { throw new Error('STORAGE_DRIVER=s3 ainda não implementado'); }
  delete():Promise<void> { throw new Error('STORAGE_DRIVER=s3 ainda não implementado'); }
}
export const storage:StorageDriver = env.STORAGE_DRIVER === 'local' ? new LocalStorage() : new S3Storage();
