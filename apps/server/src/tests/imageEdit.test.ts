import { afterEach, describe, expect, it, vi } from 'vitest';

// PNG mínimo (assinatura) para o sniff de tipo aceitar
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const stored = new Map<string, Buffer>();
vi.mock('../lib/storage/index.js', () => ({
  storage: {
    put: vi.fn(async (k: string, d: Buffer) => void stored.set(k, d)),
    get: vi.fn(async (k: string) => {
      const d = stored.get(k);
      if (!d) throw new Error('não existe');
      return d;
    }),
    delete: vi.fn(),
  },
}));

const { openai } = await import('../llm/providers/openai.js');
const { referenceImages } = await import('../modules/chat/routes.js');

const ok = () =>
  new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), {
    status: 200,
  });
const params = {
  apiKey: 'k',
  model: 'gpt-image-2',
  prompt: 'retire a menina da direita',
  signal: new AbortController().signal,
};
const photo = { mimeType: 'image/jpeg', data: png.toString('base64') };
afterEach(() => vi.unstubAllGlobals());

describe('edição de imagens', () => {
  it('sem referência, cria do zero em /images/generations', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    await openai.generateImage!(params);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/images\/generations$/);
  });

  it('com a foto enviada, edita em /images/edits mandando a imagem', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const result = await openai.generateImage!({ ...params, images: [photo] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/images\/edits$/);
    const form = init.body as FormData;
    expect(form.get('prompt')).toBe('retire a menina da direita');
    expect(form.get('model')).toBe('gpt-image-2');
    const file = form.getAll('image[]')[0] as File;
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('imagem-1.jpg');
    expect(Buffer.from(await file.arrayBuffer())).toEqual(png);
    // multipart: o fetch define o Content-Type com o boundary sozinho
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
    expect(result.data).toEqual(png);
  });

  it('recusa com mensagem clara o que não dá para editar', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      openai.generateImage!({ ...params, model: 'dall-e-3', images: [photo] }),
    ).rejects.toThrow('gpt-image');
    await expect(
      openai.generateImage!({ ...params, images: [{ mimeType: 'image/gif', data: 'R0lG' }] }),
    ).rejects.toThrow('PNG, JPEG ou WebP');
  });

  it('usa a foto da mensagem atual ou, sem ela, a imagem mais recente da conversa', async () => {
    stored.set('img_u1_' + 'a'.repeat(24), png);
    stored.set('img_u1_' + 'b'.repeat(24), png);
    stored.set('img_outro_' + 'c'.repeat(24), png);
    const history = [
      { content: `![](/api/images/img_u1_${'a'.repeat(24)}) primeira` },
      { content: `![gerada](/api/images/img_u1_${'b'.repeat(24)})` },
      { content: 'agora deixa o fundo azul' },
    ];
    expect(
      await referenceImages('u1', { role: 'user', content: 'x', images: [photo] }, history),
    ).toEqual([photo]);
    const fromHistory = await referenceImages('u1', { role: 'user', content: 'azul' }, history);
    expect(fromHistory).toEqual([{ mimeType: 'image/png', data: png.toString('base64') }]);
    // imagens de outro usuário nunca entram
    expect(
      await referenceImages('u1', undefined, [
        { content: `![](/api/images/img_outro_${'c'.repeat(24)})` },
      ]),
    ).toEqual([]);
    expect(await referenceImages('u1', undefined, [{ content: 'sem imagem' }])).toEqual([]);
  });
});
