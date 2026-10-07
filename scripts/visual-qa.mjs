// UI smoke test with mocked API responses. Requires local Chrome and a running Vite server.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--disable-gpu', '--no-sandbox'],
});
const output = new URL('../docs/', import.meta.url);
await mkdir(output, { recursive: true });
const user = {
  id: 'local',
  email: 'local@llm.lucca',
  name: 'Lucca',
  defaultModel: 'openai:demo',
  systemPrompt: null,
};
const model = {
  id: 'openai:demo',
  provider: 'openai',
  name: 'Modelo de demonstração',
  contextWindow: 128000,
};
let conversation = null;
let messages = [];
const errors = [];
async function inspect(width, height, name) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    const send = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(data),
      });
    if (path === '/api/auth/me') return send({ authMode: 'local', user });
    if (path === '/api/models') return send([model]);
    if (path === '/api/conversations' && req.method() === 'GET')
      return send({
        items: conversation ? [conversation] : [],
        nextCursor: null,
      });
    if (path === '/api/conversations' && req.method() === 'POST') {
      conversation = {
        id: 'c1',
        title: 'Nova conversa',
        model: model.id,
        pinned: false,
        updatedAt: new Date().toISOString(),
      };
      return send(conversation, 201);
    }
    if (path === '/api/conversations/c1' && req.method() === 'GET')
      return send({
        ...conversation,
        messages,
        usageTotals: {
          inputTokens: messages.length ? 20 : 0,
          reasoningTokens: 0,
          outputTokens: messages.length ? 12 : 0,
          responses: messages.length ? 1 : 0,
        },
      });
    if (path === '/api/projects') return send([]);
    if (path === '/api/providers')
      return send({ supported: [], configured: [] });
    if (path === '/api/users/me') return send(user);
    if (path.endsWith('/estimate'))
      return send({ inputTokensEstimate: 25, contextWindow: 128000 });
    if (path.endsWith('/stream')) {
      const body = JSON.parse(req.postData() || '{}');
      messages = [
        { id: 'u1', role: 'user', content: body.content },
        {
          id: 'a1',
          role: 'assistant',
          content: 'Olá! Vamos explorar essa ideia juntos.',
          model: model.id,
          inputTokens: 20,
          reasoningTokens: null,
          outputTokens: 12,
          usageSource: 'provider',
          durationMs: 1500,
        },
      ];
      conversation.title = 'Vamos explorar essa ideia';
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'event: delta\ndata: {"text":"Olá! Vamos explorar essa ideia juntos."}\n\nevent: usage\ndata: {"inputTokens":20,"cachedTokens":0,"reasoningTokens":null,"outputTokens":12,"source":"provider","durationMs":1500}\n\nevent: title\ndata: {"title":"Vamos explorar essa ideia"}\n\nevent: done\ndata: {"messageId":"a1"}\n\n',
      });
    }
    return send({ error: 'Not found' }, 404);
  });
  await page.goto(process.env.QA_URL || 'http://127.0.0.1:4173/');
  await page.getByText('Oi! Eu sou a Lucca').waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL(`../docs/${name}.png`, import.meta.url)),
    fullPage: false,
  });
  console.log(
    name,
    'title',
    await page.title(),
    'heading',
    await page.locator('h1').first().textContent(),
    'overflow',
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  );
  if (name === 'desktop-preview') {
    await page.getByRole('button', { name: /Explicar um conceito/ }).click();
    await page.getByText('Vamos explorar essa ideia juntos.').waitFor();
    console.log('chat loaded', await page.locator('.message').count());
    await page.screenshot({
      path: fileURLToPath(new URL('../docs/chat-preview.png', import.meta.url)),
      fullPage: false,
    });
  }
  await page.close();
}
await inspect(1440, 900, 'desktop-preview');
await inspect(1586, 992, 'native-preview');
await inspect(390, 844, 'mobile-preview');
console.log('page errors', errors);
await browser.close();
if (errors.length) process.exitCode = 1;
