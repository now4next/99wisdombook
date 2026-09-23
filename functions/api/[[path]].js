/**
 * Cloudflare Workers API for 99 Wisdom Book
 *
 * Auth endpoints:
 * - POST   /api/auth/login
 * - POST   /api/auth/register
 * - POST   /api/auth/logout
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

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ⚠ 인증 계약 — 아래 규칙을 깨면 관리자 사칭이 가능해진다.
     · 토큰은 64자 hex 난수이며 그 자체에 아무 정보도 담지 않는다.
       (예전 btoa(`id:시각`) 방식은 누구나 위조할 수 있어 폐기했다.)
     · 서버는 원본을 저장하지 않고 SHA-256 해시만 sessions 테이블에 둔다.
     · 사용자 판별은 반드시 await getUserIdFromToken(request, env) 로 한다.
       토큰 문자열을 직접 해석하는 코드를 다시 만들지 말 것.
     · 관리자 확인은 verifyAdminStrict() 하나뿐이다. 길이나 존재만 보는
       검사를 추가하지 말 것. */
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

async function ensureSessionsTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS sessions (
       token_hash TEXT PRIMARY KEY,
       user_id    INTEGER NOT NULL,
       created_at TEXT DEFAULT CURRENT_TIMESTAMP,
       expires_at INTEGER NOT NULL
     )`
  ).run();
}

/** 로그인 성공 시 세션을 만들고 원본 토큰을 돌려준다. 원본은 어디에도 저장하지 않는다. */
async function createSession(env, userId) {
  await ensureSessionsTable(env);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(await sha256hex(token), userId, Date.now() + SESSION_TTL_MS).run();
  if (Math.random() < 0.05) {
    try {
      await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
    } catch (_) {}
  }
  return token;
}

async function getUserIdFromToken(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  try {
    await ensureSessionsTable(env);
    const hash = await sha256hex(token);
    const row = await env.DB.prepare(
      'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?'
    ).bind(hash).first();
    if (!row) return null;
    if (Number(row.expires_at) < Date.now()) {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
      return null;
    }
    return row.user_id;
  } catch (_) { return null; }
}

async function destroySession(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return;
  const token = auth.slice(7).trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return;
  try {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256hex(token)).run();
  } catch (_) {}
}

/** 관리자 확인. 토큰 → 세션 → users.role 까지 모두 DB로 확인한다. */
async function verifyAdminStrict(request, env) {
  const userId = await getUserIdFromToken(request, env);
  if (!userId) return false;
  try {
    const row = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first();
    return !!row && row.role === 'admin';
  } catch (_) { return false; }
}

async function recordLoginLog(env, request, { user_id, user_name, user_email, login_type }) {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS login_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_name TEXT,
        user_email TEXT,
        login_type TEXT DEFAULT 'local',
        ip_address TEXT,
        logged_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    ).run();
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || null;
    await env.DB.prepare(
      'INSERT INTO login_logs (user_id, user_name, user_email, login_type, ip_address) VALUES (?, ?, ?, ?, ?)'
    ).bind(user_id, user_name, user_email, login_type, ip).run();
  } catch (_) {}
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
    if (path === '/api/auth/logout'   && method === 'POST') return handleLogout(request, env);
    if (path === '/api/email/unsubscribe' && method === 'GET') return handleEmailUnsubscribe(request, env);

    // Wisdom – saved (보관함)
    if (path === '/api/wisdom/saved' && method === 'GET')  return handleGetSaved(request, env);
    if (path === '/api/wisdom/save'  && method === 'POST') return handleSaveWisdom(request, env);
    if (path.match(/^\/api\/wisdom\/save\/\d+$/) && method === 'DELETE') {
      return handleUnsaveWisdom(path.split('/').pop(), request, env);
    }
    if (path.match(/^\/api\/wisdom\/save\/\d+\/memo$/) && method === 'PUT') {
      return handleUpdateMemo(path.split('/')[4], request, env);
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
    if (path === '/api/notify/reminder' && method === 'POST')
      return handleReminderCron(request, env);
    if (path === '/api/notify/weekly' && method === 'POST')
      return handleWeeklyCron(request, env);
    if (path === '/api/notify/kakao-test' && method === 'POST')
      return handleKakaoTest(request, env);

    // 추천인 시스템
    if (path === '/api/referral/code' && method === 'GET')
      return handleGetReferralCode(request, env);
    if (path === '/api/referral/stats' && method === 'GET')
      return handleGetReferralStats(request, env);

    // 카카오 알림용 동적 이미지 (문장 합성)
    if (path === '/api/wisdom/card' && method === 'GET')
      return handleWisdomCard(request);

    // Web Push
    if (path === '/api/config/vapid' && method === 'GET')
      return jsonResponse({ publicKey: (env.VAPID_PUBLIC_KEY || '').trim() });
    if (path === '/api/push/subscribe' && method === 'POST')
      return handlePushSubscribe(request, env);
    if (path === '/api/push/unsubscribe' && method === 'POST')
      return handlePushUnsubscribe(request, env);
    if (path === '/api/push/test' && method === 'POST')
      return handlePushTest(request, env);
    if (path === '/api/push/status' && method === 'GET')
      return handlePushStatus(request, env);

    // Admin – login logs
    if (path === '/api/admin/login-logs' && method === 'GET') return handleGetLoginLogs(request, env);

    // Insights (칼럼)
    if (path === '/api/insights' && method === 'GET') return handleListInsights(request, env);
    if (path.match(/^\/api\/insights\/[A-Za-z0-9가-힣_-]+$/) && method === 'GET')
      return handleGetInsight(decodeURIComponent(path.split('/').pop()), env);
    if (path === '/api/admin/insights' && method === 'GET')    return handleAdminListInsights(request, env);
    if (path === '/api/admin/insights' && method === 'POST')   return handleCreateInsight(request, env);
    if (path.match(/^\/api\/admin\/insights\/\d+$/) && method === 'PUT')
      return handleUpdateInsight(path.split('/').pop(), request, env);
    if (path.match(/^\/api\/admin\/insights\/\d+$/) && method === 'DELETE')
      return handleDeleteInsight(path.split('/').pop(), request, env);

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
/** 현재 세션을 폐기한다. 토큰이 이미 없거나 틀려도 성공으로 답한다. */
async function handleLogout(request, env) {
  await destroySession(request, env);
  return jsonResponse({ success: true });
}

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
  await recordLoginLog(env, request, { user_id: row.id, user_name: row.name || row.username, user_email: row.email, login_type: 'local' });

  // streak 컬럼은 마이그레이션 후에만 존재 — 없어도 로그인 정상 동작
  let streak_count = 0, last_wisdom_date = null;
  try {
    const s = await env.DB.prepare(
      'SELECT streak_count, last_wisdom_date FROM users WHERE id = ?'
    ).bind(row.id).first();
    if (s) { streak_count = s.streak_count || 0; last_wisdom_date = s.last_wisdom_date; }
  } catch (_) {}

  const user = { ...row, streak_count, last_wisdom_date, permissions: JSON.parse(row.permissions || '[]') };
  const token = await createSession(env, user.id);
  return jsonResponse({ success: true, user, token });
}

async function handleRegister(request, env, context) {
  const { email, password, name, ref } = await request.json();
  if (!email || !password || !name) return jsonResponse({ error: '이름, 이메일, 비밀번호를 모두 입력해주세요.' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return jsonResponse({ error: '이미 사용 중인 이메일입니다.' }, 409);

  // 추천인 코드 검증
  let referrerId = null;
  if (ref) {
    try {
      const referrer = await env.DB.prepare('SELECT id FROM users WHERE referral_code = ?').bind(ref.toUpperCase()).first();
      if (referrer) referrerId = referrer.id;
    } catch (_) {}
  }

  const hashed = await hashPassword(password);
  const row = await env.DB.prepare(
    'INSERT INTO users (username, password, name, email, role, permissions, auth_provider, referred_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, username, name, email, role, permissions, created_at'
  ).bind(email, hashed, name, email, 'user', '["korean"]', 'local', referrerId).first();

  if (!row) return jsonResponse({ error: 'Failed to create user' }, 500);

  // 추천인 카운트 증가
  if (referrerId) {
    try {
      await env.DB.prepare('UPDATE users SET referral_count = COALESCE(referral_count, 0) + 1 WHERE id = ?').bind(referrerId).run();
    } catch (_) {}
  }

  // 관리자 알림 메일 (실패해도 가입은 정상 처리)
  if (context?.waitUntil) {
    context.waitUntil(sendNewUserNotification(env, { username: email, name, email }).catch(() => {}));
  } else {
    sendNewUserNotification(env, { username: email, name, email }).catch(() => {});
  }

  return jsonResponse({ success: true, user: { ...row, permissions: JSON.parse(row.permissions || '[]') }, message: 'User registered successfully' }, 201);
}

async function handleKakaoLogin(request, env, context) {
  const { code, redirectUri, ref } = await request.json();
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
    // 추천인 코드 검증
    let referrerId = null;
    if (ref) {
      try {
        const referrer = await env.DB.prepare('SELECT id FROM users WHERE referral_code = ?').bind(ref.toUpperCase()).first();
        if (referrer) referrerId = referrer.id;
      } catch (_) {}
    }

    // 신규 카카오 사용자 생성
    const username = `kakao_${kakaoId}`;
    row = await env.DB.prepare(
      'INSERT INTO users (username, password, name, email, role, permissions, auth_provider, provider_id, referred_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, username, name, email, role, permissions, auth_provider, created_at'
    ).bind(username, '', kakaoName, kakaoEmail, 'user', '["korean"]', 'kakao', kakaoId, referrerId).first();

    if (!row) return jsonResponse({ error: '사용자 생성에 실패했습니다.' }, 500);

    // 추천인 카운트 증가
    if (referrerId) {
      try {
        await env.DB.prepare('UPDATE users SET referral_count = COALESCE(referral_count, 0) + 1 WHERE id = ?').bind(referrerId).run();
      } catch (_) {}
    }

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
  await recordLoginLog(env, request, { user_id: row.id, user_name: row.name || row.username, user_email: row.email, login_type: 'kakao' });

  let streak_count = 0, last_wisdom_date = null;
  try {
    const s = await env.DB.prepare('SELECT streak_count, last_wisdom_date FROM users WHERE id = ?').bind(row.id).first();
    if (s) { streak_count = s.streak_count || 0; last_wisdom_date = s.last_wisdom_date; }
  } catch (_) {}

  const user = { ...row, streak_count, last_wisdom_date, permissions: JSON.parse(row.permissions || '[]') };
  const token = await createSession(env, user.id);
  return jsonResponse({ success: true, user, token });
}

/* 이메일 뉴스레터용 컬럼. D1 에는 ADD COLUMN IF NOT EXISTS 가 없어
   이미 있으면 에러가 나므로 삼켜 넘긴다. */
async function ensureEmailColumns(env) {
  for (const sql of [
    'ALTER TABLE users ADD COLUMN email_enabled INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN unsubscribe_token TEXT',
  ]) {
    try { await env.DB.prepare(sql).run(); } catch (_) {}
  }
}

/** 수신 거부 링크에 쓸 토큰. 로그인 없이 동작해야 하므로 사용자마다 하나씩 둔다. */
async function ensureUnsubscribeToken(env, userId) {
  const row = await env.DB.prepare('SELECT unsubscribe_token FROM users WHERE id = ?').bind(userId).first();
  if (row && row.unsubscribe_token) return row.unsubscribe_token;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const t = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('UPDATE users SET unsubscribe_token = ? WHERE id = ?').bind(t, userId).run();
  return t;
}

function newsletterHtml({ name, sentence, column, url, unsubUrl }) {
  const esc = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `
  <div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:#faf9f7;padding:28px 16px;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #ece8e2;">
      ${column && column.hero_image
        ? `<a href="${esc(url)}"><img src="${esc(column.hero_image)}" width="560" alt="" style="display:block;width:100%;height:auto;border:0;"></a>`
        : ''}
      <div style="padding:28px 26px 24px;">
        <div style="font-size:12px;letter-spacing:.08em;color:#9c9489;text-transform:uppercase;">99 Wisdom Insight</div>
        <p style="margin:14px 0 0;font-family:Georgia,'Gowun Batang',serif;font-size:20px;line-height:1.5;color:#2c2722;">
          &ldquo;${esc(sentence)}&rdquo;
        </p>
        ${column ? `<p style="margin:18px 0 0;font-size:16px;line-height:1.6;color:#4a443d;font-weight:600;">${esc(column.title)}</p>` : ''}
        ${column && column.quotable ? `<p style="margin:10px 0 0;font-size:14px;line-height:1.7;color:#6b645c;">${esc(column.quotable)}</p>` : ''}
        <div style="margin:26px 0 4px;">
          <a href="${esc(url)}" style="display:inline-block;background:#5FA97E;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:14px;font-weight:600;">
            오늘의 칼럼 읽기
          </a>
        </div>
      </div>
    </div>
    <div style="max-width:560px;margin:16px auto 0;text-align:center;font-size:12px;line-height:1.8;color:#a29a90;">
      ${esc(name || '독자')}님께 보내 드립니다 · <a href="https://99wisdombook.org" style="color:#a29a90;">99wisdombook.org</a><br>
      <a href="${esc(unsubUrl)}" style="color:#a29a90;text-decoration:underline;">이메일 받지 않기</a>
    </div>
  </div>`;
}

async function sendNewsletterEmail(env, user, wisdomItem) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY 미설정');
  if (!user.email) throw new Error('이메일 주소 없음');

  const column = wisdomItem.column;
  const url = column
    ? `https://99wisdombook.org/insight/${column.slug}`
    : 'https://99wisdombook.org/daily.html?autoopen=1';
  const t = await ensureUnsubscribeToken(env, user.id);
  const unsubUrl = `https://99wisdombook.org/api/email/unsubscribe?t=${t}`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: '99 Wisdom Insight <daily@99wisdombook.org>',
      to: [user.email],
      subject: column ? `${wisdomItem.title} — ${column.title}` : wisdomItem.title,
      html: newsletterHtml({ name: user.name, sentence: wisdomItem.title, column, url, unsubUrl }),
      headers: { 'List-Unsubscribe': `<${unsubUrl}>` },
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || `Resend ${res.status}`);
  }
}

