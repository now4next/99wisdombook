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
    if (path === '/api/auth/register' && method === 'POST') return handleRegister(request, env, context);
    if (path === '/api/auth/kakao'    && method === 'POST') return handleKakaoLogin(request, env, context);

    // Wisdom – saved (보관함)
    if (path === '/api/wisdom/saved' && method === 'GET')  return handleGetSaved(request, env);
    if (path === '/api/wisdom/save'  && method === 'POST') return handleSaveWisdom(request, env);
    if (path.match(/^\/api\/wisdom\/save\/\d+$/) && method === 'DELETE') {
      return handleUnsaveWisdom(path.split('/').pop(), request, env);
    }

    // Wisdom – streak (스트릭)
    if (path === '/api/wisdom/streak' && method === 'POST') return handleStreak(request, env);

    // Notify (카톡 알림)
    if (path.match(/^\/api\/users\/\d+\/notify$/) && method === 'GET')
      return handleGetNotify(path.split('/')[3], request, env);
    if (path.match(/^\/api\/users\/\d+\/notify$/) && method === 'PUT')
      return handleUpdateNotify(path.split('/')[3], request, env);
    if (path === '/api/notify/cron' && method === 'POST')
      return handleNotifyCron(request, env);

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
  const { email, password } = await request.json();
  if (!email || !password) return jsonResponse({ error: '이메일과 비밀번호를 입력해주세요.' }, 400);

  const hashed = await hashPassword(password);
  // 이메일로 조회 (신규) → 구버전 username으로 fallback
  let row = await env.DB.prepare(
    'SELECT id, username, name, email, role, permissions, last_login FROM users WHERE email = ? AND password = ?'
  ).bind(email, hashed).first();
  if (!row) {
    row = await env.DB.prepare(
      'SELECT id, username, name, email, role, permissions, last_login FROM users WHERE username = ? AND password = ?'
    ).bind(email, hashed).first();
  }

  if (!row) return jsonResponse({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);

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

async function handleRegister(request, env, context) {
  const { email, password, name } = await request.json();
  if (!email || !password || !name) return jsonResponse({ error: '이름, 이메일, 비밀번호를 모두 입력해주세요.' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return jsonResponse({ error: '이미 사용 중인 이메일입니다.' }, 409);

  const hashed = await hashPassword(password);
  const row = await env.DB.prepare(
    'INSERT INTO users (username, password, name, email, role, permissions, auth_provider) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, username, name, email, role, permissions, created_at'
  ).bind(email, hashed, name, email, 'user', '["korean"]', 'local').first();

  if (!row) return jsonResponse({ error: 'Failed to create user' }, 500);

  // 관리자 알림 메일 (실패해도 가입은 정상 처리)
  if (context?.waitUntil) {
    context.waitUntil(sendNewUserNotification(env, { username: email, name, email }).catch(() => {}));
  } else {
    sendNewUserNotification(env, { username: email, name, email }).catch(() => {});
  }

  return jsonResponse({ success: true, user: { ...row, permissions: JSON.parse(row.permissions || '[]') }, message: 'User registered successfully' }, 201);
}

async function handleKakaoLogin(request, env, context) {
  const { code, redirectUri } = await request.json();
  if (!code || !redirectUri) return jsonResponse({ error: 'code and redirectUri required' }, 400);
  if (!env.KAKAO_REST_API_KEY) return jsonResponse({ error: 'Kakao REST API key not configured' }, 500);

  // authorization code → access_token 교환
  const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.KAKAO_REST_API_KEY.trim(),
      client_secret: (env.KAKAO_CLIENT_SECRET || '').trim(),
      redirect_uri: redirectUri,
      code,
    }),
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    return jsonResponse({ error: err.error_description || '카카오 토큰 발급에 실패했습니다.' }, 401);
  }
  const tokenData = await tokenRes.json();
  const access_token = tokenData.access_token;
  const refresh_token = tokenData.refresh_token || null;

  // 카카오 사용자 정보 조회
  const kakaoRes = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: { 'Authorization': `Bearer ${access_token}` }
  });
  if (!kakaoRes.ok) return jsonResponse({ error: '카카오 인증에 실패했습니다.' }, 401);

  const kakaoUser = await kakaoRes.json();
  const kakaoId = String(kakaoUser.id);
  const kakaoName = kakaoUser.kakao_account?.profile?.nickname || kakaoUser.properties?.nickname || '카카오 사용자';
  const kakaoEmail = kakaoUser.kakao_account?.email || null;

  // 기존 카카오 사용자 조회
  let row = await env.DB.prepare(
    'SELECT id, username, name, email, role, permissions, auth_provider FROM users WHERE auth_provider = ? AND provider_id = ?'
  ).bind('kakao', kakaoId).first();

  if (!row) {
    // 신규 카카오 사용자 생성
    const username = `kakao_${kakaoId}`;
    row = await env.DB.prepare(
      'INSERT INTO users (username, password, name, email, role, permissions, auth_provider, provider_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, username, name, email, role, permissions, auth_provider, created_at'
    ).bind(username, '', kakaoName, kakaoEmail, 'user', '["korean"]', 'kakao', kakaoId).first();

    if (!row) return jsonResponse({ error: '사용자 생성에 실패했습니다.' }, 500);

    // 관리자 알림
    if (context?.waitUntil) {
      context.waitUntil(sendNewUserNotification(env, { username: kakaoName, name: kakaoName, email: kakaoEmail }).catch(() => {}));
    }
  }

  // refresh_token 저장 (있을 때만 업데이트)
  if (refresh_token) {
    await env.DB.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP, kakao_refresh_token = ? WHERE id = ?')
      .bind(refresh_token, row.id).run();
  } else {
    await env.DB.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').bind(row.id).run();
  }

  let streak_count = 0, last_wisdom_date = null;
  try {
    const s = await env.DB.prepare('SELECT streak_count, last_wisdom_date FROM users WHERE id = ?').bind(row.id).first();
    if (s) { streak_count = s.streak_count || 0; last_wisdom_date = s.last_wisdom_date; }
  } catch (_) {}

  const user = { ...row, streak_count, last_wisdom_date, permissions: JSON.parse(row.permissions || '[]') };
  const token = btoa(`${user.id}:${Date.now()}`);
  return jsonResponse({ success: true, user, token });
}

