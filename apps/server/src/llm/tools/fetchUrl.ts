import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { z } from 'zod';
import { ToolError, type Tool } from './types.js';

const maxBytes = 2 * 1024 * 1024;
const maxChars = 15000;
const maxRedirects = 5;
const timeoutMs = 15000;

/** Redes que não podem ser acessadas: loopback, privadas, link-local, multicast etc. */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return blocked.check(mapped, 'ipv4');
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) return blocked.check(address, 'ipv6');
  return true;
}

/** Aceita só http(s) para hosts públicos (evita que o modelo acesse a rede interna). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolError('URL inválida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new ToolError('Só endereços http e https são permitidos');
  if (url.username || url.password)
    throw new ToolError('URLs com usuário e senha não são permitidas');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host))
    throw new ToolError('Endereços da rede local não são permitidos');
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true, verbatim: true })
        .then((list) => list.map((a) => a.address))
        .catch(() => {
          throw new ToolError(`Não foi possível encontrar o site ${host}`);
        });
  if (!addresses.length || addresses.some(isBlockedAddress))
    throw new ToolError('Endereços da rede local ou privada não são permitidos');
  return url;
}

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff
        ? String.fromCodePoint(n)
        : m;
    }
    return entities[code.toLowerCase()] ?? m;
  });
}

/** Extrai o texto legível de um HTML (sem scripts, estilos e tags). */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities(
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '',
  );
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(script|style|noscript|svg|template|iframe|head|nav|footer)\b[\s\S]*?<\/\1>/gi,
      ' ',
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote|pre)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

async function readLimited(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export const fetchUrl: Tool<{ url: string }> = {
  name: 'ler_link',
  title: 'Ler link',
  label: 'Lendo o link',
  description:
    'Baixa uma página da web pública e devolve o texto dela. Use quando o usuário enviar um link ou pedir o conteúdo de um site específico.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Endereço completo, começando com http:// ou https://',
      },
    },
    required: ['url'],
  },
  schema: z.object({ url: z.string().min(1).max(2000) }),
  async execute({ url: raw }, ctx) {
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]);
    let url = await assertPublicUrl(raw);
    let res: Response | null = null;
    // redirecionamentos manuais: cada destino passa pela mesma verificação
    for (let hop = 0; hop <= maxRedirects; hop++) {
      res = await fetch(url, {
        signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LLM-Lucca/1.0)',
          Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5',
        },
      }).catch((e: unknown) => {
        if (signal.aborted && !ctx.signal.aborted)
          throw new ToolError('O site demorou demais para responder');
        throw e instanceof ToolError
          ? e
          : new ToolError(`Não foi possível acessar ${url.hostname}`);
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        if (hop === maxRedirects) throw new ToolError('Redirecionamentos demais');
        url = await assertPublicUrl(new URL(location, url).toString());
        continue;
      }
      break;
    }
    if (!res) throw new ToolError('Sem resposta do site');
    if (!res.ok) {
      await res.body?.cancel();
      throw new ToolError(`O site respondeu com erro ${res.status}`);
    }
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    const isHtml = type.includes('html');
    if (!isHtml && !/^text\/|json|xml/.test(type)) {
      await res.body?.cancel();
      throw new ToolError(
        `Esse link não é uma página de texto (${type || 'tipo desconhecido'})`,
      );
    }
    const body = await readLimited(res);
    const { title, text } = isHtml
      ? htmlToText(body)
      : { title: '', text: body.trim() };
    if (!text) throw new ToolError('A página não tem texto legível');
    const header = `URL: ${url.toString()}` + (title ? `\nTítulo: ${title}` : '');
    const content =
      text.length > maxChars
        ? `${text.slice(0, maxChars)}\n\n[conteúdo cortado: a página é maior]`
        : text;
    return `${header}\n\n${content}`;
  },
};
