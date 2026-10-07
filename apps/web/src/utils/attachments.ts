/** Arquivo de texto anexado a uma mensagem (o conteúdo vai para o modelo). */
export type Attachment = { name: string; content: string };

/** Imagem anexada (já enviada ao servidor; `url` é /api/images/...). */
export type ImageAttachment = { name: string; url: string };

const block = /<arquivo nome="([^"]*)">\n?([\s\S]*?)\n?<\/arquivo>/g;
const imageBlock = /!\[([^\]]*)\]\((\/api\/images\/img_[A-Za-z0-9]+_[a-f0-9]{24})\)/g;

/** Junta o texto digitado, as imagens e os arquivos no formato salvo na mensagem. */
export function withAttachments(
  text: string,
  files: Attachment[],
  images: ImageAttachment[] = [],
): string {
  const pics = images.map((i) => `![${i.name.replace(/[[\]\n]/g, ' ')}](${i.url})`);
  const parts = files.map(
    (f) =>
      `<arquivo nome="${f.name.replace(/"/g, "'")}">\n${f.content}\n</arquivo>`,
  );
  return [text.trim(), pics.join('\n'), ...parts].filter(Boolean).join('\n\n');
}

/** Separa imagens e arquivos do texto, para exibir cada um à parte. */
export function splitAttachments(content: string): {
  text: string;
  files: Attachment[];
  images: ImageAttachment[];
} {
  const files: Attachment[] = [];
  const images: ImageAttachment[] = [];
  const text = content
    .replace(block, (_m, name: string, body: string) => {
      files.push({ name, content: body });
      return '';
    })
    .replace(imageBlock, (_m, name: string, url: string) => {
      images.push({ name, url });
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, files, images };
}

export function describeSize(content: string): string {
  const lines = content.split('\n').length;
  const kb = new Blob([content]).size / 1024;
  return `${lines} ${lines === 1 ? 'linha' : 'linhas'} · ${
    kb < 1 ? '<1' : kb.toFixed(kb < 10 ? 1 : 0).replace('.', ',')
  } KB`;
}