async function sendNewUserNotification(env, { username, name, email }) {
  if (!env.RESEND_API_KEY) return;

  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: '99wisdombook <noreply@99wisdombook.org>',
      to:   ['nowfornext@naver.com'],
      subject: `[99wisdombook] 새 회원 가입: ${name}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#fff;">
          <h2 style="color:#3e2820;border-bottom:2px solid #8d6e63;padding-bottom:10px;margin-top:0;">
            📚 새 회원이 가입했습니다
          </h2>
          <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:15px;">
            <tr>
              <td style="padding:10px 8px;color:#888;width:90px;">이름</td>
              <td style="padding:10px 8px;font-weight:600;color:#1a1a1a;">${name}</td>
            </tr>
            <tr style="background:#f9f6f2;">
              <td style="padding:10px 8px;color:#888;">아이디</td>
              <td style="padding:10px 8px;color:#1a1a1a;">${username}</td>
            </tr>
            <tr>
              <td style="padding:10px 8px;color:#888;">이메일</td>
              <td style="padding:10px 8px;color:#1a1a1a;">${email || '미입력'}</td>
            </tr>
            <tr style="background:#f9f6f2;">
              <td style="padding:10px 8px;color:#888;">가입일시</td>
              <td style="padding:10px 8px;color:#1a1a1a;">${now}</td>
            </tr>
          </table>
          <div style="margin-top:28px;text-align:center;">
            <a href="https://99wisdombook.org/admin.html"
               style="background:#3e2820;color:#f5e9d8;padding:12px 28px;border-radius:6px;
                      text-decoration:none;font-size:14px;font-weight:600;display:inline-block;">
              관리자 대시보드 바로가기 →
            </a>
          </div>
          <p style="margin-top:28px;font-size:12px;color:#bbb;text-align:center;">
            99wisdombook.org 자동 발송 메일 · 수신 거부 불가
          </p>
        </div>
      `,
    }),
  });
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

  // streak_count 컬럼이 없는 구버전 DB에도 동작하도록 fallback 처리
  let result;
  try {
    result = await env.DB.prepare(
      'SELECT id, username, name, email, role, permissions, streak_count, created_at, last_login FROM users ORDER BY created_at DESC'
    ).all();
  } catch (_) {
    result = await env.DB.prepare(
      'SELECT id, username, name, email, role, permissions, created_at, last_login FROM users ORDER BY created_at DESC'
    ).all();
  }

  const users = result.results.map(u => ({
    ...u,
    streak_count: u.streak_count ?? 0,
    permissions: JSON.parse(u.permissions || '[]'),
  }));
  return jsonResponse({ success: true, users, count: users.length });
}

