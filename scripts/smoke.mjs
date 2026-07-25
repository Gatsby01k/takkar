import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const port = 3917;
const server = spawn(process.execPath, ['server/server.mjs'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(port), NODE_ENV: 'development', DEMO_AUTH: 'true' },
  stdio: ['ignore', 'pipe', 'pipe']
});

const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function request(path, options = {}) {
  const response = await fetch(base + path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(body)}`);
  return body;
}

try {
  await sleep(500);

  const client = await readFile(new URL('../public/game.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  if (!client.includes('obstacleContactOffset(obstacle)')) throw new Error('contact geometry missing');
  if (client.includes('distance <= this.wheelR * .58')) throw new Error('legacy early collision threshold still present');
  if (!client.includes('this.preImpactSpeed = this.speed;') || !client.includes('this.speed = 0;')) throw new Error('impact freeze invariant missing');
  if (!client.includes('TAKKAR V12')) throw new Error('desktop V12 launch engine missing');
  if (!html.includes('desktopTelemetry')) throw new Error('desktop telemetry missing');

  const health = await request('/health');
  if (!health.ok) throw new Error('health failed');
  const auth = await request('/api/auth', { method: 'POST', headers: {'content-type':'application/json'}, body: '{}' });
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` };
  let completed = false;
  for (let attempt = 0; attempt < 8 && !completed; attempt++) {
    const round = await request('/api/round/start', { method: 'POST', headers, body: '{"bet":100}' });
    const impact = await request(`/api/round/${round.roundId}/impact`, { method: 'POST', headers, body: '{}' });
    if (impact.status === 'survived') {
      const out = await request(`/api/round/${round.roundId}/cashout`, { method: 'POST', headers, body: '{}' });
      if (out.status !== 'cashed_out' || out.payout <= 0) throw new Error('cashout invariant failed');
      const reveal = await request(`/api/round/${round.roundId}/reveal`, { method: 'GET', headers });
      if (!reveal.seed || reveal.commitment.length !== 64) throw new Error('reveal invariant failed');
      completed = true;
    }
  }
  if (!completed) throw new Error('Could not obtain a survived round during smoke test');
  console.log('TAKKAR smoke test passed');
} finally {
  server.kill('SIGTERM');
}
