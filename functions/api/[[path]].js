/**
 * Cloudflare Workers API for 99 Wisdom Book
 *
 * Auth endpoints:
 * - POST   /api/auth/login
 * - POST   /api/auth/register
 *
 * User endpoints:
 * - GET    /api/users                       (admin)
 * - GET    /api/users/:id
 * - PUT    /api/users/:id                   (admin)
 * - DELETE /api/users/:id                   (admin)
 * - PUT    /api/users/:id/permissions       (admin)
 *
 * Wisdom / Phase 2+3:
 * - GET    /api/wisdom/saved                (auth)
 * - POST   /api/wisdom/save                 (auth)
 * - DELETE /api/wisdom/save/:chapter_id     (auth)
 * - POST   /api/wisdom/streak               (auth)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// Token = btoa(`${user.id}:${timestamp}`)
function getUserIdFromToken(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const decoded = atob(auth.slice(7));
    const id = parseInt(decoded.split(':')[0], 10);
    return isNaN(id) ? null : id;
  } catch { return null; }
}

function verifyAdmin(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  return token && token.length > 10;
}

// ── Router ──────────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;
  const path = new URL(request.url).pathname;
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // Auth
    if (path === '/api/auth/login'    && method === 'POST') return handleLogin(request, env);
    if (path === '/api/auth/register' && method === 'POST') return handleRegister(request, env);

    // Wisdom – saved (보관함)
    if (path === '/api/wisdom/saved' && method === 'GET')  return handleGetSaved(request, env);
    if (path === '/api/wisdom/save'  && method === 'POST') return handleSaveWisdom(request, env);
    if (path.match(/^\/api\/wisdom\/save\/\d+$/) && method === 'DELETE') {
      return handleUnsaveWisdom(path.split('/').pop(), request, env);
    }

    // Wisdom – streak (스트릭)
    if (path === '/api/wisdom/streak' && method === 'POST') return handleStreak(request, env);

    // Users
    if (path === '/api/users' && method === 'GET') return handleGetUsers(request, env);
    if (path.match(/^\/api\/users\/\d+$/) && method === 'GET')    return handleGetUser(path.split('/').pop(), env);
    if (path.match(/^\/api\/users\/\d+$/) && method === 'PUT')    return handleUpdateUser(path.split('/').pop(), request, env);
    if (path.match(/^\/api\/users\/\d+$/) && method === 'DELETE') return handleDeleteUser(path.split('/').pop(), request, env);
    if (path.match(/^\/api\/users\/\d+\/permissions$/) && method === 'PUT')
      return handleUpdatePermissions(path.split('/')[3], request, env);

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (err) {
    console.error('API error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
}

// ── Auth ────────────────────────────────────────────────────
async function handleLogin(request, env) {
  const { username, password } = await request.json();
  if (!username || !password) return jsonResponse({ error: 'Username and password required' }, 400);

  const hashed = await hashPassword(password);
  const row = await env.DB.prepare(
    'SELECT id, username, name, email, role, permissions, last_login FROM users WHERE username = ? AND password = ?'
  ).bind(username, hashed).first();

  if (!row) return jsonResponse({ error: 'Invalid credentials' }, 401);

  await env.DB.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').bind(row.id).run();

  // streak 컬럼은 마이그레이션 후에만 존재 — 없어도 로그인 정상 동작
  let streak_count = 0, last_wisdom_date = null;
  try {
    const s = await env.DB.prepare(
      'SELECT streak_count, last_wisdom_date FROM users WHERE id = ?'
    ).bind(row.id).first();
    if (s) { streak_count = s.streak_count || 0; last_wisdom_date = s.last_wisdom_date; }
  } catch (_) {}

  const user = { ...row, streak_count, last_wisdom_date, permissions: JSON.parse(row.permissions || '[]') };
  const token = btoa(`${user.id}:${Date.now()}`);
  return jsonResponse({ success: true, user, token });
}

async function handleRegister(request, env) {
  const { username, password, name, email } = await request.json();
  if (!username || !password || !name) return jsonResponse({ error: 'Username, password, and name required' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return jsonResponse({ error: 'Username already exists' }, 409);

  const hashed = await hashPassword(password);
  const row = await env.DB.prepare(
    'INSERT INTO users (username, password, name, email, role, permissions) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, username, name, email, role, permissions, created_at'
  ).bind(username, hashed, name, email || null, 'user', '["korean"]').first();

  if (!row) return jsonResponse({ error: 'Failed to create user' }, 500);
  return jsonResponse({ success: true, user: { ...row, permissions: JSON.parse(row.permissions || '[]') }, message: 'User registered successfully' }, 201);
}

// ── Saved Wisdom (보관함) ────────────────────────────────────
async function ensureSavedWisdomTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS saved_wisdom (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chapter_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, chapter_id)
    )
  `).run();
}

async function handleGetSaved(request, env) {
  const userId = getUserIdFromToken(request);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  await ensureSavedWisdomTable(env);
  const result = await env.DB.prepare(
    'SELECT chapter_id, title, saved_at FROM saved_wisdom WHERE user_id = ? ORDER BY saved_at DESC'
  ).bind(userId).all();

  return jsonResponse({ success: true, saved: result.results || [] });
}

async function handleSaveWisdom(request, env) {
  const userId = getUserIdFromToken(request);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { chapter_id, title } = await request.json();
  if (!chapter_id || !title) return jsonResponse({ error: 'chapter_id and title required' }, 400);

  await ensureSavedWisdomTable(env);
  try {
    await env.DB.prepare(
      'INSERT INTO saved_wisdom (user_id, chapter_id, title) VALUES (?, ?, ?)'
    ).bind(userId, parseInt(chapter_id, 10), title).run();
    return jsonResponse({ success: true, message: 'Saved' });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return jsonResponse({ success: true, message: 'Already saved' });
    throw err;
  }
}

async function handleUnsaveWisdom(chapterId, request, env) {
  const userId = getUserIdFromToken(request);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  await ensureSavedWisdomTable(env);
  await env.DB.prepare(
    'DELETE FROM saved_wisdom WHERE user_id = ? AND chapter_id = ?'
  ).bind(userId, parseInt(chapterId, 10)).run();

  return jsonResponse({ success: true, message: 'Removed' });
}

// ── Streak (스트릭) ─────────────────────────────────────────
async function handleStreak(request, env) {
  const userId = getUserIdFromToken(request);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { date } = await request.json(); // 'YYYY-MM-DD'
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonResponse({ error: 'Invalid date' }, 400);

  const row = await env.DB.prepare(
    'SELECT streak_count, last_wisdom_date FROM users WHERE id = ?'
  ).bind(userId).first();

  if (!row) return jsonResponse({ error: 'User not found' }, 404);

  const last = row.last_wisdom_date;
  let streak = row.streak_count || 0;

  if (last === date) {
    // 오늘 이미 기록됨 → 그대로 반환
    return jsonResponse({ success: true, streak_count: streak, already_counted: true });
  }

  // 어제 날짜 계산
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  const yesterday = d.toISOString().slice(0, 10);

  streak = (last === yesterday) ? streak + 1 : 1;

  await env.DB.prepare(
    'UPDATE users SET streak_count = ?, last_wisdom_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(streak, date, userId).run();

  const MILESTONES = [7, 30, 99];
  const is_milestone = MILESTONES.includes(streak);

  return jsonResponse({ success: true, streak_count: streak, is_milestone, already_counted: false });
}

// ── Users (기존) ─────────────────────────────────────────────
async function handleGetUsers(request, env) {
  if (!verifyAdmin(request)) return jsonResponse({ error: 'Unauthorized' }, 401);
  const result = await env.DB.prepare(
    'SELECT id, username, name, email, role, permissions, streak_count, created_at, last_login FROM users ORDER BY created_at DESC'
  ).all();
  const users = result.results.map(u => ({ ...u, permissions: JSON.parse(u.permissions || '[]') }));
  return jsonResponse({ success: true, users, count: users.length });
}

async function handleGetUser(userId, env) {
  const row = await env.DB.prepare(
    'SELECT id, username, name, email, role, permissions, streak_count, created_at, last_login FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!row) return jsonResponse({ error: 'User not found' }, 404);
  return jsonResponse({ success: true, user: { ...row, permissions: JSON.parse(row.permissions || '[]') } });
}

async function handleUpdateUser(userId, request, env) {
  if (!verifyAdmin(request)) return jsonResponse({ error: 'Unauthorized' }, 401);
  const { name, email, role, permissions } = await request.json();
  const updates = [], bindings = [];
  if (name)  { updates.push('name = ?');  bindings.push(name); }
  if (email !== undefined) { updates.push('email = ?'); bindings.push(email); }
  if (role === 'user' || role === 'admin') { updates.push('role = ?'); bindings.push(role); }
  if (Array.isArray(permissions)) { updates.push('permissions = ?'); bindings.push(JSON.stringify(permissions)); }
  if (!updates.length) return jsonResponse({ error: 'No fields to update' }, 400);
  updates.push('updated_at = CURRENT_TIMESTAMP');
  bindings.push(userId);
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...bindings).run();
  const row = await env.DB.prepare('SELECT id, username, name, email, role, permissions, updated_at FROM users WHERE id = ?').bind(userId).first();
  return jsonResponse({ success: true, user: { ...row, permissions: JSON.parse(row.permissions || '[]') }, message: 'User updated' });
}

async function handleDeleteUser(userId, request, env) {
  if (!verifyAdmin(request)) return jsonResponse({ error: 'Unauthorized' }, 401);
  const user = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first();
  if (!user) return jsonResponse({ error: 'User not found' }, 404);
  if (user.role === 'admin') return jsonResponse({ error: 'Cannot delete admin user' }, 403);
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
  return jsonResponse({ success: true, message: 'User deleted' });
}

async function handleUpdatePermissions(userId, request, env) {
  if (!verifyAdmin(request)) return jsonResponse({ error: 'Unauthorized' }, 401);
  const { permissions } = await request.json();
  if (!Array.isArray(permissions)) return jsonResponse({ error: 'Permissions must be an array' }, 400);
  await env.DB.prepare('UPDATE users SET permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(JSON.stringify(permissions), userId).run();
  const row = await env.DB.prepare('SELECT id, username, name, role, permissions, updated_at FROM users WHERE id = ?').bind(userId).first();
  return jsonResponse({ success: true, user: { ...row, permissions: JSON.parse(row.permissions || '[]') }, message: 'Permissions updated' });
}