async function handleGetUser(userId, env) {
  let row;
  try {
    row = await env.DB.prepare(
      'SELECT id, username, name, email, role, permissions, streak_count, created_at, last_login FROM users WHERE id = ?'
    ).bind(userId).first();
  } catch (_) {
    row = await env.DB.prepare(
      'SELECT id, username, name, email, role, permissions, created_at, last_login FROM users WHERE id = ?'
    ).bind(userId).first();
  }
  if (!row) return jsonResponse({ error: 'User not found' }, 404);
  return jsonResponse({ success: true, user: { ...row, streak_count: row.streak_count ?? 0, permissions: JSON.parse(row.permissions || '[]') } });
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
  // updated_at 컬럼이 없는 구버전 DB 호환
  try { updates.push('updated_at = CURRENT_TIMESTAMP'); } catch (_) {}
  bindings.push(userId);
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...bindings).run();
  const row = await env.DB.prepare('SELECT id, username, name, email, role, permissions FROM users WHERE id = ?').bind(userId).first();
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
  // updated_at 컬럼이 없는 구버전 DB 호환
  try {
    await env.DB.prepare('UPDATE users SET permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(JSON.stringify(permissions), userId).run();
  } catch (_) {
    await env.DB.prepare('UPDATE users SET permissions = ? WHERE id = ?')
      .bind(JSON.stringify(permissions), userId).run();
  }
  const row = await env.DB.prepare('SELECT id, username, name, role, permissions FROM users WHERE id = ?').bind(userId).first();
  return jsonResponse({ success: true, user: { ...row, permissions: JSON.parse(row.permissions || '[]') }, message: 'Permissions updated' });
}

// ── 카카오 알림 설정 ────────────────────────────────────────
async function handleGetNotify(userId, request, env) {
  const tokenUserId = getUserIdFromToken(request);
  if (!tokenUserId || tokenUserId !== parseInt(userId)) return jsonResponse({ error: 'Unauthorized' }, 401);
  const row = await env.DB.prepare(
    'SELECT notify_enabled, notify_days, notify_hour FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!row) return jsonResponse({ error: 'User not found' }, 404);
  return jsonResponse({ success: true, notify_enabled: row.notify_enabled || 0, notify_days: row.notify_days, notify_hour: row.notify_hour });
}

async function handleUpdateNotify(userId, request, env) {
  const tokenUserId = getUserIdFromToken(request);
  if (!tokenUserId || tokenUserId !== parseInt(userId)) return jsonResponse({ error: 'Unauthorized' }, 401);
  const { notify_enabled, notify_days, notify_hour } = await request.json();
  await env.DB.prepare(
    'UPDATE users SET notify_enabled = ?, notify_days = ?, notify_hour = ? WHERE id = ?'
  ).bind(notify_enabled ? 1 : 0, notify_days || null, notify_hour ?? null, userId).run();
  return jsonResponse({ success: true, message: '알림 설정이 저장되었습니다.' });
}

// ── 카카오 토큰 갱신 ────────────────────────────────────────
async function refreshKakaoAccessToken(refreshToken, env) {
  const res = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.KAKAO_REST_API_KEY.trim(),
      client_secret: (env.KAKAO_CLIENT_SECRET || '').trim(),
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error('카카오 토큰 갱신 실패');
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || '토큰 갱신 실패');
  return { access_token: data.access_token, new_refresh_token: data.refresh_token || null };
}

