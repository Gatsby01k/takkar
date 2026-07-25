import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const AUTH_MAX_AGE_SECONDS = Number(process.env.AUTH_MAX_AGE_SECONDS || 3600);
const DEMO_AUTH = process.env.DEMO_AUTH !== 'false' && process.env.NODE_ENV !== 'production';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const multipliers = [1.10, 1.28, 1.54, 2.05, 2.87, 4.11, 5.73, 8.16, 12.40, 18.70, 28.60, 45.00];
const bustWeights = [.215, .18, .145, .115, .09, .07, .052, .04, .032, .025, .02, .016];
const sessions = new Map();
const rounds = new Map();
const wallets = new Map();
const rateBuckets = new Map();

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
};

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(payload);
}

async function readJson(req, max = 32_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function timingSafeHexEqual(a, b) {
  try {
    const aa = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
  } catch { return false; }
}

function validateInitData(initData) {
  if (!BOT_TOKEN) throw new Error('BOT_TOKEN_NOT_CONFIGURED');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('HASH_MISSING');
  params.delete('hash');
  const signature = params.get('signature');
  if (signature) params.delete('signature');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!timingSafeHexEqual(calculated, hash)) throw new Error('INVALID_HASH');
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > AUTH_MAX_AGE_SECONDS) throw new Error('AUTH_EXPIRED');
  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch {}
  if (!user?.id) throw new Error('USER_MISSING');
  return { user, queryId: params.get('query_id') || null, startParam: params.get('start_param') || null };
}

function base64url(input) { return Buffer.from(input).toString('base64url'); }
function signSession(payload) {
  const encoded = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}
function verifySession(token) {
  if (!token) throw new Error('SESSION_MISSING');
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) throw new Error('SESSION_INVALID');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('SESSION_INVALID');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (payload.exp < Date.now()) throw new Error('SESSION_EXPIRED');
  return payload;
}
function bearer(req) { return (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); }

function rateLimit(key, limit = 80, windowMs = 60_000) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > windowMs) { rateBuckets.set(key, { start: now, count: 1 }); return true; }
  bucket.count += 1;
  return bucket.count <= limit;
}

function getWallet(userId) {
  if (!wallets.has(userId)) wallets.set(userId, { balance: 10_000, version: 0 });
  return wallets.get(userId);
}

function chooseBust(seed) {
  const roll = seed.readUInt32BE(0) / 0xffffffff;
  let sum = 0;
  for (let i = 0; i < bustWeights.length; i++) { sum += bustWeights[i]; if (roll < sum) return i + 1; }
  return bustWeights.length;
}

function roundPublic(round) {
  return { roundId: round.id, commitment: round.commitment, status: round.status, currentMultiplier: round.currentMultiplier, impactCount: round.impactCount, createdAt: round.createdAt };
}