/** 수신 거부. 로그인 없이 링크만으로 동작해야 한다. */
async function handleEmailUnsubscribe(request, env) {
  const t = new URL(request.url).searchParams.get('t') || '';
  const page = (msg) => new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <div style="font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;max-width:420px;margin:18vh auto;padding:0 20px;text-align:center;color:#2c2722;">
       <div style="font-size:12px;letter-spacing:.08em;color:#9c9489;">99 WISDOM INSIGHT</div>
       <p style="margin:18px 0 24px;font-size:17px;line-height:1.7;">${msg}</p>
       <a href="https://99wisdombook.org" style="color:#5FA97E;font-size:14px;">사이트로 가기</a>
     </div>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders } }
  );

  if (!/^[0-9a-f]{32}$/.test(t)) return page('잘못된 링크입니다.');
  try {
    await ensureEmailColumns(env);
    const row = await env.DB.prepare('SELECT id FROM users WHERE unsubscribe_token = ?').bind(t).first();
    if (!row) return page('이미 해지되었거나 유효하지 않은 링크입니다.');
    await env.DB.prepare('UPDATE users SET email_enabled = 0 WHERE id = ?').bind(row.id).run();
    return page('이메일 수신을 해지했습니다.<br>설정에서 언제든 다시 켤 수 있습니다.');
  } catch (_) {
    return page('처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.');
  }
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
  const userId = await getUserIdFromToken(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  await ensureSavedWisdomTable(env);
  const result = await env.DB.prepare(
    'SELECT chapter_id, title, memo, saved_at FROM saved_wisdom WHERE user_id = ? ORDER BY saved_at DESC'
  ).bind(userId).all();

  return jsonResponse({ success: true, saved: result.results || [] });
}