// ── 카카오 나에게 보내기 ────────────────────────────────────
async function sendKakaoNotifyMessage(accessToken, wisdomTitle, chapterId) {
  const link = { web_url: 'https://99wisdombook.org/?autoopen=1', mobile_web_url: 'https://99wisdombook.org/?autoopen=1' };
  const template = {
    object_type: 'feed',
    content: {
      title: '📚 오늘의 Daily Wisdom',
      description: wisdomTitle || '오늘의 한 문장이 기다리고 있어요',
      image_url: 'https://99wisdombook.org/og-image.png',
      image_width: 1200, image_height: 630,
      link,
    },
    buttons: [{ title: '오늘의 지혜 읽기', link }],
  };
  const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ template_object: JSON.stringify(template) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.msg || '카카오 메시지 발송 실패');
  }
  return await res.json();
}

// ── Cron 엔드포인트 ─────────────────────────────────────────
async function handleNotifyCron(request, env) {
  // CRON_SECRET 인증
  const authHeader = request.headers.get('Authorization') || '';
  const cronSecret = (env.CRON_SECRET || '').trim();
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // 현재 KST 시각 계산
  const now = new Date();
  const kstHour = (now.getUTCHours() + 9) % 24;
  const kstDay  = new Date(now.getTime() + 9 * 3600 * 1000).getUTCDay(); // 0=일,1=월…6=토

  // 이 시각 알림 설정 사용자 조회
  let users;
  try {
    const result = await env.DB.prepare(`
      SELECT id, name, kakao_refresh_token, notify_days
      FROM users
      WHERE notify_enabled = 1
        AND notify_hour = ?
        AND kakao_refresh_token IS NOT NULL
    `).bind(kstHour).all();
    users = result.results || [];
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }

  // 오늘의 지혜 데이터 조회
  let wisdomTitle = '오늘의 한 문장이 기다리고 있어요';
  try {
    const wRes = await fetch('https://99wisdombook.org/data/wisdom.json');
    const wData = await wRes.json();
    const items = wData.items || [];
    if (items.length) {
      const dk = now.toISOString().slice(0, 10).replace(/-/g, '');
      const idx = parseInt(dk, 10) % items.length;
      wisdomTitle = items[idx]?.title || wisdomTitle;
    }
  } catch (_) {}

  const results = { sent: 0, skipped: 0, errors: [] };

  for (const user of users) {
    try {
      // 요일 체크 (notify_days: "1,3,5" 형태)
      if (user.notify_days) {
        const days = user.notify_days.split(',').map(Number);
        if (!days.includes(kstDay)) { results.skipped++; continue; }
      }

      // 액세스 토큰 갱신
      const { access_token, new_refresh_token } = await refreshKakaoAccessToken(user.kakao_refresh_token, env);

      // 새 refresh_token 저장 (갱신된 경우)
      if (new_refresh_token) {
        await env.DB.prepare('UPDATE users SET kakao_refresh_token = ? WHERE id = ?')
          .bind(new_refresh_token, user.id).run();
      }

      // 메시지 발송
      await sendKakaoNotifyMessage(access_token, wisdomTitle);
      results.sent++;
    } catch (err) {
      results.errors.push({ userId: user.id, error: err.message });
    }
  }

  return jsonResponse({ success: true, kstHour, kstDay, total: users.length, ...results });
}
