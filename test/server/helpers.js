import { createApp } from '../../server/src/app.js';
import { loadConfig } from '../../server/src/config.js';

const quietLog = { warn() {}, error() {}, log() {} };

// Starts the app on a random port. Returns { baseUrl, close }.
export async function startServer(env = {}, deps = {}) {
  const config = loadConfig({ HOPE_LLM_PROVIDER: 'mock', ...env });
  const server = createApp(config, { log: quietLog, ...deps });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

export function postJson(baseUrl, path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: EXTENSION_ORIGIN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export function samplePage(elements) {
  return { url: 'https://clinic.example/book', title: 'Book', headings: ['Book'], text: '', elements };
}
