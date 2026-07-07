export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

// ---------- routing ----------

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/signup' && method === 'POST') return signup(request, env);
  if (path === '/api/login' && method === 'POST') return login(request, env);
  if (path === '/api/logout' && method === 'POST') return logout();
  if (path === '/api/me' && method === 'GET') return whoAmI(request, env);

  // everything past this point requires a valid session
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not authenticated' }, 401);

  if (path === '/api/state' && method === 'GET') return getState(request, env, url, user);
  if (path === '/api/tasks' && method === 'POST') return addTask(request, env, user);

  const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && method === 'PATCH') return toggleTask(taskMatch[1], env, user);
  if (taskMatch && method === 'DELETE') return deleteTask(taskMatch[1], env, user);

  if (path === '/api/rollover' && method === 'POST') return doRollover(env, user);

  return json({ error: 'not found' }, 404);
}

// ---------- crypto helpers ----------

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes.buffer;
}
function b64urlEncode(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBuf(saltHex), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bufToHex(bits);
}

function randomSaltHex() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bufToHex(bytes.buffer);
}

async function getSessionSecret(env) {
  if (!env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET not set -- run: wrangler secret put SESSION_SECRET');
  }
  const enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signSession(payloadObj, env) {
  const enc = new TextEncoder();
  const payload = b64urlEncode(enc.encode(JSON.stringify(payloadObj)));
  const key = await getSessionSecret(env);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return payload + '.' + b64urlEncode(sig);
}

async function verifySession(token, env) {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const key = await getSessionSecret(env);
  const enc = new TextEncoder();
  const valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(sig), enc.encode(payload));
  if (!valid) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
  } catch {
    return null;
  }
}

function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  });
  return out;
}

function sessionCookieHeader(token) {
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`; // 30 days
}
function clearCookieHeader() {
  return 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

async function getUserFromRequest(request, env) {
  const cookies = parseCookies(request);
  if (!cookies.session) return null;
  const payload = await verifySession(cookies.session, env);
  if (!payload || !payload.id) return null;
  const row = await env.DB.prepare('SELECT id, username, last_active_date FROM users WHERE id = ?').bind(payload.id).first();
  return row || null;
}

// ---------- auth endpoints ----------

async function signup(request, env) {
  const body = await request.json();
  const username = (body.username || '').trim();
  const password = body.password || '';

  if (username.length < 2 || username.length > 40) return json({ error: 'username must be 2-40 characters' }, 400);
  if (password.length < 8) return json({ error: 'password must be at least 8 characters' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return json({ error: 'username already taken' }, 409);

  const id = crypto.randomUUID();
  const salt = randomSaltHex();
  const passwordHash = await hashPassword(password, salt);
  const createdAt = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, username, passwordHash, salt, createdAt).run();

  const token = await signSession({ id }, env);
  return json({ ok: true, username }, 200, { 'Set-Cookie': sessionCookieHeader(token) });
}

async function login(request, env) {
  const body = await request.json();
  const username = (body.username || '').trim();
  const password = body.password || '';

  const row = await env.DB.prepare('SELECT id, password_hash, salt FROM users WHERE username = ?').bind(username).first();
  if (!row) return json({ error: 'invalid username or password' }, 401);

  const attemptHash = await hashPassword(password, row.salt);
  if (attemptHash !== row.password_hash) return json({ error: 'invalid username or password' }, 401);

  const token = await signSession({ id: row.id }, env);
  return json({ ok: true, username }, 200, { 'Set-Cookie': sessionCookieHeader(token) });
}

function logout() {
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookieHeader() });
}

async function whoAmI(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ authenticated: false });
  return json({ authenticated: true, username: user.username });
}

// ---------- task endpoints (all scoped to the logged-in user) ----------

async function getState(request, env, url, user) {
  const clientDate = url.searchParams.get('date');
  let lastDate = user.last_active_date;

  if (clientDate) {
    if (!lastDate) {
      await env.DB.prepare('UPDATE users SET last_active_date = ? WHERE id = ?').bind(clientDate, user.id).run();
      lastDate = clientDate;
    } else if (clientDate !== lastDate) {
      await rolloverTasks(env, user.id);
      await env.DB.prepare('UPDATE users SET last_active_date = ? WHERE id = ?').bind(clientDate, user.id).run();
      lastDate = clientDate;
    }
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM tasks WHERE user_id = ? ORDER BY created_date ASC'
  ).bind(user.id).all();

  const tasks = results.map(r => ({
    id: r.id,
    text: r.text,
    quadrant: r.quadrant,
    done: !!r.done,
    rollover: !!r.rollover
  }));

  return json({ tasks, lastDate, username: user.username });
}

async function addTask(request, env, user) {
  const body = await request.json();
  const text = (body.text || '').trim();
  const quadrant = String(body.quadrant || '5');
  if (!text) return json({ error: 'text required' }, 400);

  const id = crypto.randomUUID();
  const createdDate = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO tasks (id, user_id, text, quadrant, done, rollover, created_date) VALUES (?, ?, ?, ?, 0, 0, ?)'
  ).bind(id, user.id, text, quadrant, createdDate).run();

  return json({ ok: true, id });
}

async function toggleTask(id, env, user) {
  const row = await env.DB.prepare('SELECT done FROM tasks WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!row) return json({ error: 'not found' }, 404);

  const newDone = row.done ? 0 : 1;
  await env.DB.prepare('UPDATE tasks SET done = ? WHERE id = ? AND user_id = ?').bind(newDone, id, user.id).run();
  return json({ ok: true });
}

async function deleteTask(id, env, user) {
  await env.DB.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  return json({ ok: true });
}

async function rolloverTasks(env, userId) {
  await env.DB.prepare('DELETE FROM tasks WHERE done = 1 AND user_id = ?').bind(userId).run();
  await env.DB.prepare('UPDATE tasks SET rollover = 1 WHERE done = 0 AND user_id = ?').bind(userId).run();
}

async function doRollover(env, user) {
  await rolloverTasks(env, user.id);
  const today = new Date().toISOString().slice(0, 10);
  await env.DB.prepare('UPDATE users SET last_active_date = ? WHERE id = ?').bind(today, user.id).run();
  return json({ ok: true });
}