async function routeApi(req, res, url) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (!rateLimit(ip)) return json(res, 429, { error: 'RATE_LIMITED' });
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'takkar-server', time: new Date().toISOString() });

  if (req.method === 'POST' && url.pathname === '/api/auth') {
    try {
      const body = await readJson(req);
      let user;
      if (body.initData) user = validateInitData(body.initData).user;
      else if (DEMO_AUTH) user = { id: `demo-${ip}`, first_name: 'Demo', username: 'demo_player' };
      else throw new Error('TELEGRAM_INIT_DATA_REQUIRED');
      const sessionId = crypto.randomUUID();
      const payload = { sid: sessionId, uid: String(user.id), exp: Date.now() + 6 * 60 * 60 * 1000 };
      const token = signSession(payload);
      sessions.set(sessionId, { user, createdAt: Date.now() });
      const wallet = getWallet(payload.uid);
      return json(res, 200, { token, user, balance: wallet.balance, mode: BOT_TOKEN ? 'telegram-demo-ledger' : 'browser-demo-ledger' });
    } catch (error) { return json(res, 401, { error: error.message || 'AUTH_FAILED' }); }
  }

  let session;
  try { session = verifySession(bearer(req)); }
  catch (error) { return json(res, 401, { error: error.message || 'UNAUTHORIZED' }); }
  if (!rateLimit(`user:${session.uid}`, 120)) return json(res, 429, { error: 'RATE_LIMITED' });

  if (req.method === 'POST' && url.pathname === '/api/round/start') {
    try {
      const body = await readJson(req);
      const bet = Math.round(Number(body.bet) / 10) * 10;
      if (!Number.isFinite(bet) || bet < 10 || bet > 100_000) throw new Error('INVALID_BET');
      const wallet = getWallet(session.uid);
      if (wallet.balance < bet) throw new Error('INSUFFICIENT_BALANCE');
      const active = [...rounds.values()].find((r) => r.userId === session.uid && r.status === 'active');
      if (active) throw new Error('ACTIVE_ROUND_EXISTS');
      const seed = crypto.randomBytes(32);
      const id = `TK-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const bustAt = chooseBust(seed);
      const odRoll = seed.readUInt32BE(4) / 0xffffffff;
      const overdriveAt = bustAt >= 8 && odRoll < .56 ? (odRoll < .28 ? 6 : 7) : null;
      const commitment = crypto.createHash('sha256').update(seed).digest('hex');
      wallet.balance -= bet; wallet.version += 1;
      const round = { id, userId: session.uid, bet, seed: seed.toString('hex'), commitment, bustAt, overdriveAt, impactCount: 0, currentMultiplier: 1, status: 'active', createdAt: Date.now(), settledAt: null, payout: 0 };
      rounds.set(id, round);
      return json(res, 200, { ...roundPublic(round), balance: wallet.balance });
    } catch (error) { return json(res, 400, { error: error.message || 'ROUND_START_FAILED' }); }
  }

  const impactMatch = url.pathname.match(/^\/api\/round\/([^/]+)\/impact$/);
  if (req.method === 'POST' && impactMatch) {
    const round = rounds.get(decodeURIComponent(impactMatch[1]));
    if (!round || round.userId !== session.uid) return json(res, 404, { error: 'ROUND_NOT_FOUND' });
    if (round.status !== 'active') return json(res, 409, { error: 'ROUND_NOT_ACTIVE', status: round.status });
    round.impactCount += 1;
    if (round.impactCount === round.bustAt) {
      round.status = 'destroyed'; round.settledAt = Date.now();
      return json(res, 200, { status: 'destroyed', impactCount: round.impactCount, balance: getWallet(session.uid).balance });
    }
    round.currentMultiplier = multipliers[Math.min(round.impactCount - 1, multipliers.length - 1)];
    return json(res, 200, { status: 'survived', impactCount: round.impactCount, multiplier: round.currentMultiplier, overdrive: round.overdriveAt === round.impactCount, damageStage: Math.min(7, round.impactCount) });
  }

  const cashoutMatch = url.pathname.match(/^\/api\/round\/([^/]+)\/cashout$/);
  if (req.method === 'POST' && cashoutMatch) {
    const round = rounds.get(decodeURIComponent(cashoutMatch[1]));
    if (!round || round.userId !== session.uid) return json(res, 404, { error: 'ROUND_NOT_FOUND' });
    if (round.status !== 'active') return json(res, 409, { error: 'ROUND_NOT_ACTIVE', status: round.status });
    round.status = 'cashed_out'; round.settledAt = Date.now(); round.payout = Math.round(round.bet * round.currentMultiplier);
    const wallet = getWallet(session.uid); wallet.balance += round.payout; wallet.version += 1;
    return json(res, 200, { status: round.status, payout: round.payout, multiplier: round.currentMultiplier, balance: wallet.balance });
  }

  const revealMatch = url.pathname.match(/^\/api\/round\/([^/]+)\/reveal$/);
  if (req.method === 'GET' && revealMatch) {
    const round = rounds.get(decodeURIComponent(revealMatch[1]));
    if (!round || round.userId !== session.uid) return json(res, 404, { error: 'ROUND_NOT_FOUND' });
    if (round.status === 'active') return json(res, 409, { error: 'ROUND_STILL_ACTIVE' });
    return json(res, 200, { ...roundPublic(round), seed: round.seed, bustAt: round.bustAt, overdriveAt: round.overdriveAt, payout: round.payout });
  }
  return json(res, 404, { error: 'NOT_FOUND' });
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const resolved = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: 'FORBIDDEN' });
  try {
    const data = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mime[ext] || 'application/octet-stream', 'Content-Length': data.length,
      'Cache-Control': /\/assets\//.test(pathname) ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org;"
    });
    res.end(data);
  } catch {
    if (!path.extname(pathname)) {
      try { const data = await fs.readFile(path.join(PUBLIC_DIR, 'index.html')); res.writeHead(200, { 'Content-Type': mime['.html'], 'Content-Length': data.length, 'Cache-Control': 'no-cache' }); return res.end(data); } catch {}
    }
    return json(res, 404, { error: 'NOT_FOUND' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  try {
    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) return await routeApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) { console.error(error); return json(res, 500, { error: 'INTERNAL_ERROR' }); }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TAKKAR server listening on :${PORT}`);
  if (!BOT_TOKEN) console.warn('TELEGRAM_BOT_TOKEN is not configured; browser demo auth is available only outside production.');
});
