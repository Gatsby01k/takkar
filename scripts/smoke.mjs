import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const port = 3917;
const server = spawn(process.execPath, ['server/server.mjs'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(port), NODE_ENV: 'development', DEMO_AUTH: 'true' },
  stdio: ['ignore', 'pipe', 'pipe']
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const base = `http://127.0.0.1:${port}`;

try {
  await sleep(500);
  const client = await readFile(new URL('../public/arcade-v3.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  if (!client.includes("this.phase = 'impact'")) throw new Error('impact state missing');
  if (!client.includes('contactOffset(o)')) throw new Error('per-obstacle contact geometry missing');
  if (!client.includes("const success = ratio >= .73")) throw new Error('deterministic impact rule missing');
  if (!client.includes('wheelSquashV')) throw new Error('wheel deformation spring missing');
  if (!html.includes('arcade-v3.js?v=3.0.0')) throw new Error('TAKKAR Arcade 3 runtime not active');


  const health = await fetch(`${base}/health`).then((r) => r.json());
  if (!health.ok) throw new Error('health failed');
  const page = await fetch(base).then((r) => r.text());
  if (!page.includes('TAKKAR — Ek Aur Takkar?')) throw new Error('new arcade page is not served');
  const js = await fetch(`${base}/arcade-v3.js?v=3.0.0`).then((r) => r.text());
  if (!js.includes('window.__TAKKAR__')) throw new Error('arcade runtime is not served');

  console.log('TAKKAR Arcade 3.0 smoke test passed');
} finally {
  server.kill('SIGTERM');
}
