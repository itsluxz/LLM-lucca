export async function readSse(
  res: Response,
  onEvent: (event: string, data: Record<string, unknown>) => void,
) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Falha na geração' }));
    throw new Error(body.error ?? 'Falha na geração');
  }
  if (!res.body) throw new Error('Stream indisponível');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
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
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) {
        try {
          onEvent(event, JSON.parse(data) as Record<string, unknown>);
        } catch {
          continue;
        }
      }
    }
  }
}
