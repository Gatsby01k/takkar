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
  const client = await readFile(new URL('../public/arcade.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/arcade.css', import.meta.url), 'utf8');

  for (const marker of ['fixed = 1 / 120', 'spawnObstacle()', 'impact()', 'bankRun()', 'updateEngine', 'TIRE STACK', 'DELIVERY TRUCK']) {
    if (!client.includes(marker)) throw new Error(`arcade runtime marker missing: ${marker}`);
  }
  for (const marker of ['arcade.js?v=2.0.0', 'arcade.css?v=2.0.0', 'EK AUR TAKKAR?', 'garageSheet']) {
    if (!html.includes(marker)) throw new Error(`arcade html marker missing: ${marker}`);
  }
  if (!css.includes('.perfect.show') || !css.includes('.garage-sheet.open')) throw new Error('arcade styles incomplete');

  const health = await fetch(`${base}/health`).then((r) => r.json());
  if (!health.ok) throw new Error('health failed');
  const page = await fetch(base).then((r) => r.text());
  if (!page.includes('TAKKAR — One More Hit')) throw new Error('new arcade page is not served');
  const js = await fetch(`${base}/arcade.js?v=2.0.0`).then((r) => r.text());
  if (!js.includes('window.__TAKKAR_ARCADE__')) throw new Error('arcade runtime is not served');

  console.log('TAKKAR Arcade 2.0 smoke test passed');
} finally {
  server.kill('SIGTERM');
}