async function handleSaveWisdom(request, env) {
  const userId = await getUserIdFromToken(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { chapter_id, title, memo } = await request.json();
  if (!chapter_id || !title) return jsonResponse({ error: 'chapter_id and title required' }, 400);

  const memoText = (memo || '').trim().slice(0, 300);
  await ensureSavedWisdomTable(env);
  try {
    await env.DB.prepare(
      'INSERT INTO saved_wisdom (user_id, chapter_id, title, memo) VALUES (?, ?, ?, ?)'
    ).bind(userId, parseInt(chapter_id, 10), title, memoText || null).run();
    return jsonResponse({ success: true, message: 'Saved' });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      // 이미 저장된 경우 memo만 업데이트
      if (memoText) {
        await env.DB.prepare(
          'UPDATE saved_wisdom SET memo = ? WHERE user_id = ? AND chapter_id = ?'
        ).bind(memoText, userId, parseInt(chapter_id, 10)).run();
      }
      return jsonResponse({ success: true, message: 'Already saved' });
    }
    throw err;
  }
}

async function handleUpdateMemo(chapterId, request, env) {
  const userId = await getUserIdFromToken(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { memo } = await request.json();
  const memoText = (memo || '').trim().slice(0, 300);

  await env.DB.prepare(
    'UPDATE saved_wisdom SET memo = ? WHERE user_id = ? AND chapter_id = ?'
  ).bind(memoText || null, userId, parseInt(chapterId, 10)).run();

  return jsonResponse({ success: true, memo: memoText });
}

async function handleUnsaveWisdom(chapterId, request, env) {
  const userId = await getUserIdFromToken(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  await ensureSavedWisdomTable(env);
  await env.DB.prepare(
    'DELETE FROM saved_wisdom WHERE user_id = ? AND chapter_id = ?'
  ).bind(userId, parseInt(chapterId, 10)).run();

  return jsonResponse({ success: true, message: 'Removed' });
}

// ── Streak (스트릭) ─────────────────────────────────────────
async function handleStreak(request, env) {
  const userId = await getUserIdFromToken(request, env);
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

// ── Admin: Login Logs ────────────────────────────────────────
async function handleGetLoginLogs(request, env) {
  if (!await verifyAdminStrict(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS login_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_name TEXT,
        user_email TEXT,
        login_type TEXT DEFAULT 'local',
        ip_address TEXT,
        logged_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    ).run();
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
    const result = await env.DB.prepare(
      'SELECT id, user_id, user_name, user_email, login_type, ip_address, logged_in_at FROM login_logs ORDER BY logged_in_at DESC LIMIT ?'
    ).bind(limit).all();
    return jsonResponse({ success: true, logs: result.results });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ══════════ Insights (칼럼) ══════════════════════════════════
const INSIGHTS_DDL = `CREATE TABLE IF NOT EXISTS insights (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id    INTEGER NOT NULL,
  part_id       INTEGER NOT NULL,
  lens          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  hook          TEXT,
  anchor_quote  TEXT,
  body_md       TEXT,
  action        TEXT,
  quotable      TEXT,
  hero_image    TEXT,
  reading_time  INTEGER,
  tags          TEXT,
  sources       TEXT,
  status        TEXT DEFAULT 'draft',
  scheduled_for TEXT,
  published_at  TEXT,
  author        TEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`;

const LENSES = ['origin','science','history','person','business','daily','counter','eastwest','practice','reflection'];

async function ensureInsights(env) {
  await env.DB.prepare(INSIGHTS_DDL).run();
  try {
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(status, published_at DESC)').run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_insights_chapter ON insights(chapter_id)').run();
  } catch (_) {}
}

function parseInsight(row) {
  if (!row) return null;
  let sources = [], tags = [];
  try { sources = JSON.parse(row.sources || '[]'); } catch (_) {}
  try { tags = JSON.parse(row.tags || '[]'); } catch (_) {}
  return { ...row, sources, tags };
}

/** 발행 조건: 출처 1개 이상 + quotable 존재. 미충족 시 이유를 돌려준다. */
function publishBlockers(data) {
  const out = [];
  let sources = data.sources;
  if (typeof sources === 'string') { try { sources = JSON.parse(sources || '[]'); } catch (_) { sources = []; } }
  if (!Array.isArray(sources) || sources.length === 0) out.push('출처가 1개 이상 필요합니다');
  if (!data.quotable || !String(data.quotable).trim()) out.push('quotable(공유용 한 줄)이 필요합니다');
  if (!data.body_md || String(data.body_md).trim().length < 200) out.push('본문이 너무 짧습니다 (200자 이상)');
  return out;
}

async function handleListInsights(request, env) {
  await ensureInsights(env);
  const url = new URL(request.url);
  const limit   = Math.min(parseInt(url.searchParams.get('limit') || '24', 10), 100);
  const partId  = url.searchParams.get('part');
  const lens    = url.searchParams.get('lens');
  const chapter = url.searchParams.get('chapter');

  let sql = "SELECT id, chapter_id, part_id, lens, slug, title, hook, quotable, hero_image, reading_time, tags, published_at FROM insights WHERE status = 'published'";
  const binds = [];
  if (partId)  { sql += ' AND part_id = ?';    binds.push(parseInt(partId, 10)); }
  if (lens)    { sql += ' AND lens = ?';       binds.push(lens); }
  if (chapter) { sql += ' AND chapter_id = ?'; binds.push(parseInt(chapter, 10)); }
  sql += ' ORDER BY published_at DESC, id DESC LIMIT ?';
  binds.push(limit);

  const res = await env.DB.prepare(sql).bind(...binds).all();
  const items = (res.results || []).map(parseInsight);
  return jsonResponse({ success: true, items, count: items.length });
}

async function handleGetInsight(slug, env) {
  await ensureInsights(env);
  const row = await env.DB.prepare(
    "SELECT * FROM insights WHERE slug = ? AND status = 'published'"
  ).bind(slug).first();
  if (!row) return jsonResponse({ error: 'Not found' }, 404);
  return jsonResponse({ success: true, insight: parseInsight(row) });
}

async function handleAdminListInsights(request, env) {
  if (!await verifyAdminStrict(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  await ensureInsights(env);
  const res = await env.DB.prepare(
    'SELECT * FROM insights ORDER BY chapter_id ASC, id ASC'
  ).all();
  const items = (res.results || []).map(parseInsight);
  const byStatus = items.reduce((a, i) => { a[i.status] = (a[i.status] || 0) + 1; return a; }, {});
  return jsonResponse({ success: true, items, count: items.length, by_status: byStatus });
}

async function handleCreateInsight(request, env) {
  if (!await verifyAdminStrict(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  await ensureInsights(env);
  const d = await request.json();

  if (!d.chapter_id || !d.title || !d.slug) return jsonResponse({ error: 'chapter_id, title, slug은 필수입니다.' }, 400);
  if (d.lens && !LENSES.includes(d.lens))   return jsonResponse({ error: '알 수 없는 lens: ' + d.lens }, 400);

  const status = d.status || 'draft';
  if (status === 'published') {
    const blockers = publishBlockers(d);
    if (blockers.length) return jsonResponse({ error: '발행 조건 미충족', blockers }, 400);
  }

  const chapterId = parseInt(d.chapter_id, 10);
  const partId    = d.part_id ? parseInt(d.part_id, 10) : Math.min(9, Math.floor((chapterId - 1) / 11) + 1);

  try {
    const row = await env.DB.prepare(
      `INSERT INTO insights
         (chapter_id, part_id, lens, slug, title, hook, anchor_quote, body_md, action,
          quotable, hero_image, reading_time, tags, sources, status, scheduled_for, published_at, author)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       RETURNING *`
    ).bind(
      chapterId, partId, d.lens || 'origin', d.slug, d.title,
      d.hook || null, d.anchor_quote || null, d.body_md || null, d.action || null,
      d.quotable || null, d.hero_image || null,
      d.reading_time || null,
      JSON.stringify(d.tags || []), JSON.stringify(d.sources || []),
      status, d.scheduled_for || null,
      status === 'published' ? (d.published_at || new Date().toISOString()) : null,
      d.author || null
    ).first();
    return jsonResponse({ success: true, insight: parseInsight(row) }, 201);
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) return jsonResponse({ error: '이미 존재하는 slug입니다.' }, 409);
    return jsonResponse({ error: err.message }, 500);
  }
}

async function handleUpdateInsight(id, request, env) {
  if (!await verifyAdminStrict(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  await ensureInsights(env);
  const d = await request.json();

  const cur = await env.DB.prepare('SELECT * FROM insights WHERE id = ?').bind(id).first();
  if (!cur) return jsonResponse({ error: 'Not found' }, 404);

  if (d.status === 'published') {
    const merged = { ...parseInsight(cur), ...d };
    const blockers = publishBlockers(merged);
    if (blockers.length) return jsonResponse({ error: '발행 조건 미충족', blockers }, 400);
  }

  const cols = ['chapter_id','part_id','lens','slug','title','hook','anchor_quote','body_md',
                'action','quotable','hero_image','reading_time','status','scheduled_for','author'];
  const sets = [], binds = [];
  for (const c of cols) {
    if (d[c] !== undefined) { sets.push(c + ' = ?'); binds.push(d[c]); }
  }
  if (d.tags    !== undefined) { sets.push('tags = ?');    binds.push(JSON.stringify(d.tags)); }
  if (d.sources !== undefined) { sets.push('sources = ?'); binds.push(JSON.stringify(d.sources)); }
  if (d.status === 'published' && !cur.published_at) {
    sets.push('published_at = ?'); binds.push(new Date().toISOString());
  }
  if (!sets.length) return jsonResponse({ error: '변경할 내용이 없습니다.' }, 400);

  sets.push('updated_at = CURRENT_TIMESTAMP');
  binds.push(id);

  const row = await env.DB.prepare(
    `UPDATE insights SET ${sets.join(', ')} WHERE id = ? RETURNING *`
  ).bind(...binds).first();
  return jsonResponse({ success: true, insight: parseInsight(row) });
}

async function handleDeleteInsight(id, request, env) {
  if (!await verifyAdminStrict(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  await ensureInsights(env);
  const cur = await env.DB.prepare('SELECT id FROM insights WHERE id = ?').bind(id).first();
  if (!cur) return jsonResponse({ error: 'Not found' }, 404);
  await env.DB.prepare('DELETE FROM insights WHERE id = ?').bind(id).run();
  return jsonResponse({ success: true });
}

// ── Users (기존) ─────────────────────────────────────────────
async function handleGetUsers(request, env) {
  if (!await verifyAdminStrict(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);

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
  if (!await verifyAdminStrict(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
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
  if (!await verifyAdminStrict(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  const user = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first();
  if (!user) return jsonResponse({ error: 'User not found' }, 404);
  if (user.role === 'admin') return jsonResponse({ error: 'Cannot delete admin user' }, 403);
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
  return jsonResponse({ success: true, message: 'User deleted' });
}

async function handleUpdatePermissions(userId, request, env) {
  if (!await verifyAdminStrict(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
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
  const tokenUserId = await getUserIdFromToken(request, env);
  if (!tokenUserId || tokenUserId !== parseInt(userId)) return jsonResponse({ error: 'Unauthorized' }, 401);
  await ensureEmailColumns(env);
  const row = await env.DB.prepare(
    'SELECT notify_enabled, notify_days, notify_hour, notify_minute, email_enabled FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!row) return jsonResponse({ error: 'User not found' }, 404);
  return jsonResponse({ success: true, notify_enabled: row.notify_enabled || 0, notify_days: row.notify_days, notify_hour: row.notify_hour, notify_minute: row.notify_minute || 0, email_enabled: row.email_enabled || 0 });
}

async function handleUpdateNotify(userId, request, env) {
  const tokenUserId = await getUserIdFromToken(request, env);
  if (!tokenUserId || tokenUserId !== parseInt(userId)) return jsonResponse({ error: 'Unauthorized' }, 401);
  const { notify_enabled, notify_days, notify_hour, notify_minute, email_enabled } = await request.json();
  await ensureEmailColumns(env);
  await env.DB.prepare(
    'UPDATE users SET notify_enabled = ?, notify_days = ?, notify_hour = ?, notify_minute = ?, email_enabled = ? WHERE id = ?'
  ).bind(notify_enabled ? 1 : 0, notify_days || null, notify_hour ?? null, notify_minute ?? 0,
         email_enabled ? 1 : 0, userId).run();
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
async function sendKakaoNotifyMessage(accessToken, wisdomItem) {
  // wisdomItem: { title, id, column } 또는 문자열(하위 호환)
  const obj      = typeof wisdomItem === 'object' ? wisdomItem : null;
  const sentence = (obj ? obj.title : wisdomItem) || '오늘의 한 문장이 기다리고 있어요';
  const chId     = obj?.id ?? null;
  const column   = obj?.column ?? null;

  // 칼럼이 있으면 칼럼으로, 없으면 예전 딥링크로 보낸다.
  const url = column
    ? `https://99wisdombook.org/insight/${column.slug}`
    : chId
      ? `https://99wisdombook.org/daily.html?autoopen=1&ch=${chId}`
      : 'https://99wisdombook.org/daily.html?autoopen=1';
  const link = { web_url: url, mobile_web_url: url };

  // 카카오는 SVG를 못 읽으므로 미리 만들어 둔 PNG 공유 카드(2:1)를 쓴다.
  const imageUrl = column?.hero_image || 'https://99wisdombook.org/og-image.png';
  const template = {
    object_type: 'feed',
    content: {
      title: `"${sentence}"`,
      description: column ? (column.title || '') : '',
      image_url: imageUrl,
      image_width: 1200, image_height: column?.hero_image ? 600 : 630,
      link,
    },
    buttons: [
      {
        title: column ? '오늘의 칼럼 읽기' : '지혜의 문장 본문 읽기',
        link,
      },
    ],
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

// ── 카카오 알림 테스트 (어드민 전용) ────────────────────────
async function handleKakaoTest(request, env) {
  const userId = await getUserIdFromToken(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const user = await env.DB.prepare(
    'SELECT id, role, kakao_refresh_token FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!user || user.role !== 'admin') return jsonResponse({ error: 'Admin only' }, 403);
  if (!user.kakao_refresh_token) return jsonResponse({ error: '카카오 재로그인 필요' }, 400);

  // 오늘의 지혜 조회 (앱과 동일한 FNV32 로직으로 사용자별 개인화) → { title, id }
  let wisdomItem = { title: '오늘의 한 문장이 기다리고 있어요', id: null };
  try {
    const wRes = await fetch('https://99wisdombook.org/data/wisdom.json');
    const wData = await wRes.json();
    const items = wData.items || [];
    if (items.length) {
      const dk = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const actor = 'u-' + user.id;
      let h = 2166136261 >>> 0;
      for (const c of `${dk}|${actor}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
      const item = items[h % items.length];
      wisdomItem = { title: item?.title || wisdomItem.title, id: item?.id ?? null };
    }
  } catch (_) {}

  try {
    const { access_token, new_refresh_token } = await refreshKakaoAccessToken(user.kakao_refresh_token, env);
    if (new_refresh_token) {
      await env.DB.prepare('UPDATE users SET kakao_refresh_token = ? WHERE id = ?')
        .bind(new_refresh_token, userId).run();
    }
    const result = await sendKakaoNotifyMessage(access_token, wisdomItem);
    return jsonResponse({ success: true, wisdom: wisdomItem.title, kakao: result });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

// ── 추천인 코드 발급/조회 ────────────────────────────────────
function genReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const b of bytes) code += chars[b % chars.length];
  return code;
}

async function handleGetReferralCode(request, env) {
  const userId = await getUserIdFromToken(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  let user = await env.DB.prepare('SELECT id, name, referral_code, referral_count FROM users WHERE id = ?').bind(userId).first();
  if (!user) return jsonResponse({ error: 'User not found' }, 404);

  // 코드 없으면 생성 (최대 5회 재시도로 충돌 방지)
  if (!user.referral_code) {
    let code = '', attempts = 0;
    while (attempts < 5) {
      code = genReferralCode();
      try {
        await env.DB.prepare('UPDATE users SET referral_code = ? WHERE id = ?').bind(code, userId).run();
        break;
      } catch (_) { attempts++; }
    }
    user = { ...user, referral_code: code };
  }

  const referralUrl = `https://99wisdombook.org/?ref=${user.referral_code}`;
  const count = user.referral_count || 0;
  const badge = count >= 10 ? { emoji: '👑', label: '지혜의 왕' }
              : count >= 5  ? { emoji: '🌟', label: '지혜의 별' }
              : count >= 3  ? { emoji: '🌿', label: '지혜 전파자' }
              : count >= 1  ? { emoji: '🌱', label: '씨앗 전도사' }
              : null;

  return jsonResponse({ success: true, code: user.referral_code, url: referralUrl, count, badge });
}

async function handleGetReferralStats(request, env) {
  const userId = await getUserIdFromToken(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const user = await env.DB.prepare('SELECT referral_count FROM users WHERE id = ?').bind(userId).first();
  const referred = await env.DB.prepare(
    'SELECT name, created_at FROM users WHERE referred_by = ? ORDER BY created_at DESC LIMIT 20'
  ).bind(userId).all();

  const count = user?.referral_count || 0;
  return jsonResponse({ success: true, count, referred: referred.results || [] });
}

// ── 스트릭 끊김 방지 리마인더 (저녁 8시 KST) ─────────────────
async function handleReminderCron(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const cronSecret = (env.CRON_SECRET || '').trim();
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`)
    return jsonResponse({ error: 'Unauthorized' }, 401);

  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

  // 오늘 읽지 않았고, 스트릭이 있고, 카카오 연동된 사용자
  let users = [];
  try {
    const r = await env.DB.prepare(`
      SELECT id, kakao_refresh_token, streak_count
      FROM users
      WHERE notify_enabled = 1
        AND kakao_refresh_token IS NOT NULL
        AND streak_count >= 1
        AND (last_wisdom_date IS NULL OR last_wisdom_date != ?)
    `).bind(today).all();
    users = r.results || [];
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }

  const results = { sent: 0, errors: [] };
  for (const user of users) {
    try {
      const { access_token, new_refresh_token } = await refreshKakaoAccessToken(user.kakao_refresh_token, env);
      if (new_refresh_token)
        await env.DB.prepare('UPDATE users SET kakao_refresh_token = ? WHERE id = ?').bind(new_refresh_token, user.id).run();

      const streak = user.streak_count || 1;
      const url = 'https://99wisdombook.org/daily.html?autoopen=1';
      const link = { web_url: url, mobile_web_url: url };
      const template = {
        object_type: 'feed',
        content: {
          title: `🔥 ${streak}일 연속 독서 스트릭이 끊길 뻔했어요!`,
          description: '오늘의 한 문장, 아직 읽지 않으셨네요. 지금 바로 확인해보세요.',
          image_url: 'https://99wisdombook.org/og-image.png',
          image_width: 1200, image_height: 630,
          link,
        },
        buttons: [{ title: '오늘의 문장 읽기', link }],
      };
      const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ template_object: JSON.stringify(template) }),
      });
      if (res.ok) results.sent++;
      else results.errors.push({ userId: user.id, error: await res.text() });
    } catch (err) {
      results.errors.push({ userId: user.id, error: err.message });
    }
  }
  return jsonResponse({ success: true, date: today, total: users.length, ...results });
}

// ── 주간 리포트 (일요일 저녁) ──────────────────────────────────
async function handleWeeklyCron(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const cronSecret = (env.CRON_SECRET || '').trim();
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`)
    return jsonResponse({ error: 'Unauthorized' }, 401);

  // 카카오 연동 + 스트릭 있는 사용자
  let users = [];
  try {
    const r = await env.DB.prepare(`
      SELECT id, name, kakao_refresh_token, streak_count
      FROM users
      WHERE kakao_refresh_token IS NOT NULL AND streak_count >= 1
    `).all();
    users = r.results || [];
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }

  const results = { sent: 0, errors: [] };
  for (const user of users) {
    try {
      const { access_token, new_refresh_token } = await refreshKakaoAccessToken(user.kakao_refresh_token, env);
      if (new_refresh_token)
        await env.DB.prepare('UPDATE users SET kakao_refresh_token = ? WHERE id = ?').bind(new_refresh_token, user.id).run();

      const streak = user.streak_count || 0;
      const name = user.name || '독자';
      const url = 'https://99wisdombook.org/daily.html?autoopen=1';
      const link = { web_url: url, mobile_web_url: url };
      const emoji = streak >= 30 ? '🏆' : streak >= 14 ? '🌟' : streak >= 7 ? '🔥' : '📖';
      const template = {
        object_type: 'feed',
        content: {
          title: `${emoji} ${name}님, 이번 주도 수고하셨어요!`,
          description: `현재 ${streak}일 연속 독서 중 · 꾸준함이 지혜가 됩니다.`,
          image_url: 'https://99wisdombook.org/og-image.png',
          image_width: 1200, image_height: 630,
          link,
        },
        buttons: [{ title: '내일의 문장 미리 보기', link }],
      };
      const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ template_object: JSON.stringify(template) }),
      });
      if (res.ok) results.sent++;
      else results.errors.push({ userId: user.id, error: await res.text() });
    } catch (err) {
      results.errors.push({ userId: user.id, error: err.message });
    }
  }
  return jsonResponse({ success: true, total: users.length, ...results });
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
  const kstHour   = (now.getUTCHours() + 9) % 24;
  const kstMinute = now.getUTCMinutes();
  // 30분 단위로 반올림 (0~14분 → 0분, 15~44분 → 30분, 45~59분 → 다음 시간 0분)
  const kstMinuteSlot = kstMinute < 15 ? 0 : kstMinute < 45 ? 30 : 0;
  const kstHourAdj    = kstMinute >= 45 ? (kstHour + 1) % 24 : kstHour;
  const kstDay  = new Date(now.getTime() + 9 * 3600 * 1000).getUTCDay(); // 0=일,1=월…6=토

  // 디버그: notify_enabled 사용자 전체 조회 (시각 무관)
  let debugUsers = [];
  try {
    const dbg = await env.DB.prepare(`
      SELECT id, name, notify_enabled, notify_hour, notify_days,
             CASE WHEN kakao_refresh_token IS NOT NULL THEN 1 ELSE 0 END as has_refresh_token
      FROM users WHERE notify_enabled = 1
    `).all();
    debugUsers = dbg.results || [];
  } catch (_) {}

  // 이 시각 알림 설정 사용자 조회 (refresh_token 조건 완화)
  let users;
  try {
    const result = await env.DB.prepare(`
      SELECT id, name, email, email_enabled, kakao_refresh_token, notify_days,
             push_endpoint, push_p256dh, push_auth
      FROM users
      WHERE notify_enabled = 1
        AND notify_hour = ?
        AND (notify_minute = ? OR (notify_minute IS NULL AND ? = 0))
    `).bind(kstHourAdj, kstMinuteSlot, kstMinuteSlot).all();
    users = result.results || [];
  } catch (err) {
    return jsonResponse({ error: err.message, debug: debugUsers }, 500);
  }

  // 오늘의 지혜 데이터 조회
  let wisdomItems = [];
  const kstDateKey = new Date(now.getTime() + 9 * 3600 * 1000)
    .toISOString().slice(0, 10); // "YYYY-MM-DD" KST 기준
  try {
    const wRes = await fetch('https://99wisdombook.org/data/wisdom.json');
    const wData = await wRes.json();
    wisdomItems = wData.items || [];
  } catch (_) {}

  await ensureEmailColumns(env);

  // 장별 칼럼 (99장 전편 발행 완료). 알림은 책 본문이 아니라 이 칼럼으로 보낸다.
  const columnByChapter = {};
  try {
    const cRes = await env.DB.prepare(
      "SELECT chapter_id, slug, title, quotable, hero_image FROM insights WHERE status = 'published'"
    ).all();
    for (const row of (cRes.results || [])) columnByChapter[row.chapter_id] = row;
  } catch (_) {}

  // index.html과 동일한 FNV32 해시 함수
  function fnv32(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // 사용자별 오늘의 문장 인덱스 계산 (앱과 동일한 로직) → { title, id } 반환
  function getUserWisdomItem(userId) {
    if (!wisdomItems.length) return { title: '오늘의 한 문장이 기다리고 있어요', id: null };
    const actor = 'u-' + userId;
    const idx = fnv32(`${kstDateKey}|${actor}`) % wisdomItems.length;
    const item = wisdomItems[idx];
    const id = item?.id ?? null;
    return {
      title: item?.title || '오늘의 한 문장이 기다리고 있어요',
      id,
      column: (id != null && columnByChapter[id]) || null,
    };
  }

  const results = { sent: 0, push_sent: 0, email_sent: 0, skipped: 0, errors: [] };

  for (const user of users) {
    // 요일 체크 (notify_days: "1,3,5" 형태)
    if (user.notify_days) {
      const days = user.notify_days.split(',').map(Number);
      if (!days.includes(kstDay)) { results.skipped++; continue; }
    }

    // 사용자별 개인화된 오늘의 문장 (챕터 ID 포함)
    const wisdomItem = getUserWisdomItem(user.id);
    const pushUrl = wisdomItem.column
      ? `/insight/${wisdomItem.column.slug}`
      : wisdomItem.id
        ? `/daily.html?autoopen=1&ch=${wisdomItem.id}`
        : '/daily.html?autoopen=1';

    // ── 카카오 알림 ──
    try {
      if (!user.kakao_refresh_token) {
        results.errors.push({ userId: user.id, error: 'refresh_token 없음 - 카카오 재로그인 필요' });
      } else {
        const { access_token, new_refresh_token } = await refreshKakaoAccessToken(user.kakao_refresh_token, env);
        if (new_refresh_token) {
          await env.DB.prepare('UPDATE users SET kakao_refresh_token = ? WHERE id = ?')
            .bind(new_refresh_token, user.id).run();
        }
        await sendKakaoNotifyMessage(access_token, wisdomItem);
        results.sent++;
      }
    } catch (err) {
      results.errors.push({ userId: user.id, error: err.message });
    }

    // ── Web Push 알림 (독립적) ──
    if (user.push_endpoint && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      try {
        await sendWebPush(
          user.push_endpoint, user.push_p256dh, user.push_auth,
          {
            title: wisdomItem.column ? wisdomItem.title : '📚 오늘의 Daily Wisdom',
            body:  wisdomItem.column ? wisdomItem.column.title : wisdomItem.title,
            url:   pushUrl,
          },
          env.VAPID_PRIVATE_KEY.trim(), env.VAPID_PUBLIC_KEY.trim(),
          (env.VAPID_SUBJECT || 'mailto:info@99wisdombook.org').trim()
        );
        results.push_sent++;
      } catch (pushErr) {
        results.errors.push({ userId: user.id, error: `WebPush: ${pushErr.message}` });
      }
    }

    // ── 이메일 뉴스레터 (독립적) ──
    if (user.email_enabled && user.email) {
      try {
        await sendNewsletterEmail(env, user, wisdomItem);
        results.email_sent++;
      } catch (mailErr) {
        results.errors.push({ userId: user.id, error: `Email: ${mailErr.message}` });
      }
    }
  }

  return jsonResponse({ success: true, kstHour: kstHourAdj, kstMinute: kstMinuteSlot, kstDay, total: users.length, ...results, debug_notify_users: debugUsers });
}

// ── 카카오/인스타 공유용 동적 이미지 (SVG 직접 반환) ────
function handleWisdomCard(request) {
  const url = new URL(request.url);
  const text = (url.searchParams.get('t') || '오늘의 한 문장').slice(0, 60);
  const square = url.searchParams.get('sq') === '1'; // 인스타용 정사각형
  const kakao  = url.searchParams.get('kakao') === '1'; // 카카오 공유용 800×400

  const W = square ? 1080 : (kakao ? 800 : 1200);
  const H = square ? 1080 : (kakao ? 400 : 630);
  const cx = W / 2;

  // 어절(공백) 단위 줄바꿈 — 한 줄에 들어가면 1줄, 길면 단어 경계에서 분리
  const maxLineLen = square ? 10 : (kakao ? 14 : 15);
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (test.length <= maxLineLen) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      if (word.length > maxLineLen) {
        // 단어 자체가 너무 길면 글자 단위로 분할
        for (let i = 0; i < word.length; i += maxLineLen) {
          const chunk = word.slice(i, i + maxLineLen);
          if (i + maxLineLen < word.length) lines.push(chunk);
          else cur = chunk;
        }
      } else {
        cur = word;
      }
    }
  }
  if (cur) lines.push(cur);

  // 폰트 크기 조정
  const fontSize = square
    ? (lines.length <= 2 ? 72 : lines.length <= 3 ? 60 : 50)
    : kakao
      ? (lines.length <= 2 ? 38 : lines.length <= 3 ? 32 : 28)
      : (lines.length <= 2 ? 58 : lines.length <= 3 ? 50 : 42);
  const lineH = fontSize * 1.55;
  const totalTextH = lines.length * lineH;

  // 헤더 높이 비율 조정
  const headerH = square ? 340 : (kakao ? 110 : 200);
  const areaTop = headerH + (kakao ? 20 : 30);
  const areaBot = H - (kakao ? 44 : 60);
  const textStartY = areaTop + (areaBot - areaTop - totalTextH) / 2 + fontSize * 0.85;

  // 헤더 텍스트 크기
  const titleSize    = square ? 88 : (kakao ? 44 : 68);
  const subtitleSize = square ? 34 : (kakao ? 17 : 26);
  const titleY       = square ? 160 : (kakao ? 62 : 105);
  const subtitleY    = square ? 230 : (kakao ? 92 : 152);
  const lineY        = square ? 280 : (kakao ? 110 : 185);
  const lineX1       = square ? 120 : (kakao ? 60 : 100);
  const lineX2       = square ? 960 : (kakao ? 740 : 1100);

  const tspans = lines.map((l, i) =>
    `<tspan x="${cx}" dy="${i === 0 ? 0 : lineH}">${escSvg(l)}</tspan>`
  ).join('');

  // 인스타/카카오용: 하단 URL 표시
  const urlText = (square || kakao)
    ? `<text x="${cx}" y="${H - (kakao ? 14 : 60)}" font-family="Georgia,serif" font-size="${kakao ? 16 : 30}" fill="#c9a96e" text-anchor="middle" opacity="0.7">99wisdombook.org</text>`
    : '';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#3e2820"/>
  <text x="${cx}" y="${titleY}"
    font-family="'Helvetica Neue',Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif"
    font-size="${titleSize}" font-weight="300"
    fill="#ffffff" text-anchor="middle" letter-spacing="14">DAILY WISDOM</text>
  <text x="${cx}" y="${subtitleY}"
    font-family="'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif"
    font-size="${subtitleSize}" font-weight="400"
    fill="#c9a96e" text-anchor="middle">살아본 뒤에야 비로소 읽히는 문장들</text>
  <line x1="${lineX1}" y1="${lineY}" x2="${lineX2}" y2="${lineY}" stroke="#c9a96e" stroke-width="1.5" opacity="0.55"/>
  <text
    x="${cx}" y="${textStartY}"
    font-family="'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif"
    font-size="${fontSize}" font-weight="700"
    fill="#f5e9d8" text-anchor="middle" letter-spacing="-0.5"
  >${tspans}</text>
  ${urlText}
</svg>`;

  const cd = square ? 'attachment; filename="daily-wisdom.svg"' : 'inline';
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Content-Disposition': cd,
      'Cache-Control': 'public, max-age=3600',
      ...corsHeaders,
    },
  });
}

function escSvg(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Web Push 암호화 ────────────────────────────────────────────

function b64uDecode(str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function b64uEncode(buf) {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  arr.forEach(b => s += String.fromCharCode(b));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function joinBufs(...bufs) {
  const n = bufs.reduce((a, b) => a + b.byteLength, 0);
  const out = new Uint8Array(n);
  let off = 0;
  for (const b of bufs) { out.set(new Uint8Array(b), off); off += b.byteLength; }
  return out;
}

async function hmacSha256(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

async function hkdfExtract(salt, ikm) { return hmacSha256(salt, ikm); }

async function hkdfExpand(prk, info, len) {
  const out = new Uint8Array(len);
  let t = new Uint8Array(0), off = 0;
  for (let i = 1; off < len; i++) {
    t = await hmacSha256(prk, joinBufs(t, info, new Uint8Array([i])));
    const take = Math.min(t.length, len - off);
    out.set(t.slice(0, take), off); off += take;
  }
  return out;
}

// VAPID JWT (ES256) 생성
async function createVapidJwt(privB64u, pubB64u, aud, sub) {
  const enc = new TextEncoder();
  const hdr = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const pay = b64uEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 43200, sub })));
  const sigInput = `${hdr}.${pay}`;
  const pub = b64uDecode(pubB64u);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), d: privB64u };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(sigInput));
  return `${sigInput}.${b64uEncode(new Uint8Array(sig))}`;
}

// RFC 8291 aes128gcm 암호화
async function encryptWebPush(plaintext, p256dhB64u, authB64u) {
  const recvPub = b64uDecode(p256dhB64u);
  const authSec = b64uDecode(authB64u);

  const sKP = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sPub = new Uint8Array(await crypto.subtle.exportKey('raw', sKP.publicKey));

  const recvKey = await crypto.subtle.importKey('raw', recvPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhBits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: recvKey }, sKP.privateKey, 256));

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // IKM via RFC 8291 §3.3
  const ikmInfo = joinBufs(new TextEncoder().encode('WebPush: info\x00'), recvPub, sPub);
  const prkKey = await hkdfExtract(authSec, ecdhBits);
  const ikm = await hkdfExpand(prkKey, ikmInfo, 32);

  // PRK for record encryption
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: nonce\x00'), 12);

  // plaintext + 0x02 delimiter (final record)
  const pt = joinBufs(new TextEncoder().encode(plaintext), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, pt));

  // Header: salt(16) + rs(4 BE) + keylen(1) + sender_pub(65)
  const hdr = new Uint8Array(21 + sPub.length);
  hdr.set(salt, 0);
  new DataView(hdr.buffer).setUint32(16, 4096, false);
  hdr[20] = sPub.length;
  hdr.set(sPub, 21);

  return joinBufs(hdr, ct);
}

// Web Push 발송
async function sendWebPush(endpoint, p256dhB64u, authB64u, payload, vapidPriv, vapidPub, vapidSub) {
  const origin = new URL(endpoint).origin;
  const jwt = await createVapidJwt(vapidPriv, vapidPub, origin, vapidSub);
  const body = await encryptWebPush(JSON.stringify(payload), p256dhB64u, authB64u);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt},k=${vapidPub}`,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
    },
    body,
  });
  if (res.status !== 200 && res.status !== 201) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${res.status} ${txt.slice(0, 200)}`);
  }
  return res.status;
}

// ── Web Push 구독 관리 ──────────────────────────────────────────

async function handlePushSubscribe(request, env) {
  const tokenUserId = await getUserIdFromToken(request, env);
  if (!tokenUserId) return jsonResponse({ error: 'Unauthorized' }, 401);
  const body = await request.json();
  const { endpoint } = body;
  const p256dh = body.keys?.p256dh;
  const auth   = body.keys?.auth;
  if (!endpoint || !p256dh || !auth) return jsonResponse({ error: 'Invalid subscription' }, 400);
  try {
    await env.DB.prepare(
      'UPDATE users SET push_endpoint=?, push_p256dh=?, push_auth=? WHERE id=?'
    ).bind(endpoint, p256dh, auth, tokenUserId).run();
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
  return jsonResponse({ success: true });
}

async function handlePushUnsubscribe(request, env) {
  const tokenUserId = await getUserIdFromToken(request, env);
  if (!tokenUserId) return jsonResponse({ error: 'Unauthorized' }, 401);
  try {
    await env.DB.prepare(
      'UPDATE users SET push_endpoint=NULL, push_p256dh=NULL, push_auth=NULL WHERE id=?'
    ).bind(tokenUserId).run();
  } catch (_) {}
  return jsonResponse({ success: true });
}

async function handlePushTest(request, env) {
  const tokenUserId = await getUserIdFromToken(request, env);
  if (!tokenUserId) return jsonResponse({ error: 'Unauthorized' }, 401);

  let row;
  try {
    row = await env.DB.prepare(
      'SELECT push_endpoint, push_p256dh, push_auth FROM users WHERE id=?'
    ).bind(tokenUserId).first();
  } catch (err) {
    return jsonResponse({ error: 'DB 오류: ' + err.message }, 500);
  }

  if (!row?.push_endpoint) {
    return jsonResponse({ error: '구독 정보 없음 — 알림 설정에서 "브라우저 알림 허용하기"를 먼저 눌러주세요.' }, 400);
  }
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return jsonResponse({ error: 'VAPID 키 미설정 (Cloudflare 시크릿 확인 필요)' }, 500);
  }

  const vapidPriv = env.VAPID_PRIVATE_KEY.trim();
  const vapidPub  = env.VAPID_PUBLIC_KEY.trim();
  const vapidSub  = (env.VAPID_SUBJECT || 'mailto:info@99wisdombook.org').trim();

  // 1단계: 암호화된 푸시 시도
  try {
    await sendWebPush(
      row.push_endpoint, row.push_p256dh, row.push_auth,
      { title: '📚 오늘의 Daily Wisdom', body: '웹 푸시 알림이 정상 작동합니다!', url: '/daily.html?autoopen=1' },
      vapidPriv, vapidPub, vapidSub
    );
    return jsonResponse({ success: true, message: '암호화 푸시 발송 완료' });
  } catch (encErr) {
    // 2단계: 암호화 실패 시 빈 body로 재시도 (서비스워커 연결 확인)
    try {
      const origin = new URL(row.push_endpoint).origin;
      const jwt = await createVapidJwt(vapidPriv, vapidPub, origin, vapidSub);
      const plainRes = await fetch(row.push_endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `vapid t=${jwt},k=${vapidPub}`,
          'TTL': '60',
        },
      });
      const plainStatus = plainRes.status;
      if (plainStatus === 200 || plainStatus === 201) {
        return jsonResponse({
          success: false,
          stage: 'encryption',
          error: '구독 연결은 정상이지만 암호화 오류: ' + encErr.message,
          hint: '관리자에게 문의하세요 (VAPID 키 불일치 가능성)',
        });
      } else {
        const txt = await plainRes.text().catch(() => '');
        return jsonResponse({
          success: false,
          stage: 'subscription',
          error: `구독 엔드포인트 오류 (${plainStatus}) — 알림 설정에서 재등록 필요`,
          detail: txt.slice(0, 200),
        }, 500);
      }
    } catch (plainErr) {
      return jsonResponse({
        success: false,
        stage: 'network',
        error: '푸시 서버 연결 실패: ' + plainErr.message,
      }, 500);
    }
  }
}

async function handlePushStatus(request, env) {
  const tokenUserId = await getUserIdFromToken(request, env);
  if (!tokenUserId) return jsonResponse({ error: 'Unauthorized' }, 401);
  try {
    const row = await env.DB.prepare(
      'SELECT push_endpoint, push_p256dh, push_auth FROM users WHERE id=?'
    ).bind(tokenUserId).first();
    const has_subscription = !!(row?.push_endpoint && row?.push_p256dh && row?.push_auth);
    return jsonResponse({
      success: true,
      has_subscription,
      endpoint_prefix: row?.push_endpoint ? row.push_endpoint.slice(0, 50) + '…' : null,
      has_vapid: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}
