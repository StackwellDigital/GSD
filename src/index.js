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

    // everything else -> static files from /public
    return env.ASSETS.fetch(request);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/state' && method === 'GET') {
    return getState(request, env, url);
  }

  if (path === '/api/tasks' && method === 'POST') {
    return addTask(request, env);
  }

  const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && method === 'PATCH') {
    return toggleTask(taskMatch[1], env);
  }
  if (taskMatch && method === 'DELETE') {
    return deleteTask(taskMatch[1], env);
  }

  if (path === '/api/rollover' && method === 'POST') {
    return doRollover(env);
  }

  return json({ error: 'not found' }, 404);
}

async function getMeta(env, key) {
  const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

async function setMeta(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, value).run();
}

// GET /api/state?date=YYYY-MM-DD
// Returns current tasks. If the client's local date has moved past the
// last recorded active date, auto-rolls-over before responding.
async function getState(request, env, url) {
  const clientDate = url.searchParams.get('date');
  let lastDate = await getMeta(env, 'last_active_date');

  if (clientDate) {
    if (!lastDate) {
      await setMeta(env, 'last_active_date', clientDate);
      lastDate = clientDate;
    } else if (clientDate !== lastDate) {
      await rolloverTasks(env);
      await setMeta(env, 'last_active_date', clientDate);
      lastDate = clientDate;
    }
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM tasks ORDER BY created_date ASC'
  ).all();

  const tasks = results.map(r => ({
    id: r.id,
    text: r.text,
    quadrant: r.quadrant,
    done: !!r.done,
    rollover: !!r.rollover
  }));

  return json({ tasks, lastDate });
}

async function addTask(request, env) {
  const body = await request.json();
  const text = (body.text || '').trim();
  const quadrant = String(body.quadrant || '5');
  if (!text) return json({ error: 'text required' }, 400);

  const id = crypto.randomUUID();
  const createdDate = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO tasks (id, text, quadrant, done, rollover, created_date) VALUES (?, ?, ?, 0, 0, ?)'
  ).bind(id, text, quadrant, createdDate).run();

  return json({ ok: true, id });
}

async function toggleTask(id, env) {
  const row = await env.DB.prepare('SELECT done FROM tasks WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'not found' }, 404);

  const newDone = row.done ? 0 : 1;
  await env.DB.prepare('UPDATE tasks SET done = ? WHERE id = ?').bind(newDone, id).run();
  return json({ ok: true });
}

async function deleteTask(id, env) {
  await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function rolloverTasks(env) {
  await env.DB.prepare('DELETE FROM tasks WHERE done = 1').run();
  await env.DB.prepare('UPDATE tasks SET rollover = 1 WHERE done = 0').run();
}

async function doRollover(env) {
  await rolloverTasks(env);
  const today = new Date().toISOString().slice(0, 10);
  await setMeta(env, 'last_active_date', today);
  return json({ ok: true });
}
