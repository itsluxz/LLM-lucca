export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<{ event: string; data: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(
        /\r\n/g,
        '\n',
      );
      let at: number;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        let event = 'message';
        const data: string[] = [];
        for (const line of block.split('\n')) {
          const clean = line.replace(/\r$/, '');
          if (clean.startsWith('event:')) event = clean.slice(6).trim();
          if (clean.startsWith('data:')) data.push(clean.slice(5).trimStart());
        }
        if (data.length) yield { event, data: data.join('\n') };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
async function providerDetail(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    try {
      const body = JSON.parse(text) as {
        error?: { message?: unknown } | string;
        message?: unknown;
      };
      const message =
        typeof body.error === 'string'
          ? body.error
          : typeof body.error?.message === 'string'
            ? body.error.message
            : typeof body.message === 'string'
              ? body.message
              : null;
      if (message) return message.slice(0, 300);
    } catch {
      // corpo não é JSON: não repassar texto bruto
    }
    return null;
  } catch {
    return null;
  }
}
export async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  const base =
    response.status === 401
      ? 'Chave de API inválida'
      : response.status === 429
        ? 'Limite de requisições do provedor atingido'
        : response.status >= 500
          ? 'O provedor está indisponível'
          : response.status === 404
            ? 'Modelo ou endpoint não encontrado no provedor (404)'
            : `Erro do provedor (${response.status})`;
  const detail = [400, 403, 404].includes(response.status)
    ? await providerDetail(response)
    : null;
  const reason = detail ? `${base}: ${detail}` : base;
  throw Object.assign(new Error(reason), {
    status: response.status === 401 ? 400 : response.status === 429 ? 429 : 502,
    expose: true,
  });
}
