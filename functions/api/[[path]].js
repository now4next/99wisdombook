/**
 * Cloudflare Workers API for 99 Wisdom Book
 *
 * 독자에게는 로그인이 없다. 메일 링크의 토큰으로 신분을 확인한다.
 * 비밀번호로 들어오는 길은 관리자에게만 남아 있다.
 *
 * 독자 (토큰):
 * - POST   /api/email/start                 (주소만 적으면 링크를 보낸다)
 * - GET    /api/email/subscribe             (링크를 누르면 알림이 켜진다)
 * - GET    /api/email/unsubscribe
 * - GET    /api/me  ·  PUT /api/me          (별명)
 *
 * Auth endpoints (관리자):
 * - POST   /api/auth/login
 * - POST   /api/auth/logout
 * - GET/POST /api/auth/forgot · /api/auth/reset
 *
 * User endpoints:
 * - GET    /api/users                       (admin)
 * - POST   /api/users                       (admin)
 * - GET    /api/users/:id
 * - PUT    /api/users/:id                   (admin)
 * - DELETE /api/users/:id                   (admin)
 * - PUT    /api/users/:id/permissions       (admin)
 * - PUT    /api/users/:id/profile           (본인만)
 * - PUT    /api/users/:id/password          (본인만 · 현재 비밀번호 확인)
 * - POST   /api/users/:id/password/reset    (admin · 임시 비밀번호 재발급)
 *
 * Wisdom / Phase 2+3:
 * - GET    /api/wisdom/saved                (독자 토큰)
 * - POST   /api/wisdom/save                 (독자 토큰)
 * - DELETE /api/wisdom/save/:chapter_id     (독자 토큰)
 * - POST   /api/wisdom/streak               (독자 토큰)
 *
 * 독자의 기록:
 * - GET    /api/notes/:chapter_id           (공개 목록)
 * - GET    /api/notes/:chapter_id/mine      (내가 쓴 것 · 쓸 수 있는지)
 * - POST   /api/notes/:chapter_id           (쓰기 토큰)
 * - DELETE /api/notes/:chapter_id
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

/* 비밀번호 해시.

   예전에는 소금 없는 SHA-256 한 번이었다. 빠른 해시라 유출되면 무차별
   대입이 사실상 공짜고, 소금이 없어 같은 비밀번호를 쓴 계정이 한눈에
   드러난다. 지금은 PBKDF2-SHA256 을 쓴다.

   저장 형식: pbkdf2$<반복 횟수>$<소금 base64>$<해시 base64>
   기존 계정의 값은 64자리 16진수 그대로 남아 있다. verifyPassword 가
   두 형식을 모두 받고, 로그인에 성공하면 새 형식으로 조용히 올린다. */
/* 반복 횟수는 Workers 가 PBKDF2 에 허용하는 상한(10만)에 맞췄다.
   나중에 올리면 verifyPassword 가 낡은 값을 needsUpgrade 로 표시해
   로그인할 때 알아서 다시 해시한다. */
const PBKDF2_ITERATIONS = 100000;

function bytesToB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pbkdf2Bits(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256
  );
  return new Uint8Array(bits);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Bits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(hash)}`;
}

/** 구버전 형식. 대조용으로만 남긴다 — 새로 저장하는 데 쓰지 말 것. */
async function legacyHashPassword(password) {
  const data = new TextEncoder().encode(password);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

/** 길이가 달라도 비교 시간이 값에 따라 달라지지 않게 한다. */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 맞으면 { ok: true, needsUpgrade } 를 준다. needsUpgrade 면 새 형식으로 다시 저장한다. */
async function verifyPassword(password, stored) {
  if (!stored) return { ok: false, needsUpgrade: false };
  if (stored.startsWith('pbkdf2$')) {
    const [, iterStr, saltB64, hashB64] = stored.split('$');
    const iterations = parseInt(iterStr, 10);
    if (!iterations || !saltB64 || !hashB64) return { ok: false, needsUpgrade: false };
    let got;
    try {
      got = await pbkdf2Bits(password, b64ToBytes(saltB64), iterations);
    } catch (_) {
      return { ok: false, needsUpgrade: false };
    }
    const ok = timingSafeEqual(bytesToB64(got), hashB64);
    return { ok, needsUpgrade: ok && iterations < PBKDF2_ITERATIONS };
  }
  // 구버전 소금 없는 SHA-256
  const ok = timingSafeEqual(await legacyHashPassword(password), stored);
  return { ok, needsUpgrade: ok };
}

/** 로그인에 성공한 구버전 해시를 새 형식으로 올린다. 실패해도 로그인은 막지 않는다. */
async function upgradePasswordHash(env, userId, password) {
  try {
    await env.DB.prepare('UPDATE users SET password = ? WHERE id = ?')
      .bind(await hashPassword(password), userId).run();
  } catch (_) {}
}

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ⚠ 인증 계약 — 아래 규칙을 깨면 관리자 사칭이 가능해진다.

   세션(아래)은 이제 관리자만 쓴다. 독자 쪽은 메일 링크의 토큰으로
   확인하며 reader()/readerId() 를 거친다 — 아래 '독자 토큰' 참고.

     · 토큰은 64자 hex 난수이며 그 자체에 아무 정보도 담지 않는다.
       (예전 btoa(`id:시각`) 방식은 누구나 위조할 수 있어 폐기했다.)
     · 서버는 원본을 저장하지 않고 SHA-256 해시만 sessions 테이블에 둔다.
     · 관리자 판별은 반드시 await verifyAdminStrict(request, env) 로 한다.
       토큰 문자열을 직접 해석하는 코드를 다시 만들지 말 것. 길이나 존재만
       보는 검사를 추가하지 말 것.
     · 독자 판별에 getUserIdFromToken 을 쓰지 말 것. 독자에게는 세션이
       없으므로 늘 null 이 되고, 화면은 조용히 빈 채로 남는다. */
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
    if (path === '/api/auth/logout'   && method === 'POST') return handleLogout(request, env);
    /* 가입은 없앴다. 주소를 적으면 메일로 링크가 가고, 그 링크가 곧
       신분 확인이다. 화면도 함께 치웠으므로 이 경로로 들어오는 것은
       옛 북마크나 긁는 쪽뿐이다. */
    if (path === '/api/auth/register' && method === 'POST')
      return jsonResponse({
        success: false,
        error: '가입 절차가 없어졌습니다. 이메일 주소만 적으시면 링크를 보내 드립니다.',
        start: 'https://99wisdombook.org/api/email/start',
      }, 410);
    if (path === '/api/email/unsubscribe' && method === 'GET') return handleEmailUnsubscribe(request, env);
    if (path === '/api/email/unsubscribe/push' && method === 'POST') return handleUnsubscribePush(request, env);
    if (path === '/api/email/start' && method === 'GET')  return handleEmailStartPage(request, env);
    if (path === '/api/email/start' && method === 'POST') return handleEmailStart(request, env);
    if (path === '/api/me' && method === 'GET')  return handleMe(request, env);
    if (path === '/api/me' && method === 'PUT')  return handleMeUpdate(request, env);
    if (path === '/api/email/subscribe' && method === 'GET')  return handleEmailSubscribePage(request, env);
    if (path === '/api/email/subscribe' && method === 'POST') return handleEmailSubscribe(request, env);

    // 비밀번호 재설정 (로그인 없이)
    if (path === '/api/auth/forgot' && method === 'GET')  return handleForgotPage(request, env);
    if (path === '/api/auth/forgot' && method === 'POST') return handleForgotRequest(request, env);
    if (path === '/api/auth/reset'  && method === 'GET')  return handleResetPage(request, env);
    if (path === '/api/auth/reset'  && method === 'POST') return handleResetSubmit(request, env);

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

    // Notify (이메일 + Web Push)
    if (path.match(/^\/api\/users\/\d+\/notify$/) && method === 'GET')
      return handleGetNotify(path.split('/')[3], request, env);
    if (path.match(/^\/api\/users\/\d+\/notify$/) && method === 'PUT')
      return handleUpdateNotify(path.split('/')[3], request, env);
    if (path === '/api/notify/cron' && method === 'POST')
      return handleNotifyCron(request, env);
    /* 스케줄러는 대개 GET 이 기본값이다. 그대로 두면 404 라 "주소가 틀렸나"
       하고 엉뚱한 곳을 보게 되므로, 무엇이 필요한지 알려 준다. */
    if (path === '/api/notify/cron' && method === 'GET')
      return jsonResponse({
        error: 'Method Not Allowed',
        hint: 'POST 로 호출하고 Authorization: Bearer <CRON_SECRET> 헤더를 함께 보내세요.',
      }, 405);
    if (path === '/api/notify/reminder' && method === 'POST')
      return handleReminderCron(request, env);
    if (path === '/api/notify/weekly' && method === 'POST')
      return handleWeeklyCron(request, env);
    if (path === '/api/admin/clear-reader-passwords' && method === 'POST')
      return handleClearReaderPasswords(request, env);
    if (path === '/api/notify/promo' && method === 'POST')
      return handlePromoCron(request, env);
    if (path === '/api/notify/email-test' && method === 'POST')
      return handleEmailTest(request, env);
    if (path === '/api/email/preview' && method === 'GET')
      return handleEmailPreview(request, env);
    if (path === '/api/email/diag' && method === 'GET')
      return handleEmailDiag(request, env);
    if (path === '/api/notify/status' && method === 'GET')
      return handleNotifyStatus(request, env);

    // 추천인 시스템
    if (path === '/api/referral/code' && method === 'GET')
      return handleGetReferralCode(request, env);
    if (path === '/api/referral/stats' && method === 'GET')
      return handleGetReferralStats(request, env);

    // 공유용 동적 이미지 (문장 합성)
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
    if (path === '/api/admin/send-logs' && method === 'GET') return handleGetSendLogs(request, env);

    // Insights (칼럼)
    if (path === '/api/insights' && method === 'GET') return handleListInsights(request, env);
    if (path.match(/^\/api\/insights\/[A-Za-z0-9가-힣_-]+$/) && method === 'GET')
      return handleGetInsight(decodeURIComponent(path.split('/').pop()), env);
    // 독자의 기록 (칼럼 아래 익명 소감)
    if (path === '/api/notes/recent' && method === 'GET')
      return handleRecentNotes(request, env);
    if (path.match(/^\/api\/notes\/\d+$/) && method === 'GET')
      return handleListNotes(path.split('/').pop(), request, env);
    if (path.match(/^\/api\/notes\/\d+\/mine$/) && method === 'GET')
      return handleMyNote(path.split('/')[3], request, env);
    if (path.match(/^\/api\/notes\/\d+$/) && method === 'POST')
      return handleSaveNote(path.split('/').pop(), request, env);
    if (path.match(/^\/api\/notes\/\d+$/) && method === 'DELETE')
      return handleDeleteNote(path.split('/').pop(), request, env);

    if (path === '/api/admin/notes' && method === 'GET')
      return handleAdminListNotes(request, env);
    if (path.match(/^\/api\/admin\/notes\/\d+$/) && method === 'PUT')
      return handleAdminSetNoteStatus(path.split('/').pop(), request, env);
    if (path.match(/^\/api\/admin\/notes\/\d+$/) && method === 'DELETE')
      return handleAdminDeleteNote(path.split('/').pop(), request, env);
    if (path === '/api/admin/insights' && method === 'GET')    return handleAdminListInsights(request, env);
    if (path === '/api/admin/insights' && method === 'POST')   return handleCreateInsight(request, env);
    if (path.match(/^\/api\/admin\/insights\/\d+$/) && method === 'PUT')
      return handleUpdateInsight(path.split('/').pop(), request, env);
    if (path.match(/^\/api\/admin\/insights\/\d+$/) && method === 'DELETE')
      return handleDeleteInsight(path.split('/').pop(), request, env);

    // Users
    if (path === '/api/users' && method === 'GET') return handleGetUsers(request, env);
    if (path === '/api/users' && method === 'POST') return handleCreateUser(request, env);
    if (path.match(/^\/api\/users\/\d+$/) && method === 'GET')    return handleGetUser(path.split('/').pop(), env);
    if (path.match(/^\/api\/users\/\d+$/) && method === 'PUT')    return handleUpdateUser(path.split('/').pop(), request, env);
    if (path.match(/^\/api\/users\/\d+$/) && method === 'DELETE') return handleDeleteUser(path.split('/').pop(), request, env);
    if (path.match(/^\/api\/users\/\d+\/permissions$/) && method === 'PUT')
      return handleUpdatePermissions(path.split('/')[3], request, env);
    if (path.match(/^\/api\/users\/\d+\/profile$/) && method === 'PUT')
      return handleUpdateProfile(path.split('/')[3], request, env);
    if (path.match(/^\/api\/users\/\d+\/password$/) && method === 'PUT')
      return handleChangePassword(path.split('/')[3], request, env);
    if (path.match(/^\/api\/users\/\d+\/password\/reset$/) && method === 'POST')
      return handleResetPassword(path.split('/')[3], request, env);

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

  /* 비밀번호는 소금이 섞여 있어 SQL 에서 대조할 수 없다. 계정을 먼저
     찾고 해시는 코드에서 검증한다. */
  // 이메일로 조회 (신규) → 구버전 username으로 fallback
  let row = await env.DB.prepare(
    'SELECT id, username, name, email, role, permissions, last_login, password FROM users WHERE email = ?'
  ).bind(email).first();
  if (!row) {
    row = await env.DB.prepare(
      'SELECT id, username, name, email, role, permissions, last_login, password FROM users WHERE username = ?'
    ).bind(email).first();
  }

  const check = await verifyPassword(password, row?.password);
  if (!row || !check.ok) return jsonResponse({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);
  if (check.needsUpgrade) await upgradePasswordHash(env, row.id, password);
  delete row.password;

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

/* 이메일 뉴스레터용 컬럼. D1 에는 ADD COLUMN IF NOT EXISTS 가 없어
   이미 있으면 에러가 나므로 삼켜 넘긴다. */
async function ensureEmailColumns(env) {
  for (const sql of [
    'ALTER TABLE users ADD COLUMN email_enabled INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN unsubscribe_token TEXT',
    /* 독자가 스스로 정하는 표시 이름. 실명을 쓰지 않기로 했으므로
       기록·목록에는 이 값만 나간다. 비어 있으면 '독자'. */
    'ALTER TABLE users ADD COLUMN nickname TEXT',
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

/* ── 이메일 발송 공통 ────────────────────────────────────────
   ⚠ 발신 도메인(MAIL_FROM)이 Resend 에서 검증되기 전에는 발송이 거부된다.
      거부되면 MAIL_FROM_FALLBACK → Resend 테스트 발신자 순으로 한 단계씩 내려간다.
      테스트 발신자(onboarding@resend.dev)는 Resend 계정 소유자에게만 배달되므로
      첫 확인용으로만 쓰인다. 실제 운영은 MAIL_FROM 도메인 검증이 끝나야 한다. */
/* ⚠ 이 기본값들이 실제로 쓰인다.
     wrangler.jsonc 가 wrangler.toml 보다 먼저 인식되는데 pages_build_output_dir 이 없어
     설정 파일 전체가 무시되고 있어서, wrangler.toml 의 [vars] 는 반영되지 않는다.
     발신 주소를 바꾸려면 여기를 고치거나 Pages 대시보드의 환경 변수에 넣어야 한다. */
const MAIL_FROM_DEFAULT     = '99 Wisdom Insight <daily@99wisdombook.org>';
const MAIL_REPLY_TO_DEFAULT = 'info@99wisdombook.org';
const MAIL_TEST_SENDER      = '99 Wisdom Insight <onboarding@resend.dev>';

/** Resend 로 한 통 보낸다. 실제 사용된 발신자를 함께 돌려준다. */
async function sendEmail(env, m, from) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY 미설정');
  if (!m.to) throw new Error('수신 주소 없음');
  const sender = from || (env.MAIL_FROM || '').trim() || MAIL_FROM_DEFAULT;

  const headers = {};
  if (m.unsub) {
    headers['List-Unsubscribe'] = '<' + m.unsub + '>';
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: sender,
      to: [m.to],
      subject: m.subject,
      html: m.html,
      ...(m.text ? { text: m.text } : {}),
      reply_to: (env.MAIL_REPLY_TO || '').trim() || MAIL_REPLY_TO_DEFAULT,
      headers,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 도메인 미검증이면 다음 발신자로 한 단계 내려간다
    if (/not verified|domain is not verified/i.test(data.message || '')) {
      const chain = [
        (env.MAIL_FROM || '').trim() || MAIL_FROM_DEFAULT,
        (env.MAIL_FROM_FALLBACK || '').trim(),
        MAIL_TEST_SENDER,
      ].filter(Boolean);
      const next = chain[chain.indexOf(sender) + 1];
      if (next) return sendEmail(env, m, next);
    }
    const err = new Error(data.message || ('Resend ' + res.status));
    err.code = data.name || res.status;
    throw err;
  }
  return { ...data, from: sender };
}

/* 발송 기록.
   지금까지는 보냈는지 실패했는지 되짚을 방법이 전혀 없었다. 외부 스케줄러가
   401 로 26번 연속 실패해 멈춰 있어도 알 수 없었고, "오늘 메일이 왔나"를
   확인하려면 매번 추측해야 했다. 보낸 것과 실패한 것을 모두 남긴다. */
const SEND_LOG_KEEP_DAYS = 90;

async function ensureSendLogTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS send_logs (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id     INTEGER,
       user_name   TEXT,
       user_email  TEXT,
       channel     TEXT NOT NULL,
       kind        TEXT NOT NULL,
       chapter_id  INTEGER,
       status      TEXT NOT NULL,
       provider_id TEXT,
       from_addr   TEXT,
       error       TEXT,
       sent_at     TEXT DEFAULT CURRENT_TIMESTAMP
     )`
  ).run();
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_send_logs_sent ON send_logs(sent_at DESC)'
  ).run();
}

/* 기록이 실패해도 발송은 계속돼야 한다. 그래서 전부 삼킨다. */
async function recordSend(env, o) {
  try {
    await ensureSendLogTable(env);
    await env.DB.prepare(
      `INSERT INTO send_logs
         (user_id, user_name, user_email, channel, kind, chapter_id, status, provider_id, from_addr, error)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      o.user_id ?? null, o.user_name ?? null, o.user_email ?? null,
      o.channel, o.kind, o.chapter_id ?? null, o.status,
      o.provider_id ?? null, o.from_addr ?? null,
      o.error ? String(o.error).slice(0, 300) : null
    ).run();

    // 가끔 오래된 것을 지운다 (세션 정리와 같은 방식)
    if (Math.random() < 0.02) {
      await env.DB.prepare(
        `DELETE FROM send_logs WHERE sent_at < datetime('now', ?)`
      ).bind('-' + SEND_LOG_KEEP_DAYS + ' days').run();
    }
  } catch (_) {}
}

/* sendEmail 을 부르고 결과를 기록까지 하는 창구. 호출부가 성공·실패
   양쪽을 빠짐없이 남기도록 한곳으로 모은다. */
async function sendAndLog(env, message, meta) {
  try {
    const r = await sendEmail(env, message);
    await recordSend(env, {
      ...meta, channel: 'email', status: 'ok',
      provider_id: r.id || null, from_addr: r.from || null,
      user_email: meta.user_email || message.to,
    });
    return r;
  } catch (err) {
    await recordSend(env, {
      ...meta, channel: 'email', status: 'failed',
      error: err.message, user_email: meta.user_email || message.to,
    });
    throw err;
  }
}

/** MAIL_FROM 이 아닌 발신자로 나갔으면 남길 문구 (폴백이 쓰였다는 신호) */
function mailVia(env, r) {
  const want = (env.MAIL_FROM || '').trim() || MAIL_FROM_DEFAULT;
  return r && r.from && r.from !== want ? 'via ' + r.from : null;
}

const mailEsc = (t) => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 모든 메일이 쓰는 공통 뼈대. preheader 는 받은편지함 미리보기 줄. */
function emailLayout({ preheader, body, footer }) {
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="color-scheme" content="light"><title>99 Wisdom Insight</title></head>'
    + '<body style="margin:0;padding:0;background:#faf9f7;">'
    + '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">' + mailEsc(preheader || '') + '</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f7;">'
    + '<tr><td align="center" style="padding:28px 16px;">'
    + '<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"'
    + ' style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;border:1px solid #ece8e2;">'
    + body
    + '</table>'
    + '<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">'
    + '<tr><td align="center" style="padding:16px 8px 0;font-family:-apple-system,\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif;font-size:12px;line-height:1.8;color:#a29a90;">'
    + footer
    + '</td></tr></table></td></tr></table></body></html>';
}

const MAIL_SANS = "-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif";

/* 칼럼 본문(body_md)을 메일용 HTML 로 옮긴다. 본문에 실제로 쓰이는 문법은
   **굵게**, 인용(>), 불릿(-) 뿐이라 정식 마크다운 파서를 들일 이유가 없다.
   메일 클라이언트는 <style> 을 잘 지우므로 태그마다 인라인으로 준다. */
function mdToMailHtml(md) {
  const P = 'margin:0 0 15px;font-size:15px;line-height:1.85;color:#413b34;';
  return String(md || '').trim().split(/\n\s*\n/).map((block) => {
    const raw = block.trim();
    if (!raw) return '';
    const inline = (t) => mailEsc(t).replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#221f1b;">$1</strong>');

    if (/^>\s/.test(raw)) {
      const t = raw.split('\n').map((l) => l.replace(/^>\s?/, '')).join(' ');
      return '<blockquote style="margin:0 0 15px;padding:2px 0 2px 14px;'
        + 'border-left:3px solid #d8d2c8;font-size:15px;line-height:1.8;color:#5c554d;">'
        + inline(t) + '</blockquote>';
    }
    if (/^[-*]\s/.test(raw)) {
      const items = raw.split('\n').filter((l) => /^[-*]\s/.test(l))
        .map((l) => '<li style="margin:0 0 7px;">' + inline(l.replace(/^[-*]\s+/, '')) + '</li>').join('');
      return '<ul style="margin:0 0 15px;padding-left:20px;font-size:15px;line-height:1.85;color:#413b34;">' + items + '</ul>';
    }
    return '<p style="' + P + '">' + inline(raw.replace(/\n/g, ' ')) + '</p>';
  }).join('');
}

/** 같은 본문의 평문 버전 */
function mdToMailText(md) {
  return String(md || '').trim()
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

/** 오늘의 한 문장 + 칼럼 전문 */
function issueEmail(env, user, wisdomItem, unsubUrl, opt) {
  const promo = !!(opt && opt.promo);
  const noteUrl = (opt && opt.noteUrl) || '';
  const notes = (opt && opt.notes) || null;
  const c = wisdomItem.column;
  const SITE = 'https://99wisdombook.org';
  const webUrl    = c ? SITE + '/insight/' + c.slug : SITE + '/daily.html?autoopen=1';
  const sourceUrl = SITE + '/chapter/' + (c ? c.chapter_id : (wisdomItem.id || 1));
  /* 알림 켜기는 로그인 없이 되어야 한다. 수신 거부 링크에 들어 있는 토큰을
     그대로 떼어 쓴다. 토큰이 없으면(미리보기 등) 설정 화면으로 보낸다. */
  const unsubTok = (String(unsubUrl || '').match(/[?&]t=([0-9a-f]{32})/) || [])[1];
  const notifyUrl = unsubTok
    ? SITE + '/api/email/subscribe?t=' + unsubTok
    : SITE + '/daily.html?notify=1';
  const name = user.name || '독자';
  const proverb = (c && c.anchor_quote) || wisdomItem.title;

  /* 부별 색. 사이트의 --p1..--p9 와 같은 값이다.
     메일에서는 CSS 변수를 쓸 수 없어 직접 적어 둔다. */
  const PART_COLOR = ['#5FA97E', '#C9954A', '#5FA97E', '#5E9BC6', '#9B87C6',
                      '#E0906E', '#4FA0A0', '#D4706E', '#B08A66', '#8B95A6'];
  const tone = PART_COLOR[(c && c.part_id) || 0] || '#5FA97E';

  /* OG 카드를 머리에 올린다. 다만 카드 안에 이미 머리글과 속담이
     그려져 있으므로 바로 아래에서 그 두 줄을 다시 보여 주지 않는다.
     alt 에 속담을 넣어 이미지가 차단돼도 무슨 글인지 알 수 있게 한다.
     카드는 경로가 슬러그당 고정이고 Cache-Control 이 4시간이라,
     칼럼을 고쳐 카드를 다시 굽으면 옆 메일은 옛 카드를 불러온다.
     updated_at 을 ?v= 로 붙여 둔다(reader.html 과 같은 이유). */
  const cardVer = String((c && (c.updated_at || c.published_at)) || '').replace(/\D/g, '').slice(0, 14);
  const cardUrl = (c && c.hero_image)
    ? c.hero_image + (c.hero_image.indexOf('?') >= 0 ? '&' : '?') + 'v=' + (cardVer || '1')
    : '';

  const hero = cardUrl
    ? '<tr><td style="padding:0;line-height:0;">'
      + '<a href="' + mailEsc(webUrl) + '" style="display:block;">'
      + '<img src="' + mailEsc(cardUrl) + '" width="560" alt="' + mailEsc(proverb) + '"'
      + ' style="display:block;width:100%;max-width:560px;height:auto;border:0;'
      + 'border-radius:13px 13px 0 0;">' + '</a></td></tr>'
      + '<tr><td style="padding:0;line-height:0;font-size:0;height:3px;background:' + tone + ';"></td></tr>'
    : '';

  const kicker = c && c.part_id
    ? '제' + c.part_id + '부 ' + c.chapter_id + '장'
    : '99 Wisdom Insight';

  const btn = (label, href, primary) =>
    '<a href="' + mailEsc(href) + '" style="display:inline-block;'
    + (primary ? 'background:' + tone + ';color:#ffffff;border:1px solid ' + tone + ';'
               : 'background:#ffffff;color:#4a443d;border:1px solid #ddd8d0;')
    + 'text-decoration:none;padding:11px 20px;border-radius:999px;'
    + 'font-size:14px;font-weight:600;margin:0 6px 9px 0;">' + mailEsc(label) + '</a>';

  const body = hero
    + '<tr><td style="padding:30px 26px 8px;font-family:' + MAIL_SANS + ';">'
    + '<div style="font-family:Menlo,Consolas,monospace;font-size:11px;letter-spacing:.1em;color:' + tone + ';">'
    + mailEsc(kicker) + '</div>'
    /* 속담은 카드 안에 큰 글씨로 들어 있다. 카드가 없을 때만 글로 낸다. */
    + (hero ? '' : '<p style="margin:12px 0 0;font-family:Georgia,serif;font-size:22px;'
        + 'line-height:1.45;font-weight:700;color:#2c2722;">' + mailEsc(proverb) + '</p>')
    + (c ? '<p style="margin:' + (hero ? '10' : '14') + 'px 0 0;font-family:Georgia,serif;'
        + 'font-size:21px;line-height:1.5;color:#2c2722;font-weight:700;">' + mailEsc(c.title) + '</p>' : '')
    + (c && c.hook ? '<p style="margin:9px 0 0;font-size:14.5px;line-height:1.75;color:#7a736a;">'
        + mailEsc(c.hook) + '</p>' : '')
    + '<div style="width:34px;height:2px;background:' + tone + ';margin:22px 0 20px;"></div>'
    + (c && c.body_md ? mdToMailHtml(c.body_md) : '')
    + (c && c.action
        ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
          + ' style="margin:6px 0 4px;background:#f7f5f1;border-radius:11px;border-left:3px solid ' + tone + ';"><tr>'
          + '<td style="padding:16px 18px;font-family:' + MAIL_SANS + ';font-size:14px;line-height:1.75;color:#5c554d;">'
          + mailEsc(c.action).replace(/\n/g, '<br>') + '</td></tr></table>'
        : '')
    + '</td></tr>'
    /* 다른 독자의 기록. 칼럼과 권유 사이에 놓는다. 읽고, 남이 무엇을
       느꼈는지 보고, 그다음에 권유를 받는 순서다. 없으면 그리지 않는다. */
    + (notes && notes.items && notes.items.length
        ? '<tr><td style="padding:2px 26px 0;font-family:' + MAIL_SANS + ';">'
          + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
          + ' style="border:1px solid #ece8e2;border-radius:11px;"><tr>'
          + '<td style="padding:18px 20px;">'
          + '<div style="font-family:Menlo,Consolas,monospace;font-size:11px;letter-spacing:.1em;'
          + 'color:#9c9489;padding-bottom:4px;">'
          + (notes.sameColumn ? '이 칼럼에 남은 기록' : '다른 독자가 남긴 기록') + '</div>'
          + notes.items.map(function (nn) {
              return '<div style="padding:11px 0 0;">'
                + '<div style="font-size:12.5px;color:#a29a90;padding-bottom:3px;">'
                + mailEsc(nn.nick)
                + (nn.title ? ' · <a href="' + mailEsc(SITE + '/insight/' + encodeURIComponent(nn.slug))
                    + '" style="color:#a29a90;">' + mailEsc(nn.title) + '</a>' : '')
                + '</div>'
                + '<div style="font-size:14px;line-height:1.75;color:#5c554d;">'
                + mailEsc(nn.body) + '</div></div>';
            }).join('')
          + '</td></tr></table></td></tr>'
        : '')
    /* 알림 유도 배너. 칼럼을 다 읽은 자리에 놓는다. 권유가 글보다
       앞에 오면 광고로 읽히고, 글 뒤에 오면 이어지는 제안이 된다. */
    + (promo
        ? '<tr><td style="padding:4px 26px 0;font-family:' + MAIL_SANS + ';">'
          + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
          + ' style="background:#f7f5f1;border-radius:11px;border:1px solid #ece8e2;"><tr>'
          + '<td style="padding:22px 20px;text-align:center;">'
          + '<p style="margin:0;font-family:Georgia,serif;font-size:19px;line-height:1.5;'
          + 'font-weight:700;color:#2c2722;">매일 아침 지혜의 문장으로 시작하세요</p>'
          + '<p style="margin:10px 0 0;font-size:14px;line-height:1.75;color:#6b645c;">'
          + '이런 글을 매일 아침 한 편씩 보내 드립니다.<br>'
          + '받는 시각은 직접 고르실 수 있고, 언제든 끄실 수 있습니다.</p>'
          + '<div style="margin:18px 0 2px;"><a href="' + mailEsc(notifyUrl) + '"'
          + ' style="display:inline-block;background:' + tone + ';color:#ffffff;'
          + 'text-decoration:none;padding:12px 24px;border-radius:999px;'
          + 'font-size:14px;font-weight:600;">이메일 알림 켜기</a></div>'
          + '</td></tr></table></td></tr>'
        : '')
    + '<tr><td style="padding:18px 26px 28px;font-family:' + MAIL_SANS + ';">'
    + btn('원문 읽기', sourceUrl, true)
    + btn('웹에서 보기', webUrl, false)
    + (noteUrl ? btn('이 글에서 느낀 것 적기', noteUrl, false) : '')
    + (promo ? '' : btn('알림 설정', notifyUrl, false))
    + '</td></tr>';

  const footer = mailEsc(name) + '님께 보내 드립니다 · <a href="' + SITE + '" style="color:#a29a90;">99wisdombook.org</a><br>'
    + '<a href="' + mailEsc(notifyUrl) + '" style="color:#a29a90;text-decoration:underline;">받는 시각 바꾸기</a>'
    + ' · <a href="' + mailEsc(unsubUrl) + '" style="color:#a29a90;text-decoration:underline;">이메일 받지 않기</a>';

  const text = [
    kicker,
    proverb,
    c ? '\n' + c.title : '',
    (c && c.hook) ? c.hook : '',
    c && c.body_md ? '\n' + mdToMailText(c.body_md) : '',
    (c && c.action) ? '\n' + c.action : '',
    promo ? '\n매일 아침 지혜의 문장으로 시작하세요\n이런 글을 매일 아침 한 편씩 보내 드립니다. 받는 시각은 직접 고르실 수 있고, 언제든 끄실 수 있습니다.\n이메일 알림 켜기: ' + notifyUrl : '',
    '\n원문 읽기: ' + sourceUrl,
    '웹에서 보기: ' + webUrl,
    notes && notes.items && notes.items.length
      ? '\n' + (notes.sameColumn ? '이 칼럼에 남은 기록' : '다른 독자가 남긴 기록') + '\n'
        + notes.items.map(function (nn) {
            return (nn.title ? nn.nick + ' (' + nn.title + ')' : nn.nick) + '\n' + nn.body;
          }).join('\n\n')
      : '',
    noteUrl ? '이 글에서 느낀 것 적기: ' + noteUrl : '',
    promo ? '' : '알림 설정: ' + notifyUrl,
    '\n---\n' + name + '님께 보내 드립니다 · 99wisdombook.org',
    '이메일 받지 않기: ' + unsubUrl,
  ].filter(Boolean).join('\n');

  return {
    to: user.email,
    /* 제목은 받는상자에서 잘리기 쉬우므로 구분자를 따옴표로 대신한다.
       속담이 어디까지인지가 줄표보다 분명하고 한 글자 덜 쓴다. */
    subject: c ? '"' + proverb + '" ' + c.title : '"' + proverb + '"',
    html: emailLayout({ preheader: (c && c.hook) || (c && c.title) || proverb, body, footer }),
    text,
    unsub: unsubUrl,
  };
}

/** 안내 메일 (환영 · 테스트 · 리마인더 · 주간 리포트 공용) */
function noticeEmail(env, user, o) {
  const name = user.name || '독자';
  const body = '<tr><td style="padding:30px 26px 26px;font-family:' + MAIL_SANS + ';">'
    + '<div style="font-size:12px;letter-spacing:.08em;color:#9c9489;text-transform:uppercase;">99 Wisdom Insight</div>'
    + '<p style="margin:16px 0 0;font-size:18px;line-height:1.55;color:#2c2722;font-weight:600;">' + mailEsc(o.heading) + '</p>'
    + '<p style="margin:12px 0 0;font-size:14px;line-height:1.8;color:#6b645c;">' + o.lead + '</p>'
    + (o.cta ? '<div style="margin:26px 0 4px;"><a href="' + mailEsc(o.ctaUrl)
        + '" style="display:inline-block;background:#5FA97E;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:14px;font-weight:600;">'
        + mailEsc(o.cta) + '</a></div>' : '')
    + '</td></tr>';

  const footer = mailEsc(name) + '님께 보내 드립니다 · <a href="https://99wisdombook.org" style="color:#a29a90;">99wisdombook.org</a>'
    + (o.unsubUrl ? '<br><a href="' + mailEsc(o.unsubUrl) + '" style="color:#a29a90;text-decoration:underline;">이메일 받지 않기</a>' : '');

  const text = [
    o.heading,
    String(o.lead).replace(/<[^>]+>/g, ''),
    o.cta ? '\n' + o.cta + ': ' + o.ctaUrl : '',
    '\n---\n' + name + '님께 보내 드립니다 · 99wisdombook.org',
    o.unsubUrl ? '이메일 받지 않기: ' + o.unsubUrl : '',
  ].filter(Boolean).join('\n');

  return { to: user.email, subject: o.subject, html: emailLayout({ preheader: o.heading, body, footer }), text, unsub: o.unsubUrl };
}

/** 오늘의 문장 뉴스레터 발송 */
async function sendNewsletterEmail(env, user, wisdomItem) {
  const t = await ensureUnsubscribeToken(env, user.id);
  const unsubUrl = 'https://99wisdombook.org/api/email/unsubscribe?t=' + t;
  const col = wisdomItem && wisdomItem.column;
  const ch = (col && col.chapter_id) || 0;
  const opt = ch ? {
    notes: await notesForEmail(env, ch, user.id),
    noteUrl: 'https://99wisdombook.org/insight/' + encodeURIComponent(col.slug)
      + '?t=' + (await writeTokenFor(env, user.id)),
  } : null;
  return sendAndLog(env, issueEmail(env, user, wisdomItem, unsubUrl, opt), {
    kind: 'issue',
    user_id: user.id, user_name: user.name, user_email: user.email,
    chapter_id: (wisdomItem && wisdomItem.column && wisdomItem.column.chapter_id) || null,
  });
}
/** 수신 거부. 로그인 없이 링크만으로 동작해야 한다. */
// ── 이메일 테스트 발송 (관리자 전용) ────────────────────────
/* 발신 도메인 검증 여부를 실제로 확인하는 가장 빠른 방법이다.
   응답의 from 이 MAIL_FROM 과 다르면 폴백으로 나간 것이고,
   그건 곧 MAIL_FROM 도메인이 아직 Resend 에서 검증되지 않았다는 뜻이다. */
// ── 이메일 설정 진단 (CRON_SECRET 필요) ─────────────────────
/* Resend 에 등록된 도메인의 검증 상태와 현재 발신 설정을 함께 보여 준다.
   MAIL_FROM 의 도메인이 verified 가 아니면 실제 발송은 폴백 주소로 나간다. */
async function handleEmailDiag(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const secret = (env.CRON_SECRET || '').trim();
  if (!secret || auth !== `Bearer ${secret}`) return jsonResponse({ error: 'Unauthorized' }, 401);

  const mailFrom = (env.MAIL_FROM || '').trim() || MAIL_FROM_DEFAULT;
  const m = mailFrom.match(/<([^>]+)>/);
  const fromAddr = (m ? m[1] : mailFrom).trim();
  const fromDomain = fromAddr.split('@')[1] || null;

  const out = {
    mail_from: mailFrom,
    from_domain: fromDomain,
    mail_from_fallback: (env.MAIL_FROM_FALLBACK || '').trim() || null,
    reply_to: (env.MAIL_REPLY_TO || '').trim() || MAIL_REPLY_TO_DEFAULT,
    has_resend_key: !!env.RESEND_API_KEY,
    has_vapid: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
  };

  if (!env.RESEND_API_KEY) {
    out.verified = false;
    out.note = 'RESEND_API_KEY 가 없어 발송 자체가 불가능합니다.';
    return jsonResponse(out);
  }

  try {
    const r = await fetch('https://api.resend.com/domains', {
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}` },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      out.error = d.message || `Resend ${r.status}`;
      return jsonResponse(out, 200);
    }
    const list = d.data || [];
    out.domains = list.map(x => ({ name: x.name, status: x.status, region: x.region }));
    const hit = list.find(x => x.name === fromDomain);
    out.verified = !!(hit && hit.status === 'verified');
    out.note = out.verified
      ? `${fromDomain} 검증 완료 — MAIL_FROM 그대로 발송됩니다.`
      : hit
        ? `${fromDomain} 상태가 ${hit.status} 입니다. 검증이 끝나야 MAIL_FROM 으로 발송됩니다.`
        : `${fromDomain} 이 Resend 에 등록돼 있지 않습니다. 도메인을 추가하고 DNS 레코드를 넣어 주세요.`;
  } catch (err) {
    out.error = err.message;
  }

  // ?send=주소 → 실제로 한 통 보내 발송 경로까지 확인한다
  // ?kind=issue 를 붙이면 안내문이 아니라 진짜 Daily Wisdom 한 통을 보낸다
  const sendTo = new URL(request.url).searchParams.get('send');
  const sendKind = new URL(request.url).searchParams.get('kind') || 'notice';
  if (sendTo && sendKind === 'issue') {
    try {
      const col = await env.DB.prepare(
        "SELECT chapter_id, part_id, slug, title, hook, anchor_quote, body_md, action, quotable, hero_image, updated_at, published_at"
        + " FROM insights WHERE status = 'published' ORDER BY RANDOM() LIMIT 1"
      ).first();
      const item = { title: (col && col.anchor_quote) || '오늘의 한 문장', id: col ? col.chapter_id : null, column: col || null };
      const unsub = 'https://99wisdombook.org/api/email/unsubscribe?t=' + '0'.repeat(32);
      const r = await sendAndLog(env, issueEmail(env, { id: 0, name: '독자', email: sendTo }, item, unsub),
        { kind: 'diag_sample', user_email: sendTo, chapter_id: col ? col.chapter_id : null });
      out.send = { ok: true, kind: 'issue', to: sendTo, chapter_id: col ? col.chapter_id : null,
                   id: r.id || null, from: r.from, used_fallback: !!mailVia(env, r) };
    } catch (err) {
      out.send = { ok: false, kind: 'issue', to: sendTo, error: err.message, code: err.code || null };
    }
    return jsonResponse(out);
  }
  if (sendTo) {
    try {
      const r = await sendAndLog(env, noticeEmail(env, { name: '관리자', email: sendTo }, {
        subject: '[점검] 99 Wisdom Insight 이메일 발송 확인',
        heading: '이메일 발송 경로가 정상입니다',
        lead: '이 메일이 보이면 Resend 연동·발신 도메인·템플릿이 모두 동작하는 것입니다.<br>실제 알림은 설정한 요일과 시각에 발송됩니다.',
        cta: '오늘의 문장 보기', ctaUrl: 'https://99wisdombook.org/daily.html?autoopen=1',
      }), { kind: 'diag_check', user_email: sendTo });
      out.send = { ok: true, to: sendTo, id: r.id || null, from: r.from, used_fallback: !!mailVia(env, r) };
    } catch (err) {
      out.send = { ok: false, to: sendTo, error: err.message, code: err.code || null };
    }
  }
  return jsonResponse(out);
}

// ── 알림 대상 현황 (CRON_SECRET 필요) ───────────────────────
async function handleNotifyStatus(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const secret = (env.CRON_SECRET || '').trim();
  if (!secret || auth !== `Bearer ${secret}`) return jsonResponse({ error: 'Unauthorized' }, 401);
  await ensureEmailColumns(env);
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN notify_enabled = 1 THEN 1 ELSE 0 END) AS notify_on,
           SUM(CASE WHEN notify_enabled = 1 AND email_enabled = 1 AND email IS NOT NULL AND email <> '' THEN 1 ELSE 0 END) AS email_ready,
           SUM(CASE WHEN notify_enabled = 1 AND push_endpoint IS NOT NULL THEN 1 ELSE 0 END) AS push_ready,
           SUM(CASE WHEN email_enabled = 1 AND (email IS NULL OR email = '') THEN 1 ELSE 0 END) AS email_on_without_address
    FROM users
  `).first();
  return jsonResponse({ success: true, ...row });
}

async function handleEmailTest(request, env) {
  const userId = await getUserIdFromToken(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const me = await env.DB.prepare('SELECT id, name, email, role FROM users WHERE id = ?').bind(userId).first();
  if (!me || me.role !== 'admin') return jsonResponse({ error: 'Forbidden' }, 403);

  const body = await request.json().catch(() => ({}));
  const to = String(body.to || me.email || '').trim();
  if (!to) return jsonResponse({ success: false, error: '보낼 주소가 없습니다. 관리자 계정에 이메일을 등록하거나 to 를 지정하세요.' }, 400);

  await ensureEmailColumns(env);
  const t = await ensureUnsubscribeToken(env, me.id);
  const unsubUrl = `https://99wisdombook.org/api/email/unsubscribe?t=${t}`;

  /* kind=issue 면 안내문이 아니라 진짜 Daily Wisdom 한 통을 보낸다.
     안내문만 보내서는 정작 독자가 받는 메일이 어떤지 확인할 수 없다. */
  if (String(body.kind || '') === 'issue') {
    try {
      const col = body.chapter_id
        ? await env.DB.prepare(
            "SELECT chapter_id, part_id, slug, title, hook, anchor_quote, body_md, action, quotable, hero_image, updated_at, published_at"
            + " FROM insights WHERE status = 'published' AND chapter_id = ?").bind(body.chapter_id).first()
        : await env.DB.prepare(
            "SELECT chapter_id, part_id, slug, title, hook, anchor_quote, body_md, action, quotable, hero_image, updated_at, published_at"
            + " FROM insights WHERE status = 'published' ORDER BY RANDOM() LIMIT 1").first();
      if (!col) return jsonResponse({ success: false, error: '발행된 칼럼이 없습니다.' }, 404);
      const item = { title: col.anchor_quote, id: col.chapter_id, column: col };
      const r = await sendAndLog(env, issueEmail(env, { id: me.id, name: me.name, email: to }, item, unsubUrl),
        { kind: 'admin_sample', user_id: me.id, user_name: me.name, user_email: to, chapter_id: col.chapter_id });
      const want0 = (env.MAIL_FROM || '').trim() || MAIL_FROM_DEFAULT;
      return jsonResponse({
        success: true, kind: 'issue', to, chapter_id: col.chapter_id, id: r.id || null,
        from: r.from, verified: r.from === want0,
        note: r.from === want0 ? `${col.chapter_id}장 칼럼을 보냈습니다.`
                               : `발신 도메인이 검증되지 않아 ${r.from} 로 대체 발송했습니다.`,
      });
    } catch (err) {
      return jsonResponse({ success: false, error: err.message, code: err.code || null }, 500);
    }
  }

  try {
    const r = await sendAndLog(env, noticeEmail(env, { name: me.name, email: to }, {
      subject: '[테스트] 99 Wisdom Insight 이메일 발송 확인',
      heading: '이메일 발송이 정상입니다',
      lead: '이 메일이 보이면 Resend 연동과 템플릿이 모두 동작하는 것입니다.<br>실제 알림은 설정한 요일과 시각에 발송됩니다.',
      cta: '오늘의 문장 보기', ctaUrl: 'https://99wisdombook.org/daily.html?autoopen=1',
      unsubUrl,
    }), { kind: 'admin_test', user_id: me.id, user_name: me.name, user_email: to });
    const want = (env.MAIL_FROM || '').trim() || MAIL_FROM_DEFAULT;
    return jsonResponse({
      success: true, to, id: r.id || null, from: r.from,
      verified: r.from === want,
      note: r.from === want
        ? '설정한 발신 주소로 나갔습니다.'
        : `발신 도메인이 아직 검증되지 않아 ${r.from} 로 대체 발송했습니다. Resend 에서 도메인을 검증해 주세요.`,
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message, code: err.code || null }, 500);
  }
}

// ── 메일 템플릿 미리보기 (관리자 전용) ──────────────────────
/* /api/email/preview?kind=issue|notice  ·  ?text=1 이면 평문 버전 */
async function handleEmailPreview(request, env) {
  const userId = await getUserIdFromToken(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  const me = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first();
  if (!me || me.role !== 'admin') return jsonResponse({ error: 'Forbidden' }, 403);

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') || 'issue';
  const user = { id: 0, name: '독자', email: 'you@example.com' };
  const unsubUrl = 'https://99wisdombook.org/api/email/unsubscribe?t=' + '0'.repeat(32);

  let column = null;
  try {
    const row = await env.DB.prepare(
      "SELECT chapter_id, part_id, slug, title, hook, anchor_quote, body_md, action, quotable, hero_image, updated_at, published_at FROM insights WHERE status = 'published' ORDER BY chapter_id LIMIT 1"
    ).first();
    if (row) column = row;
  } catch (_) {}

  const m = kind === 'notice'
    ? noticeEmail(env, user, {
        subject: '[미리보기] 안내 메일',
        heading: '안내 메일 미리보기',
        lead: '리마인더·주간 리포트·테스트 메일이 이 형태를 씁니다.',
        cta: '오늘의 문장 보기', ctaUrl: 'https://99wisdombook.org/daily.html?autoopen=1',
        unsubUrl,
      })
    : issueEmail(env, user, { title: column ? '오늘의 한 문장 미리보기' : '세상에 공짜는 없다', column }, unsubUrl);

  if (url.searchParams.get('text')) {
    return new Response(m.text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders } });
  }
  return new Response(m.html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Subject': encodeURIComponent(m.subject), ...corsHeaders },
  });
}

/** 이름을 익명 표기로 바꾼다. 홍길동 → 홍**, 김수 → 김*, 비한글·한 글자는 독자. */
function maskName(name) {
  const n = String(name || '').trim();
  if (!n || n.length < 2 || !/[가-힣]/.test(n[0])) return '독자';
  return n[0] + '*'.repeat(Math.min(n.length - 1, 3));
}

/* ── 로그인 없이 이메일 알림 켜기 ────────────────────────────

   왜 필요한가. 끄는 것은 메일 바닥의 링크 한 번으로 되는데, 켜는 것은
   로그인이 필요했다. 게다가 이 사이트에는 비밀번호 재설정 메일이 없어
   비밀번호를 잊은 회원에게는 켤 방법이 아예 없었다. 2026-09-29 에
   19명에게 알림 설정을 권하는 메일을 보냈고 전환은 0명이었다. 무관심이
   아니라 길이 막혀 있었다.

   토큰은 수신 거부에 쓰는 것을 그대로 쓴다. 이미 모든 메일에 들어가
   있고, 유출됐을 때의 피해가 켜기와 끄기에서 같다. 되돌릴 수 있고 남의
   정보가 드러나지 않는다. 그래서 새 컬럼도 새 비밀도 두지 않는다.

   ⚠ 켜기를 GET 으로 하지 않는 이유. 메일 클라이언트와 보안 스캐너가
   링크를 미리 긁어 간다. GET 에서 바로 켜면 누르지도 않은 사람의 설정이
   켜진다. 그래서 GET 은 화면만 주고 변경은 POST 로만 한다. 화면이 열리면
   자바스크립트가 곧바로 POST 하므로 사람에게는 클릭 한 번이다. */

const SUB_DEFAULT_HOUR = 8; // 아침 8시 (KST). 기존 수신자와 같은 시각.

function subPage(inner) {
  return new Response(
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>이메일 알림 · 99 Wisdom Insight</title></head>'
    + '<body style="margin:0;background:#faf9f7;">'
    + '<div style="font-family:-apple-system,\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif;'
    + 'max-width:430px;margin:12vh auto;padding:0 20px;color:#2c2722;text-align:center;">'
    + '<div style="font-size:12px;letter-spacing:.08em;color:#9c9489;">99 WISDOM INSIGHT</div>'
    + inner
    + '<p style="margin:30px 0 0;font-size:13px;"><a href="https://99wisdombook.org" style="color:#a29a90;">사이트로 가기</a></p>'
    + '</div></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders } }
  );
}

/* ── 비밀번호 재설정 ─────────────────────────────────────────

   이 사이트에는 재설정 경로가 없었다. 로그인 화면의 "비밀번호를
   잊으셨나요?"는 관리자에게 문의하라는 알림창이었고, 관리자가 임시
   비밀번호를 발급하는 길밖에 없었다. 19명 중 18명이 아직 구버전 해시인
   것은 그 계정들이 PBKDF2 전환 이후 한 번도 로그인하지 않았다는 뜻이다.

   토큰을 어디에 두는가가 문제였다. 새 테이블은 스키마 변경이고, 세션
   테이블에 끼워 넣으면 그 행이 유효한 세션으로도 동작해 버린다.
   그래서 저장하지 않는다.

   서명 키로 그 사용자의 현재 비밀번호 해시를 쓴다. 해시는 서버에만
   있으므로 밖에서는 토큰을 만들 수 없고, 비밀번호가 바뀌면 키가 바뀌어
   토큰이 저절로 죽는다. 한 번만 쓰이는 성질이 공짜로 따라온다.
   새 테이블도 새 시크릿도 필요하지 않다.

   형식: <user_id>.<만료 유닉스초>.<서명 43자>  */

/* ── 독자의 기록 ─────────────────────────────────────────────

   이메일로 칼럼을 받은 사람이 소감을 적으면 칼럼 아래에 남는다.
   보이는 이름은 본인이 정한 별명이고, 정하지 않았으면 '독자'다.
   실명은 어느 쪽으로도 나가지 않는다(관리자 화면에만 함께 보인다).

   ⚠ saved_wisdom.memo 를 쓰지 않는다. 그 칸에는 공감지혜에서 본인만
   보도록 적은 메모가 이미 들어 있다(13건). 거기에 공개 기능을 얹으면
   사후 공개가 된다. 사적인 메모와 공개 글을 한 칸에 섞으면 앞으로 어느
   코드가 어느 쪽을 읽는지 매번 확인해야 하고, 사고는 한 번으로 끝나지
   않는다. 그래서 테이블을 따로 둔다.

   로그인 없이 써야 하므로 메일 링크에 토큰을 싣는다. 자세한 것은
   위의 '독자 토큰' 주석에 있다. 요약하면 공개되는 글에는 60일짜리
   쓰기 토큰을 쓰고, 그 토큰은 편에 묶지 않는다 — 메일로 받은 칼럼
   말고 다른 칼럼을 읽다가 쓰고 싶을 때 막히면 안 된다.

   만료되면 그냥 막지 말고 다시 받는 곳을 함께 알려 준다. 60일 뒤에
   그 메일을 찾아내라고 하는 것은 길을 끊는 것과 같다. */

/* 메일에 실을 다른 독자의 기록.

   이 칼럼에 남은 기록을 먼저 찾고, 없으면 다른 칼럼의 최근 기록을
   가져온다. 처음 보내는 칼럼에는 기록이 있을 수 없으니, 같은 칼럼만
   보면 이 영역은 영원히 비어 있다. 그러면 순환이 시작되지 않는다.

   본인 글은 뺀다. 자기가 쓴 것을 "다른 독자의 기록"으로 받으면 이상하다. */
async function notesForEmail(env, chapterId, excludeUserId, limit) {
  const n = limit || 2;
  const ex = excludeUserId || 0;
  try {
    await ensureInsightNotesTable(env);

    const same = await env.DB.prepare(
      'SELECT nt.body, u.nickname FROM insight_notes nt JOIN users u ON u.id = nt.user_id'
      + " WHERE nt.chapter_id = ? AND nt.status = 'visible' AND nt.user_id <> ?"
      + ' ORDER BY nt.id DESC LIMIT ?'
    ).bind(chapterId, ex, n).all();

    if ((same.results || []).length)
      return {
        sameColumn: true,
        items: same.results.map((x) => ({ nick: displayNick(x), body: x.body })),
      };

    const other = await env.DB.prepare(
      'SELECT nt.body, nt.chapter_id, u.nickname, i.title, i.slug'
      + ' FROM insight_notes nt JOIN users u ON u.id = nt.user_id'
      + ' JOIN insights i ON i.chapter_id = nt.chapter_id'
      + " WHERE nt.status = 'visible' AND nt.user_id <> ? AND nt.chapter_id <> ?"
      + ' ORDER BY nt.id DESC LIMIT ?'
    ).bind(ex, chapterId, n).all();

    return {
      sameColumn: false,
      items: (other.results || []).map((x) => ({
        nick: displayNick(x), body: x.body,
        title: x.title, slug: x.slug, chapter_id: x.chapter_id,
      })),
    };
  } catch (_) {
    return { sameColumn: false, items: [] };
  }
}

/* ── 독자 토큰 ───────────────────────────────────────────────

   독자 쪽에는 로그인이 없다. 비밀번호도 세션도 받지 않고, 메일에 실어
   보낸 링크의 토큰으로 누구인지 확인한다. 자매 사이트와 같은 방식이다.

   토큰은 두 가지다.
     설정 토큰  unsubscribe_token 그 자체. 만료 없음. 알림 켜기·끄기,
                받는 시각, 보관함처럼 본인만 보는 일에 쓴다.
     쓰기 토큰  <user_id>.<만료 유닉스초>.<서명>. 60일.
                공개되는 글(인사이트)에 쓴다.

   왜 나누는가. 설정 링크는 메일 바닥에 늘 들어가고 만료가 없다. 그것
   하나로 공개 글쓰기까지 열어 주면, 오래된 메일 한 통이 영구 글쓰기
   권한이 된다. 공개되는 쪽에는 기한을 두는 편이 맞다.

   서명 키는 그 사람의 설정 토큰이다. 서버에만 있는 값이라 밖에서는
   쓰기 토큰을 만들 수 없고, 새 시크릿을 두지 않아도 된다.

   편(칼럼)은 묶지 않는다. 메일로 받은 칼럼 말고 다른 칼럼을 읽다가
   쓰고 싶을 때 막히면 안 된다. */

const WRITE_TOKEN_DAYS = 60;
const NICK_MIN = 2, NICK_MAX = 16;

async function writeTokenFor(env, userId) {
  const key = await ensureUnsubscribeToken(env, userId);
  const exp = Math.floor(Date.now() / 1000) + WRITE_TOKEN_DAYS * 86400;
  const enc = new TextEncoder();
  const sig = await hmacSha256(enc.encode(key), enc.encode('w:' + userId + '.' + exp));
  return userId + '.' + exp + '.' + b64uEncode(sig);
}

/** 쓰기 토큰 → 사용자 행. 만료·위조는 null. */
async function readWriteToken(env, t) {
  const m = String(t || '').match(/^(\d+)\.(\d+)\.([A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const exp = parseInt(m[2], 10);
  if (!(exp > Math.floor(Date.now() / 1000))) return null;
  const userId = parseInt(m[1], 10);

  const row = await env.DB.prepare(
    'SELECT id, name, nickname, unsubscribe_token FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!row || !row.unsubscribe_token) return null;

  const enc = new TextEncoder();
  const sig = await hmacSha256(enc.encode(row.unsubscribe_token), enc.encode('w:' + userId + '.' + exp));
  return timingSafeEqual(b64uEncode(sig), m[3]) ? row : null;
}

/** 설정 토큰(=unsubscribe_token) → 사용자 행. */
async function readSettingsToken(env, t) {
  if (!/^[0-9a-f]{32}$/.test(String(t || ''))) return null;
  return await env.DB.prepare(
    'SELECT id, name, nickname, email, email_enabled, notify_enabled, notify_hour FROM users WHERE unsubscribe_token = ?'
  ).bind(t).first();
}

/* 독자를 확정한다. 쓰기 토큰 → 설정 토큰 순으로 본다.
   세션은 보지 않는다. 독자 쪽에 세션이 없다. */
async function reader(env, body, url) {
  const w = (body && body.t) || (url && url.searchParams.get('t')) || '';
  const byWrite = await readWriteToken(env, w);
  if (byWrite) return byWrite;
  return await readSettingsToken(env, w);
}

/* 본인만 보는 일(보관함·알림 설정·스트릭)에서 쓰는 신분 확인.

   순서가 중요하다. 먼저 독자 토큰을 보고, 없을 때만 세션을 본다.
   관리자는 세션이 남아 있으므로 관리자 화면은 그대로 동작한다.

   Authorization: Bearer 로 설정 토큰(32자 16진수)을 보내는 것도 받는다.
   메일 링크로 들어온 화면이 매 요청에 ?t= 를 붙이는 대신 헤더로 넘길 수
   있어야 기존 fetch 코드를 그대로 쓸 수 있다. */
async function readerId(request, env, body) {
  const url = new URL(request.url);
  const byToken = await reader(env, body, url);
  if (byToken) return byToken.id;

  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    const byHeader = (await readWriteToken(env, t)) || (await readSettingsToken(env, t));
    if (byHeader) return byHeader.id;
  }

  return await getUserIdFromToken(request, env);
}

/** 표시 이름. 별명이 없으면 '독자'. 실명은 쓰지 않는다. */
function displayNick(row) {
  const n = String((row && row.nickname) || '').trim();
  return n || '독자';
}

function cleanNick(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) return { v: null };
  if (s.length < NICK_MIN) return { err: `별명은 ${NICK_MIN}자 이상이어야 합니다.` };
  if (s.length > NICK_MAX) return { err: `별명은 ${NICK_MAX}자까지 쓸 수 있습니다.` };
  if (/https?:\/\/|www\.|\.[a-z]{2,}\//i.test(s)) return { err: '별명에 주소는 넣을 수 없습니다.' };
  return { v: s };
}

const NOTE_MIN_LEN = 30;   // 한 문장으로는 기록이 되지 않는다
const NOTE_MAX_LEN = 300;
const NOTE_SHOW_LIMIT = 20;

async function ensureInsightNotesTable(env) {
  try {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS insight_notes ('
      + ' id INTEGER PRIMARY KEY AUTOINCREMENT,'
      + ' chapter_id INTEGER NOT NULL,'
      + ' user_id INTEGER NOT NULL,'
      + " body TEXT NOT NULL,"
      + " status TEXT DEFAULT 'visible',"
      + ' created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,'
      + ' updated_at TIMESTAMP,'
      + ' UNIQUE(user_id, chapter_id))'
    ).run();
  } catch (_) {}
  try {
    await env.DB.prepare(
      'CREATE INDEX IF NOT EXISTS idx_insight_notes_ch ON insight_notes(chapter_id, status, id DESC)'
    ).run();
  } catch (_) {}
}

/* 기록을 쓰는 사람을 확정한다. 쓰기 토큰이 우선이고, 설정 페이지를 거쳐
   온 사람은 설정 토큰으로도 쓸 수 있다. 세션은 보지 않는다. */
async function noteWho(env, request, body) {
  return await reader(env, body, new URL(request.url));
}

/* ── 독자의 기록 · 관리자 ────────────────────────────────────

   공개 목록과 달리 숨긴 것까지 보여 주고 실명도 함께 준다.
   독자에게 약속한 익명은 다른 독자에 대한 것이고, 운영자는 같은 글을
   반복해 쓰는 사람을 알아볼 수 있어야 검수가 된다.

   지우는 것보다 숨기는 것을 기본으로 둔다. 지우면 왜 지웠는지 남지
   않고, 같은 사람이 다시 쓸 때 전에 무슨 일이 있었는지 알 수 없다. */
async function handleAdminListNotes(request, env) {
  if (!await verifyAdminStrict(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  await ensureInsightNotesTable(env);

  const url = new URL(request.url);
  const only = url.searchParams.get('status') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 200, 500);

  let sql = 'SELECT nt.id, nt.chapter_id, nt.user_id, nt.body, nt.status,'
    + ' nt.created_at, nt.updated_at, u.name, u.nickname, u.email, i.title, i.slug'
    + ' FROM insight_notes nt'
    + ' LEFT JOIN users u ON u.id = nt.user_id'
    + ' LEFT JOIN insights i ON i.chapter_id = nt.chapter_id';
  const bind = [];
  if (only === 'visible' || only === 'hidden') { sql += ' WHERE nt.status = ?'; bind.push(only); }
  sql += ' ORDER BY nt.id DESC LIMIT ?';
  bind.push(limit);

  try {
    const r = await env.DB.prepare(sql).bind(...bind).all();
    const rows = r.results || [];
    const sum = await env.DB.prepare(
      "SELECT COUNT(*) AS total,"
      + " SUM(CASE WHEN status = 'visible' THEN 1 ELSE 0 END) AS visible,"
      + " SUM(CASE WHEN status = 'hidden' THEN 1 ELSE 0 END) AS hidden,"
      + ' COUNT(DISTINCT user_id) AS writers,'
      + ' MAX(created_at) AS last_at'
      + ' FROM insight_notes'
    ).first();
    return jsonResponse({
      success: true,
      summary: sum || {},
      notes: rows.map((x) => ({ ...x, nick: displayNick(x) })),
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

async function handleAdminSetNoteStatus(id, request, env) {
  if (!await verifyAdminStrict(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  await ensureInsightNotesTable(env);

  const b = await request.json().catch(() => ({}));
  const status = b.status === 'hidden' ? 'hidden' : 'visible';
  try {
    const cur = await env.DB.prepare('SELECT id FROM insight_notes WHERE id = ?').bind(id).first();
    if (!cur) return jsonResponse({ success: false, error: '없는 기록입니다.' }, 404);
    await env.DB.prepare("UPDATE insight_notes SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(status, id).run();
    return jsonResponse({ success: true, id: parseInt(id, 10), status });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

async function handleAdminDeleteNote(id, request, env) {
  if (!await verifyAdminStrict(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  await ensureInsightNotesTable(env);
  try {
    await env.DB.prepare('DELETE FROM insight_notes WHERE id = ?').bind(id).run();
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

/* 글 화면이 "내가 이 칼럼에 쓴 것"과 내 별명을 미리 채우려고 부른다. */
/* 모아 보기. 한 칼럼 아래에서만 보이면 기록은 서로 닿지 않는다.

   남이 무엇을 적었는지 보이는 자리가 있어야 쓰는 쪽도 는다. 메일에는
   이미 한두 개씩 싣고 있는데, 사이트에는 그 자리가 없었다. */
async function handleRecentNotes(request, env) {
  await ensureEmailColumns(env);
  await ensureInsightNotesTable(env);

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 50, 100);

  try {
    const r = await env.DB.prepare(
      'SELECT nt.chapter_id, nt.body, nt.created_at, u.nickname, i.title, i.slug'
      + ' FROM insight_notes nt'
      + ' LEFT JOIN users u ON u.id = nt.user_id'
      + ' LEFT JOIN insights i ON i.chapter_id = nt.chapter_id'
      + " WHERE nt.status = 'visible'"
      + ' ORDER BY nt.id DESC LIMIT ?'
    ).bind(limit).all();

    const rows = r.results || [];
    const total = await env.DB.prepare(
      "SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS writers FROM insight_notes WHERE status = 'visible'"
    ).first();

    return jsonResponse({
      success: true,
      count: (total && total.n) || 0,
      writers: (total && total.writers) || 0,
      notes: rows.map((x) => ({
        nick: displayNick(x), body: x.body, created_at: x.created_at,
        chapter_id: x.chapter_id, title: x.title || null, slug: x.slug || null,
      })),
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

async function handleMyNote(chapterId, request, env) {
  await ensureEmailColumns(env);
  await ensureInsightNotesTable(env);
  const url = new URL(request.url);
  const who = await reader(env, null, url);
  if (!who) return jsonResponse({ success: true, canWrite: false });

  const ch = parseInt(chapterId, 10);
  let mineRow = null;
  try {
    mineRow = await env.DB.prepare(
      "SELECT body FROM insight_notes WHERE chapter_id = ? AND user_id = ? AND status = 'visible'"
    ).bind(ch, who.id).first();
  } catch (_) {}

  return jsonResponse({
    success: true, canWrite: true,
    nick: (who.nickname || '').trim() || null,
    body: (mineRow && mineRow.body) || null,
  });
}

async function handleListNotes(chapterId, request, env) {
  await ensureInsightNotesTable(env);
  const ch = parseInt(chapterId, 10);
  try {
    const r = await env.DB.prepare(
      'SELECT n.body, n.created_at, u.nickname FROM insight_notes n'
      + ' JOIN users u ON u.id = n.user_id'
      + " WHERE n.chapter_id = ? AND n.status = 'visible'"
      + ' ORDER BY n.id DESC LIMIT ?'
    ).bind(ch, NOTE_SHOW_LIMIT).all();
    const rows = r.results || [];

    const c = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM insight_notes WHERE chapter_id = ? AND status = 'visible'"
    ).bind(ch).first();

    /* 이름은 서버에서 가린다. 원래 이름을 내려보내지 않는다. */
    return jsonResponse({
      success: true,
      count: (c && c.n) || 0,
      notes: rows.map((x) => ({
        nick: displayNick(x),
        body: x.body,
        created_at: x.created_at,
      })),
    });
  } catch (err) {
    return jsonResponse({ success: true, count: 0, notes: [] });
  }
}

async function handleSaveNote(chapterId, request, env) {
  await ensureEmailColumns(env);
  await ensureInsightNotesTable(env);
  const ch = parseInt(chapterId, 10);
  const b = await request.json().catch(() => ({}));

  const who = await noteWho(env, request, b);
  /* 만료됐다고만 말하면 막다른 길이다. 쓰기 토큰은 60일이고, 그때쯤이면
     메일을 찾기도 어렵다. 다시 받는 곳을 함께 준다. */
  if (!who)
    return jsonResponse({
      success: false,
      expired: true,
      error: '쓰기 링크가 만료됐습니다. 메일로 새 링크를 받으시면 이어서 쓰실 수 있습니다.',
      start: '/api/email/start',
    }, 401);

  const body = String(b.body || '').trim();
  if (!body) return jsonResponse({ success: false, error: '내용을 적어 주세요.' }, 400);
  if (body.length < NOTE_MIN_LEN)
    return jsonResponse({
      success: false,
      error: `${NOTE_MIN_LEN}자 이상 적어 주세요. 지금 ${body.length}자입니다.`,
    }, 400);
  if (body.length > NOTE_MAX_LEN)
    return jsonResponse({ success: false, error: NOTE_MAX_LEN + '자까지 적을 수 있습니다.' }, 400);
  /* 링크는 받지 않는다. 광고가 들어오는 가장 짧은 길이다. */
  if (/https?:\/\/|www\./i.test(body))
    return jsonResponse({ success: false, error: '링크는 넣을 수 없습니다.' }, 400);

  /* 별명은 처음 쓸 때만 받는다. 이미 있으면 보낸 값이 있을 때만 바꾼다.
     정하지 않아도 쓸 수 있고, 그때는 '독자'로 표시된다. */
  let nick = (who.nickname || '').trim() || null;
  if (b.nickname != null && String(b.nickname).trim() !== '') {
    const c = cleanNick(b.nickname);
    if (c.err) return jsonResponse({ success: false, error: c.err }, 400);
    nick = c.v;
    await env.DB.prepare('UPDATE users SET nickname = ? WHERE id = ?').bind(nick, who.id).run();
  }

  const col = await env.DB.prepare(
    "SELECT chapter_id FROM insights WHERE chapter_id = ? AND status = 'published'"
  ).bind(ch).first();
  if (!col) return jsonResponse({ success: false, error: '없는 칼럼입니다.' }, 404);

  try {
    await env.DB.prepare(
      'INSERT INTO insight_notes (chapter_id, user_id, body) VALUES (?, ?, ?)'
      + ' ON CONFLICT(user_id, chapter_id) DO UPDATE SET'
      + " body = excluded.body, updated_at = datetime('now')"
    ).bind(ch, who.id, body).run();
    return jsonResponse({ success: true, nick: nick || '독자', body });
  } catch (err) {
    return jsonResponse({ success: false, error: '저장하지 못했습니다.' }, 500);
  }
}

async function handleDeleteNote(chapterId, request, env) {
  await ensureInsightNotesTable(env);
  const ch = parseInt(chapterId, 10);
  const b = await request.json().catch(() => ({}));

  const who = await noteWho(env, request, b);
  if (!who) return jsonResponse({ success: false, error: '권한을 확인하지 못했습니다.' }, 401);

  try {
    await env.DB.prepare('DELETE FROM insight_notes WHERE user_id = ? AND chapter_id = ?')
      .bind(who.id, ch).run();
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: '지우지 못했습니다.' }, 500);
  }
}

const RESET_TTL_SEC = 3600;       // 1시간
const RESET_MAX_PER_HOUR = 3;     // 같은 계정에 보낼 수 있는 횟수

async function resetSign(userId, exp, pwHash) {
  const enc = new TextEncoder();
  const sig = await hmacSha256(enc.encode(String(pwHash)), enc.encode('pwreset:' + userId + '.' + exp));
  return b64uEncode(sig);
}

async function resetMakeToken(env, userId, pwHash) {
  const exp = Math.floor(Date.now() / 1000) + RESET_TTL_SEC;
  return userId + '.' + exp + '.' + (await resetSign(userId, exp, pwHash));
}

/** 토큰을 검증하고 사용자 행을 돌려준다. 실패하면 null. */
async function resetVerify(env, token) {
  const m = String(token || '').match(/^(\d+)\.(\d+)\.([A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const userId = parseInt(m[1], 10);
  const exp = parseInt(m[2], 10);
  if (!(exp > Math.floor(Date.now() / 1000))) return null;

  const row = await env.DB.prepare('SELECT id, name, email, password FROM users WHERE id = ?')
    .bind(userId).first();
  if (!row || !row.password) return null;

  const want = await resetSign(userId, exp, row.password);
  return timingSafeEqual(want, m[3]) ? row : null;
}

function authPage(inner) {
  return new Response(
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>비밀번호 · 99 Wisdom Insight</title></head>'
    + '<body style="margin:0;background:#faf9f7;">'
    + '<div style="font-family:-apple-system,\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif;'
    + 'max-width:430px;margin:11vh auto;padding:0 20px;color:#2c2722;">'
    + '<div style="font-size:12px;letter-spacing:.08em;color:#9c9489;text-align:center;">99 WISDOM INSIGHT</div>'
    + inner
    + '<p style="margin:28px 0 0;font-size:13px;text-align:center;">'
    + '<a href="https://99wisdombook.org/daily.html" style="color:#a29a90;">로그인 화면으로</a></p>'
    + '</div></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders } }
  );
}

const AUTH_INPUT = 'width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #ddd8d0;'
  + 'border-radius:10px;font-size:15px;color:#2c2722;background:#fff;';
const AUTH_BTN = 'width:100%;box-sizing:border-box;background:#5FA97E;color:#fff;border:0;'
  + 'border-radius:999px;padding:13px;font-size:15px;font-weight:600;cursor:pointer;margin-top:14px;';

async function handleForgotPage(request, env) {
  return authPage(
    '<p style="margin:16px 0 6px;font-size:18px;font-weight:600;text-align:center;">비밀번호 재설정</p>'
    + '<p style="margin:0 0 20px;font-size:14px;line-height:1.75;color:#7a736a;text-align:center;">'
    + '가입하신 이메일 주소를 적어 주세요.<br>재설정 링크를 보내 드립니다.</p>'
    + '<form id="f">'
    + '<input id="e" type="email" required placeholder="이메일 주소" autocomplete="email" style="' + AUTH_INPUT + '">'
    + '<button type="submit" style="' + AUTH_BTN + '">재설정 링크 받기</button>'
    + '</form>'
    + '<p id="m" style="margin:16px 0 0;font-size:14px;line-height:1.75;color:#5c554d;text-align:center;"></p>'
    + '<script>document.getElementById("f").onsubmit=function(ev){ev.preventDefault();'
    + 'var b=ev.target.querySelector("button");b.disabled=true;b.textContent="보내는 중…";'
    + 'fetch("/api/auth/forgot",{method:"POST",headers:{"Content-Type":"application/json"},'
    + 'body:JSON.stringify({email:document.getElementById("e").value})})'
    + '.then(function(r){return r.json()}).then(function(){'
    + 'document.getElementById("f").style.display="none";'
    + 'document.getElementById("m").innerHTML="메일을 보냈습니다.<br>받은편지함을 확인해 주세요. 링크는 1시간 동안 쓸 수 있습니다.";'
    + '}).catch(function(){b.disabled=false;b.textContent="재설정 링크 받기";'
    + 'document.getElementById("m").textContent="잠시 후 다시 시도해 주세요.";});};</script>'
  );
}

async function handleForgotRequest(request, env) {
  const b = await request.json().catch(() => ({}));
  const email = String(b.email || '').trim();

  /* 응답은 언제나 같다. 가입 여부를 알려 주지 않는다. */
  const ok = () => jsonResponse({ success: true });
  if (!email) return ok();

  try {
    const row = await env.DB.prepare(
      'SELECT id, name, email, password FROM users WHERE email = ?'
    ).bind(email).first();
    if (!row || !row.password) return ok();

    /* 같은 계정으로 메일이 쏟아지지 않게 막는다. 발송 기록을 그대로 쓴다. */
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM send_logs WHERE kind = 'password_reset' AND user_id = ?"
      + " AND sent_at > datetime('now', '-1 hours')"
    ).bind(row.id).first();
    if (recent && recent.n >= RESET_MAX_PER_HOUR) return ok();

    const token = await resetMakeToken(env, row.id, row.password);
    const url = 'https://99wisdombook.org/api/auth/reset?t=' + encodeURIComponent(token);

    await sendAndLog(env, noticeEmail(env, row, {
      subject: '비밀번호 재설정 · 99 Wisdom Insight',
      heading: '비밀번호를 새로 정하실 수 있습니다',
      lead: '아래 버튼을 누르면 새 비밀번호를 정하는 화면으로 갑니다.<br>'
        + '이 링크는 1시간 동안만 쓸 수 있고, 한 번 쓰면 더 쓰이지 않습니다.<br><br>'
        + '<span style="color:#9c9489;">본인이 요청하지 않았다면 이 메일을 지우셔도 됩니다. '
        + '지금 비밀번호는 그대로입니다.</span>',
      cta: '새 비밀번호 정하기', ctaUrl: url,
    }), { kind: 'password_reset', user_id: row.id, user_name: row.name, user_email: row.email });
  } catch (_) {}

  return ok();
}

async function handleResetPage(request, env) {
  const t = new URL(request.url).searchParams.get('t') || '';
  const row = await resetVerify(env, t).catch(() => null);
  if (!row)
    return authPage('<p style="margin:16px 0 6px;font-size:18px;font-weight:600;text-align:center;">'
      + '링크를 쓸 수 없습니다</p>'
      + '<p style="margin:0;font-size:14px;line-height:1.75;color:#7a736a;text-align:center;">'
      + '이미 사용했거나 1시간이 지난 링크입니다.<br>'
      + '<a href="/api/auth/forgot" style="color:#5FA97E;">다시 받기</a></p>');

  return authPage(
    '<p style="margin:16px 0 6px;font-size:18px;font-weight:600;text-align:center;">새 비밀번호</p>'
    + '<p style="margin:0 0 20px;font-size:14px;line-height:1.75;color:#7a736a;text-align:center;">'
    + mailEsc(maskName(row.name)) + '님, 8자 이상으로 정해 주세요.</p>'
    + '<form id="f">'
    + '<input id="p1" type="password" required minlength="8" placeholder="새 비밀번호"'
    + ' autocomplete="new-password" style="' + AUTH_INPUT + '">'
    + '<div style="height:10px"></div>'
    + '<input id="p2" type="password" required minlength="8" placeholder="새 비밀번호 확인"'
    + ' autocomplete="new-password" style="' + AUTH_INPUT + '">'
    + '<button type="submit" style="' + AUTH_BTN + '">비밀번호 바꾸기</button>'
    + '</form>'
    + '<p id="m" style="margin:16px 0 0;font-size:14px;line-height:1.75;color:#c0564f;text-align:center;"></p>'
    + '<script>(function(){var T=' + JSON.stringify(t) + ';'
    + 'document.getElementById("f").onsubmit=function(ev){ev.preventDefault();'
    + 'var m=document.getElementById("m"),p1=document.getElementById("p1").value,'
    + 'p2=document.getElementById("p2").value;'
    + 'if(p1!==p2){m.textContent="두 번 적은 비밀번호가 다릅니다.";return;}'
    + 'var b=ev.target.querySelector("button");b.disabled=true;b.textContent="바꾸는 중…";'
    + 'fetch("/api/auth/reset",{method:"POST",headers:{"Content-Type":"application/json"},'
    + 'body:JSON.stringify({t:T,password:p1})}).then(function(r){return r.json()}).then(function(d){'
    + 'if(d&&d.success){document.getElementById("f").style.display="none";'
    + 'm.style.color="#5c554d";'
    + 'm.innerHTML="비밀번호를 바꿨습니다.<br>새 비밀번호로 로그인해 주세요.";}'
    + 'else{b.disabled=false;b.textContent="비밀번호 바꾸기";'
    + 'm.textContent=(d&&d.error)||"처리 중 문제가 생겼습니다.";}})'
    + '.catch(function(){b.disabled=false;b.textContent="비밀번호 바꾸기";'
    + 'm.textContent="잠시 후 다시 시도해 주세요.";});};})();</script>'
  );
}

async function handleResetSubmit(request, env) {
  const b = await request.json().catch(() => ({}));
  const t = String(b.t || '');
  const pw = String(b.password || '');

  const bad = passwordProblem(pw);
  if (bad) return jsonResponse({ success: false, error: bad }, 400);

  const row = await resetVerify(env, t).catch(() => null);
  if (!row)
    return jsonResponse({ success: false, error: '이미 사용했거나 만료된 링크입니다.' }, 400);

  try {
    await env.DB.prepare('UPDATE users SET password = ? WHERE id = ?')
      .bind(await hashPassword(pw), row.id).run();
    /* 비밀번호가 바뀌었으니 기존 세션은 전부 끊는다. 같은 이유로
       이 재설정 토큰도 이 시점에 효력을 잃는다(키가 해시였다). */
    await revokeSessions(env, row.id, null);
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: '처리 중 문제가 생겼습니다.' }, 500);
  }
}

/* ── 메일로 시작하기 ────────────────────────────────────────

   로그인을 없앤 뒤 독자가 들어오는 문 하나다. 주소만 적으면 링크가 담긴
   메일이 가고, 그 링크를 누르는 것으로 신분 확인이 끝난다. 비밀번호를
   만들 일도, 기억할 일도 없다. 자매 사이트와 같은 방식이다.

   가입 여부는 알려 주지 않는다. 처음 적은 주소면 자리를 만들고, 이미
   있는 주소면 그 사람의 링크를 보낸다. 응답은 어느 쪽이나 같다 —
   주소를 넣어 보며 회원인지 떠보는 길을 두지 않는다.

   비밀번호 칸은 비워 둔다(NOT NULL 이라 빈 문자열). 독자 쪽에는
   비밀번호로 들어오는 길이 없으므로 채울 값이 없다. */
const START_MAX_PER_HOUR = 3;

async function handleEmailStartPage(request, env) {
  return authPage(
    '<p style="margin:16px 0 6px;font-size:18px;font-weight:600;text-align:center;">메일로 시작하기</p>'
    + '<p style="margin:0 0 20px;font-size:14px;line-height:1.75;color:#7a736a;text-align:center;">'
    + '주소를 적어 주시면 링크를 보내 드립니다.<br>비밀번호는 없습니다.</p>'
    + '<form id="f">'
    + '<input id="e" type="email" required placeholder="이메일 주소" autocomplete="email" style="' + AUTH_INPUT + '">'
    + '<button type="submit" style="' + AUTH_BTN + '">링크 받기</button>'
    + '</form>'
    + '<p id="m" style="margin:16px 0 0;font-size:14px;line-height:1.75;color:#5c554d;text-align:center;"></p>'
    + '<script>document.getElementById("f").onsubmit=function(ev){ev.preventDefault();'
    + 'var b=ev.target.querySelector("button");b.disabled=true;b.textContent="보내는 중…";'
    + 'fetch("/api/email/start",{method:"POST",headers:{"Content-Type":"application/json"},'
    + 'body:JSON.stringify({email:document.getElementById("e").value,'
    /* 친구 초대 링크로 들어온 사람은 sessionStorage 에 코드가 담겨 있다.
       같은 출처라 이 화면에서도 읽힌다. */
    + 'ref:(function(){try{return sessionStorage.getItem("pendingRef")||""}catch(e){return ""}})()})})'
    + '.then(function(r){return r.json()}).then(function(){'
    + 'try{sessionStorage.removeItem("pendingRef")}catch(e){}'
    + 'document.getElementById("f").style.display="none";'
    + 'document.getElementById("m").innerHTML="메일을 보냈습니다.<br>받은편지함을 확인해 주세요.";'
    + '}).catch(function(){b.disabled=false;b.textContent="링크 받기";'
    + 'document.getElementById("m").textContent="잠시 후 다시 시도해 주세요.";});};</script>'
  );
}

async function handleEmailStart(request, env) {
  const b = await request.json().catch(() => ({}));
  const email = String(b.email || '').trim().toLowerCase();
  const name = String(b.name || '').trim().slice(0, 40);
  const ref = String(b.ref || '').trim().toUpperCase().slice(0, 16);

  /* 응답은 언제나 같다. */
  const ok = () => jsonResponse({ success: true });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return ok();

  try {
    await ensureEmailColumns(env);
    let row = await env.DB.prepare('SELECT id, name, email FROM users WHERE email = ?')
      .bind(email).first();

    if (!row) {
      /* username 은 NOT NULL UNIQUE 다. 가입 화면이 있던 때부터 주소를
         그대로 넣어 왔으므로 같은 규칙을 지킨다. auth_provider 도 맞춰 둔다. */
      await env.DB.prepare(
        "INSERT INTO users (username, name, email, password, role, permissions, auth_provider)"
        + " VALUES (?, ?, ?, '', 'user', '[\"korean\"]', 'email')"
      ).bind(email, name || email.split('@')[0], email).run();
      row = await env.DB.prepare('SELECT id, name, email FROM users WHERE email = ?')
        .bind(email).first();
      if (!row) return ok();

      /* 추천인을 센다. 가입 화면이 소비하던 자리인데, 그 화면을 없애면서
         ?ref= 는 담기기만 하고 아무도 읽지 않는 상태로 남아 있었다.
         새로 생긴 사람에게만 붙인다 — 이미 있던 사람을 누가 데려왔다고
         할 수는 없다. */
      if (ref) {
        try {
          const by = await env.DB.prepare(
            'SELECT id FROM users WHERE referral_code = ?'
          ).bind(ref).first();
          if (by && by.id !== row.id) {
            await env.DB.prepare('UPDATE users SET referred_by = ? WHERE id = ?')
              .bind(by.id, row.id).run();
            await env.DB.prepare(
              'UPDATE users SET referral_count = COALESCE(referral_count, 0) + 1 WHERE id = ?'
            ).bind(by.id).run();
          }
        } catch (_) {}
      }
      /* 가입 화면이 있던 때 운영자에게 가던 알림을 여기로 옮긴다.
         새 독자가 생기는 지점이 이제 여기 하나뿐이다. */
      sendNewUserNotification(env, { username: email, name: row.name, email }).catch(() => {});
    }

    /* 한 주소로 메일이 쏟아지지 않게 막는다. 발송 기록을 그대로 쓴다. */
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM send_logs WHERE kind = 'email_start' AND user_id = ?"
      + " AND sent_at > datetime('now', '-1 hours')"
    ).bind(row.id).first();
    if (recent && recent.n >= START_MAX_PER_HOUR) return ok();

    const unsub = await ensureUnsubscribeToken(env, row.id);
    const url = 'https://99wisdombook.org/api/email/subscribe?t=' + encodeURIComponent(unsub);

    await sendAndLog(env, noticeEmail(env, row, {
      subject: '시작 링크 · 99 Wisdom Insight',
      heading: '아래 버튼 하나로 시작됩니다',
      lead: '누르시면 이메일 알림이 켜지고, 바로 오늘의 문장으로 이어집니다.<br>'
        + '받는 시각은 그 화면에서 고르실 수 있고, 메일 바닥의 링크로 언제든 끄실 수 있습니다.<br><br>'
        + '<span style="color:#9c9489;">요청하지 않으셨다면 이 메일을 지우셔도 됩니다. '
        + '누르지 않으면 아무것도 시작되지 않습니다.</span>',
      cta: '알림 켜고 시작하기', ctaUrl: url,
    }), { kind: 'email_start', user_id: row.id, user_name: row.name, user_email: row.email });
  } catch (_) {}

  return ok();
}

/* 화면이 "나는 누구이고 무엇을 켜 두었나"를 묻는 곳. 로그인 대신 쓴다. */
async function handleMe(request, env) {
  await ensureEmailColumns(env);
  const userId = await readerId(request, env, null);
  if (!userId) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);

  const row = await env.DB.prepare(
    'SELECT id, name, nickname, email, role, email_enabled, notify_enabled,'
    + ' notify_hour, notify_minute, notify_days, streak_count FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!row) return jsonResponse({ success: false, error: 'Not found' }, 404);

  /* 주소는 끝까지 돌려주지 않는다. 메일 링크는 전달될 수 있고, 전달받은
     사람에게 원래 주인의 주소까지 보여 줄 이유가 없다. */
  const em = String(row.email || '');
  const at = em.indexOf('@');
  const maskedEmail = at > 1 ? em.slice(0, 2) + '***' + em.slice(at) : em;

  return jsonResponse({
    success: true,
    user: {
      id: row.id, name: row.name, nickname: row.nickname || null,
      nick: displayNick(row), email: maskedEmail, role: row.role,
      email_enabled: row.email_enabled || 0, notify_enabled: row.notify_enabled || 0,
      notify_hour: row.notify_hour, notify_minute: row.notify_minute || 0,
      notify_days: row.notify_days, streak_count: row.streak_count || 0,
    },
  });
}

async function handleMeUpdate(request, env) {
  await ensureEmailColumns(env);
  const b = await request.json().catch(() => ({}));
  const userId = await readerId(request, env, b);
  if (!userId) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);

  if (b.nickname !== undefined) {
    const c = cleanNick(b.nickname);
    if (c.err) return jsonResponse({ success: false, error: c.err }, 400);
    await env.DB.prepare('UPDATE users SET nickname = ? WHERE id = ?').bind(c.v, userId).run();
  }
  const row = await env.DB.prepare('SELECT nickname FROM users WHERE id = ?').bind(userId).first();
  return jsonResponse({ success: true, nickname: (row && row.nickname) || null, nick: displayNick(row) });
}

async function handleEmailSubscribePage(request, env) {
  const t = new URL(request.url).searchParams.get('t') || '';
  if (!/^[0-9a-f]{32}$/.test(t))
    return subPage('<p style="margin:18px 0 0;font-size:17px;line-height:1.7;">잘못된 링크입니다.</p>');

  await ensureEmailColumns(env);
  let row = null;
  try {
    row = await env.DB.prepare(
      'SELECT id, name, email_enabled, notify_enabled, notify_hour FROM users WHERE unsubscribe_token = ?'
    ).bind(t).first();
  } catch (_) {}
  if (!row)
    return subPage('<p style="margin:18px 0 0;font-size:17px;line-height:1.7;">유효하지 않은 링크입니다.</p>');

  /* 켠 다음 갈 곳을 준다. 토큰을 함께 실어 보내므로 그 화면에서 보관하기와
     기록 쓰기가 바로 된다 — 로그인 화면으로 떨어지지 않는다. */
  const goUrl = '/daily.html?t=' + encodeURIComponent(await writeTokenFor(env, row.id));

  const hours = [7, 8, 9, 21];
  const opts = hours.map((h) =>
    '<button data-h="' + h + '" style="background:#fff;border:1px solid #ddd8d0;border-radius:999px;'
    + 'padding:9px 15px;margin:0 4px 8px 0;font-size:14px;cursor:pointer;color:#4a443d;">'
    + (h < 12 ? '아침 ' + h + '시' : '저녁 ' + (h - 12) + '시') + '</button>').join('');

  /* 화면이 열리면 바로 켠다. 사람에게는 메일에서 누른 한 번이 전부다.
     자바스크립트가 꺼져 있으면 아래 버튼이 같은 일을 한다. */
  const inner =
    '<p id="msg" style="margin:18px 0 6px;font-size:17px;line-height:1.7;">알림을 켜고 있습니다…</p>'
    + '<p id="sub" style="margin:0;font-size:14px;line-height:1.75;color:#7a736a;"></p>'
    + '<div id="pick" style="display:none;margin:26px 0 0;">'
    + '<p style="margin:0 0 10px;font-size:13px;color:#9c9489;">받는 시각을 고르실 수 있습니다</p>'
    + opts
    /* 고른 결과를 버튼 바로 아래에 둔다. 전에는 알림 문구가 버튼 위에만
       있어서, 누른 사람이 눈을 두는 곳에 아무 변화가 없었다. */
    + '<p id="pickmsg" style="margin:6px 0 0;font-size:13px;line-height:1.7;min-height:18px;color:#5FA97E;"></p>'
    + '</div>'
    + '<p style="margin:26px 0 0;"><a href="' + mailEsc(goUrl) + '" style="display:inline-block;'
    + 'background:#5FA97E;color:#fff;text-decoration:none;border-radius:999px;'
    + 'padding:12px 24px;font-size:15px;font-weight:600;">오늘의 문장 보기</a></p>'
    + '<noscript><form method="POST" action="/api/email/subscribe">'
    + '<input type="hidden" name="t" value="' + mailEsc(t) + '">'
    + '<button type="submit" style="background:#5FA97E;color:#fff;border:0;border-radius:999px;'
    + 'padding:12px 24px;font-size:15px;font-weight:600;cursor:pointer;">이메일 알림 켜기</button>'
    + '</form></noscript>'
    + '<script>(function(){var T=' + JSON.stringify(t) + ';'
    + 'var $=function(i){return document.getElementById(i)};'
    + 'function post(b){return fetch("/api/email/subscribe",{method:"POST",'
    + 'headers:{"Content-Type":"application/json"},body:JSON.stringify(b)})'
    + '.then(function(r){return r.json()});}'
    + 'function said(h){return "님께 "+h+"시에 보내 드립니다.<br>메일 바닥의 링크로 언제든 끄실 수 있습니다.";}'
    /* 고른 시각에 표시를 남긴다. 눌렀는지 아닌지가 버튼에 보여야 한다. */
    + 'function mark(h){Array.prototype.forEach.call(document.querySelectorAll("#pick button"),'
    + 'function(b){var on=parseInt(b.dataset.h,10)===h;'
    + 'b.style.background=on?"#5FA97E":"#fff";b.style.color=on?"#fff":"#4a443d";'
    + 'b.style.borderColor=on?"#5FA97E":"#ddd8d0";});}'
    + 'post({t:T}).then(function(d){'
    + 'if(!d||!d.success){$("msg").textContent="처리 중 문제가 생겼습니다.";return;}'
    + '$("msg").innerHTML="이메일 알림을 켰습니다.";'
    + '$("sub").innerHTML=d.masked+said(d.hour);'
    + '$("pick").style.display="block";mark(d.hour);})'
    + '.catch(function(){$("msg").textContent="연결에 문제가 있습니다. 잠시 후 다시 열어 주세요.";});'
    + 'Array.prototype.forEach.call(document.querySelectorAll("#pick button"),function(b){'
    + 'b.onclick=function(){var h=parseInt(b.dataset.h,10);'
    + '$("pickmsg").style.color="#9c9489";$("pickmsg").textContent="바꾸는 중…";'
    + 'post({t:T,hour:h}).then(function(d){'
    /* 전에는 실패했을 때 아무 말도 하지 않았다. 누른 사람은 눌리지 않은
       것인지 저장이 안 된 것인지 알 길이 없었다. */
    + 'if(d&&d.success){mark(d.hour);$("sub").innerHTML=d.masked+said(d.hour);'
    + '$("pickmsg").style.color="#5FA97E";$("pickmsg").textContent="바꿨습니다 · 이제 "+d.hour+"시에 보내 드립니다.";}'
    + 'else{$("pickmsg").style.color="#c0564f";'
    + '$("pickmsg").textContent=(d&&d.error)||"바꾸지 못했습니다.";}})'
    + '.catch(function(){$("pickmsg").style.color="#c0564f";'
    + '$("pickmsg").textContent="연결에 문제가 있습니다. 다시 눌러 주세요.";});};});})();</script>';

  return subPage(inner);
}

async function handleEmailSubscribe(request, env) {
  /* 폼(noscript)과 JSON 양쪽을 받는다. */
  let t = '', hour = null;
  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  try {
    if (ct.indexOf('application/json') >= 0) {
      const b = await request.json();
      t = String(b.t || '').trim();
      if (b.hour != null) hour = parseInt(b.hour, 10);
    } else {
      const f = await request.formData();
      t = String(f.get('t') || '').trim();
    }
  } catch (_) {}

  const wantsHtml = ct.indexOf('application/json') < 0;
  const fail = (msg, code) => wantsHtml
    ? subPage('<p style="margin:18px 0 0;font-size:17px;line-height:1.7;">' + mailEsc(msg) + '</p>')
    : jsonResponse({ success: false, error: msg }, code || 400);

  if (!/^[0-9a-f]{32}$/.test(t)) return fail('잘못된 링크입니다.');
  if (hour != null && !(hour >= 0 && hour <= 23)) hour = null;

  try {
    await ensureEmailColumns(env);
    const row = await env.DB.prepare(
      'SELECT id, name, notify_hour FROM users WHERE unsubscribe_token = ?'
    ).bind(t).first();
    if (!row) return fail('유효하지 않은 링크입니다.');

    /* 시각이 아직 없으면 기본값을 넣는다. notify_days 는 건드리지 않는다
       (NULL 이면 매일이고, 이미 고른 요일이 있으면 그대로 둔다). */
    const h = hour != null ? hour : (row.notify_hour != null ? row.notify_hour : SUB_DEFAULT_HOUR);
    await env.DB.prepare(
      'UPDATE users SET email_enabled = 1, notify_enabled = 1, notify_hour = ?,'
      + ' notify_minute = COALESCE(notify_minute, 0) WHERE id = ?'
    ).bind(h, row.id).run();

    if (wantsHtml)
      return subPage('<p style="margin:18px 0 6px;font-size:17px;line-height:1.7;">이메일 알림을 켰습니다.</p>'
        + '<p style="margin:0;font-size:14px;line-height:1.75;color:#7a736a;">'
        + mailEsc(maskName(row.name)) + '님께 ' + h + '시에 보내 드립니다.<br>'
        + '메일 바닥의 링크로 언제든 끄실 수 있습니다.</p>');

    return jsonResponse({ success: true, masked: maskName(row.name), hour: h });
  } catch (err) {
    return fail('처리 중 문제가 생겼습니다.', 500);
  }
}

/* 수신 거부. 로그인 없이 링크만으로 동작해야 한다.

   되돌릴 길을 같은 화면에 둔다. 전에는 "설정에서 언제든 다시 켤 수
   있습니다" 라고만 적혀 있었는데, 그 설정으로 가는 링크는 방금 해지한
   메일 안에만 있었다. 잘못 눌렀을 때 돌아올 방법이 없었다.

   브라우저 알림은 따로 다룬다. 이 링크의 이름은 '이메일 받지 않기'이고,
   그 말대로 이메일만 끈다. 다만 푸시 구독이 남아 있으면 끈 줄 알았던
   알림이 계속 뜨므로, 그 경우에만 끄는 버튼을 하나 더 보여 준다.
   구독이 없으면 보낼 것이 남지 않으므로 notify_enabled 까지 내린다. */
async function handleEmailUnsubscribe(request, env) {
  const t = new URL(request.url).searchParams.get('t') || '';
  if (!/^[0-9a-f]{32}$/.test(t))
    return subPage('<p style="margin:18px 0 0;font-size:17px;line-height:1.7;">잘못된 링크입니다.</p>');

  await ensureEmailColumns(env);
  let row = null;
  try {
    row = await env.DB.prepare(
      'SELECT id, name, push_endpoint FROM users WHERE unsubscribe_token = ?'
    ).bind(t).first();
  } catch (_) {}
  if (!row)
    return subPage('<p style="margin:18px 0 0;font-size:17px;line-height:1.7;">'
      + '이미 해지되었거나 유효하지 않은 링크입니다.</p>');

  const hasPush = !!row.push_endpoint;
  try {
    await env.DB.prepare(
      hasPush
        ? 'UPDATE users SET email_enabled = 0 WHERE id = ?'
        : 'UPDATE users SET email_enabled = 0, notify_enabled = 0 WHERE id = ?'
    ).bind(row.id).run();
  } catch (_) {
    return subPage('<p style="margin:18px 0 0;font-size:17px;line-height:1.7;">'
      + '처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.</p>');
  }

  const BTN = 'display:inline-block;border:0;border-radius:999px;padding:11px 22px;'
    + 'font-size:14.5px;font-weight:600;cursor:pointer;text-decoration:none;';

  return subPage(
    '<p style="margin:18px 0 6px;font-size:17px;line-height:1.7;">이메일 수신을 해지했습니다.</p>'
    + '<p id="sub" style="margin:0;font-size:14px;line-height:1.75;color:#7a736a;">'
    + (hasPush
        ? '더 이상 메일을 보내지 않습니다.<br>브라우저 알림은 아직 켜져 있습니다.'
        : '더 이상 보내지 않습니다.')
    + '</p>'
    + '<div id="acts" style="margin:26px 0 0;">'
    + (hasPush
        ? '<button id="nopush" style="' + BTN + 'background:#fff;border:1px solid #ddd8d0;'
          + 'color:#4a443d;margin:0 0 10px;">브라우저 알림도 끄기</button><br>'
        : '')
    /* 잘못 눌렀을 때 돌아오는 길. 이 화면을 떠나지 않아도 된다. */
    + '<button id="back" style="' + BTN + 'background:#5FA97E;color:#fff;">다시 받기</button>'
    + '</div>'
    + '<p id="m" style="margin:14px 0 0;font-size:13.5px;line-height:1.7;min-height:18px;color:#7a736a;"></p>'
    + '<script>(function(){var T=' + JSON.stringify(t) + ';'
    + 'var $=function(i){return document.getElementById(i)};'
    + 'function post(u,b){return fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},'
    + 'body:JSON.stringify(b)}).then(function(r){return r.json()});}'
    + 'var back=$("back");back.onclick=function(){back.disabled=true;back.textContent="켜는 중…";'
    + 'post("/api/email/subscribe",{t:T}).then(function(d){'
    + 'if(d&&d.success){$("acts").style.display="none";'
    + '$("sub").innerHTML="다시 받으시도록 켰습니다.<br>"+d.masked+"님께 "+d.hour+"시에 보내 드립니다.";}'
    + 'else{back.disabled=false;back.textContent="다시 받기";'
    + '$("m").textContent=(d&&d.error)||"켜지 못했습니다.";}})'
    + '.catch(function(){back.disabled=false;back.textContent="다시 받기";'
    + '$("m").textContent="잠시 후 다시 시도해 주세요.";});};'
    + 'var np=$("nopush");if(np)np.onclick=function(){np.disabled=true;np.textContent="끄는 중…";'
    + 'post("/api/email/unsubscribe/push",{t:T}).then(function(d){'
    + 'if(d&&d.success){np.style.display="none";'
    + '$("sub").innerHTML="더 이상 보내지 않습니다.<br>브라우저 알림도 껐습니다.";}'
    + 'else{np.disabled=false;np.textContent="브라우저 알림도 끄기";'
    + '$("m").textContent=(d&&d.error)||"끄지 못했습니다.";}})'
    + '.catch(function(){np.disabled=false;np.textContent="브라우저 알림도 끄기";'
    + '$("m").textContent="잠시 후 다시 시도해 주세요.";});};})();</script>'
  );
}

/* 해지 화면에서 브라우저 알림까지 끄는 자리. 구독 정보를 지워야 실제로
   멈춘다 — notify_enabled 만 내리면 다시 켤 때 옛 단말로 되살아난다. */
async function handleUnsubscribePush(request, env) {
  const b = await request.json().catch(() => ({}));
  const t = String(b.t || '').trim();
  if (!/^[0-9a-f]{32}$/.test(t))
    return jsonResponse({ success: false, error: '잘못된 링크입니다.' }, 400);

  try {
    await ensureEmailColumns(env);
    const row = await env.DB.prepare(
      'SELECT id FROM users WHERE unsubscribe_token = ?'
    ).bind(t).first();
    if (!row) return jsonResponse({ success: false, error: '유효하지 않은 링크입니다.' }, 400);

    await env.DB.prepare(
      'UPDATE users SET notify_enabled = 0, push_endpoint = NULL,'
      + ' push_p256dh = NULL, push_auth = NULL WHERE id = ?'
    ).bind(row.id).run();
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: '처리 중 문제가 생겼습니다.' }, 500);
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
      subject: `[99wisdombook] 새 독자: ${name}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#fff;">
          <h2 style="color:#3e2820;border-bottom:2px solid #8d6e63;padding-bottom:10px;margin-top:0;">
            📚 새 독자가 시작했습니다
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
  await ensureEmailColumns(env);
  const userId = await readerId(request, env, null);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  await ensureSavedWisdomTable(env);
  const result = await env.DB.prepare(
    'SELECT chapter_id, title, memo, saved_at FROM saved_wisdom WHERE user_id = ? ORDER BY saved_at DESC'
  ).bind(userId).all();

  return jsonResponse({ success: true, saved: result.results || [] });
}

async function handleSaveWisdom(request, env) {
  await ensureEmailColumns(env);
  const b = await request.json().catch(() => ({}));
  const userId = await readerId(request, env, b);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { chapter_id, title, memo } = b;
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
  await ensureEmailColumns(env);
  const b = await request.json().catch(() => ({}));
  const userId = await readerId(request, env, b);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { memo } = b;
  const memoText = (memo || '').trim().slice(0, 300);

  await env.DB.prepare(
    'UPDATE saved_wisdom SET memo = ? WHERE user_id = ? AND chapter_id = ?'
  ).bind(memoText || null, userId, parseInt(chapterId, 10)).run();

  return jsonResponse({ success: true, memo: memoText });
}

async function handleUnsaveWisdom(chapterId, request, env) {
  await ensureEmailColumns(env);
  const userId = await readerId(request, env, null);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  await ensureSavedWisdomTable(env);
  await env.DB.prepare(
    'DELETE FROM saved_wisdom WHERE user_id = ? AND chapter_id = ?'
  ).bind(userId, parseInt(chapterId, 10)).run();

  return jsonResponse({ success: true, message: 'Removed' });
}

// ── Streak (스트릭) ─────────────────────────────────────────
async function handleStreak(request, env) {
  await ensureEmailColumns(env);
  const b = await request.json().catch(() => ({}));
  const userId = await readerId(request, env, b);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { date } = b; // 'YYYY-MM-DD'
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
async function handleGetSendLogs(request, env) {
  if (!await verifyAdminStrict(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  try {
    await ensureSendLogTable(env);
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
    const rows = await env.DB.prepare(
      `SELECT id, user_id, user_name, user_email, channel, kind, chapter_id,
              status, provider_id, from_addr, error, sent_at
       FROM send_logs ORDER BY id DESC LIMIT ?`
    ).bind(limit).all();

    // 최근 7일 요약 — "요즘 나가고 있나"를 한 줄로 보기 위한 값
    const sum = await env.DB.prepare(
      `SELECT COUNT(*) total,
              SUM(status = 'ok') ok,
              SUM(status = 'failed') failed,
              MAX(sent_at) last_at
       FROM send_logs WHERE sent_at >= datetime('now', '-7 days')`
    ).first();

    return jsonResponse({ success: true, logs: rows.results || [], summary: sum || {} });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

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

  let sql = "SELECT id, chapter_id, part_id, lens, slug, title, hook, anchor_quote, quotable, hero_image, updated_at, reading_time, tags, published_at FROM insights WHERE status = 'published'";
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

  /* Daily Wisdom 신청 현황을 함께 내려준다. 전에는 이 값들이 DB 에만 있고
     관리자 화면 어디에도 나오지 않아, 누가 신청했는지 볼 방법이 없었다.
     push_endpoint 은 길고 민감해서 값 자체 대신 있는지만 보낸다. */
  await ensureEmailColumns(env);
  const FULL = 'SELECT id, username, name, email, role, permissions, streak_count, created_at, last_login,'
    + ' notify_enabled, email_enabled, notify_days, notify_hour, notify_minute,'
    + ' (push_endpoint IS NOT NULL) AS has_push FROM users ORDER BY created_at DESC';

  // 구버전 DB 에도 동작하도록 fallback 처리
  let result;
  try {
    result = await env.DB.prepare(FULL).all();
  } catch (_) {
    try {
      result = await env.DB.prepare(
        'SELECT id, username, name, email, role, permissions, streak_count, created_at, last_login FROM users ORDER BY created_at DESC'
      ).all();
    } catch (__) {
      result = await env.DB.prepare(
        'SELECT id, username, name, email, role, permissions, created_at, last_login FROM users ORDER BY created_at DESC'
      ).all();
    }
  }

  const users = result.results.map(u => ({
    ...u,
    streak_count: u.streak_count ?? 0,
    notify_enabled: u.notify_enabled ?? 0,
    email_enabled: u.email_enabled ?? 0,
    has_push: !!u.has_push,
    permissions: JSON.parse(u.permissions || '[]'),
  }));
  return jsonResponse({ success: true, users, count: users.length });
}

/* 관리자가 회원을 대신 만든다.
   비밀번호를 받지 않으면 여기서 만들어 한 번만 돌려준다. 이 사이트에는
   비밀번호 재설정 흐름이 없고 로그인 화면도 "관리자에게 문의하세요" 로
   안내하므로, 관리자가 만들어 전달하는 것이 지금의 유일한 경로다.
   해시는 서버에서 건다 — 평문은 저장하지 않는다. */
function genTempPassword() {
  // 헷갈리는 글자(0/O, 1/l/I)는 뺐다. 받아 적어 전달해야 하는 값이다.
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

async function handleCreateUser(request, env) {
  if (!await verifyAdminStrict(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);

  const b = await request.json().catch(() => ({}));
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();

  if (!name) return jsonResponse({ error: '이름을 입력해 주세요.' }, 400);
  if (name.length > 40) return jsonResponse({ error: '이름은 40자까지 입력할 수 있습니다.' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return jsonResponse({ error: '이메일 형식이 올바르지 않습니다.' }, 400);
  }

  const dup = await env.DB.prepare('SELECT id FROM users WHERE lower(email) = ?').bind(email).first();
  if (dup) return jsonResponse({ error: '이미 사용 중인 이메일입니다.' }, 409);

  const supplied = String(b.password || '');
  if (supplied && supplied.length < 8) {
    return jsonResponse({ error: '비밀번호는 8자 이상이어야 합니다.' }, 400);
  }
  const password = supplied || genTempPassword();
  const role = b.role === 'admin' ? 'admin' : 'user';

  const row = await env.DB.prepare(
    'INSERT INTO users (username, password, name, email, role, permissions, auth_provider)'
    + ' VALUES (?, ?, ?, ?, ?, ?, ?)'
    + ' RETURNING id, username, name, email, role, created_at'
  ).bind(email, await hashPassword(password), name, email, role, '[]', 'local').first();

  if (!row) return jsonResponse({ error: '회원을 만들지 못했습니다.' }, 500);

  /* 관리자가 직접 만든 계정이니 신규 가입 알림 메일은 보내지 않는다.
     generated 가 true 일 때만 비밀번호를 돌려준다 — 관리자가 정한
     비밀번호를 되돌려 줄 이유는 없다. */
  return jsonResponse({
    success: true,
    user: row,
    generated: !supplied,
    password: supplied ? null : password,
  }, 201);
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

/* 본인 프로필 수정. PUT /api/users/:id 는 관리자 전용이라
   사용자가 자기 이름·이메일을 고칠 수단이 없었다. role 과 permissions 는
   여기서 받지 않는다 — 받으면 사용자가 스스로 관리자가 될 수 있다. */
async function handleUpdateProfile(userId, request, env) {
  const tokenUserId = await getUserIdFromToken(request, env);
  if (!tokenUserId || tokenUserId !== parseInt(userId)) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const updates = [], bindings = [];

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return jsonResponse({ error: '이름을 비워 둘 수 없습니다.' }, 400);
    if (name.length > 40) return jsonResponse({ error: '이름은 40자까지 입력할 수 있습니다.' }, 400);
    updates.push('name = ?'); bindings.push(name);
  }

  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return jsonResponse({ error: '이메일 형식이 올바르지 않습니다.' }, 400);
    }
    /* 이메일은 로그인 아이디라 중복되면 나중에 둔 사람이 못 들어온다. */
    const dup = await env.DB.prepare('SELECT id FROM users WHERE lower(email) = ? AND id <> ?')
      .bind(email, tokenUserId).first();
    if (dup) return jsonResponse({ error: '이미 사용 중인 이메일입니다.' }, 409);
    updates.push('email = ?'); bindings.push(email);
  }

  if (!updates.length) return jsonResponse({ error: '변경할 내용이 없습니다.' }, 400);

  bindings.push(tokenUserId);
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...bindings).run();
  const row = await env.DB.prepare('SELECT id, username, name, email, role FROM users WHERE id = ?')
    .bind(tokenUserId).first();
  return jsonResponse({ success: true, user: row });
}

/* 다른 기기의 세션을 끊는다. 비밀번호를 바꾼 뒤에도 옛 세션이 90일 동안
   살아 있으면 바꾼 의미가 없다. keepTokenHash 를 주면 그 세션만 남긴다. */
async function revokeSessions(env, userId, keepTokenHash) {
  try {
    await ensureSessionsTable(env);
    if (keepTokenHash) {
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
        .bind(userId, keepTokenHash).run();
    } else {
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
    }
  } catch (_) {}
}

function passwordProblem(pw) {
  if (!pw || pw.length < 8) return '새 비밀번호는 8자 이상이어야 합니다.';
  if (pw.length > 72) return '새 비밀번호가 너무 깁니다.';
  return null;
}

/* 본인 비밀번호 변경. 현재 비밀번호를 확인한다 —
   로그인한 채 자리를 비운 화면에서 남이 바꿔 버리는 것을 막는다. */
async function handleChangePassword(userId, request, env) {
  const tokenUserId = await getUserIdFromToken(request, env);
  if (!tokenUserId || tokenUserId !== parseInt(userId)) return jsonResponse({ error: 'Unauthorized' }, 401);

  const b = await request.json().catch(() => ({}));
  const current = String(b.current_password || '');
  const next = String(b.new_password || '');

  const bad = passwordProblem(next);
  if (bad) return jsonResponse({ error: bad }, 400);
  if (current === next) return jsonResponse({ error: '지금 쓰는 비밀번호와 같습니다.' }, 400);

  const row = await env.DB.prepare('SELECT password FROM users WHERE id = ?').bind(tokenUserId).first();
  if (!row) return jsonResponse({ error: 'User not found' }, 404);
  if (!(await verifyPassword(current, row.password)).ok) {
    return jsonResponse({ error: '현재 비밀번호가 맞지 않습니다.' }, 403);
  }

  await env.DB.prepare('UPDATE users SET password = ? WHERE id = ?')
    .bind(await hashPassword(next), tokenUserId).run();

  // 쓰고 있는 이 세션만 남기고 나머지는 끊는다
  const auth = request.headers.get('Authorization') || '';
  const tok = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  await revokeSessions(env, tokenUserId, tok ? await sha256hex(tok) : null);

  return jsonResponse({ success: true, message: '비밀번호를 바꿨습니다.' });
}

/* 관리자가 임시 비밀번호를 재발급한다. 이 사이트에는 재설정 메일 흐름이
   없어서, 회원이 비밀번호를 잊으면 이 경로밖에 없다.
   관리자에게도 해시만 있고 원래 비밀번호는 알 수 없으므로 새로 만든다. */
/* 임시 비밀번호 재발급.

   관리자가 값을 직접 적어 보내면 그것을 쓰고, 비워 두면 만들어 준다.
   자동 생성한 값은 한 번 보여 주고 마는 문자열이라 전화로 불러 주기
   어렵다. 운영자가 그 자리에서 정하고 바로 알려 줄 수 있어야 한다. */
async function handleResetPassword(userId, request, env) {
  if (!await verifyAdminStrict(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);

  const row = await env.DB.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(userId).first();
  if (!row) return jsonResponse({ error: 'User not found' }, 404);

  const b = await request.json().catch(() => ({}));
  const supplied = String(b.password || '').trim();
  if (supplied) {
    const bad = passwordProblem(supplied);
    if (bad) return jsonResponse({ success: false, error: bad }, 400);
  }
  const password = supplied || genTempPassword();

  await env.DB.prepare('UPDATE users SET password = ? WHERE id = ?')
    .bind(await hashPassword(password), userId).run();

  /* 비밀번호가 바뀌었으니 기존 세션은 전부 끊는다. 같은 이유로 그
     사람 앞으로 나가 있던 재설정 링크도 이 시점에 효력을 잃는다
     (서명 키가 비밀번호 해시다). */
  await revokeSessions(env, parseInt(userId), null);

  return jsonResponse({ success: true, user: row, password, generated: !supplied });
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

// ── 알림 설정 (이메일 + Web Push) ───────────────────────────
async function handleGetNotify(userId, request, env) {
  await ensureEmailColumns(env);
  const tokenUserId = await readerId(request, env, null);
  if (!tokenUserId || tokenUserId !== parseInt(userId)) return jsonResponse({ error: 'Unauthorized' }, 401);
  const row = await env.DB.prepare(
    'SELECT notify_enabled, notify_days, notify_hour, notify_minute, email_enabled FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!row) return jsonResponse({ error: 'User not found' }, 404);
  return jsonResponse({ success: true, notify_enabled: row.notify_enabled || 0, notify_days: row.notify_days, notify_hour: row.notify_hour, notify_minute: row.notify_minute || 0, email_enabled: row.email_enabled || 0 });
}

async function handleUpdateNotify(userId, request, env) {
  await ensureEmailColumns(env);
  const body = await request.json().catch(() => ({}));
  const tokenUserId = await readerId(request, env, body);
  if (!tokenUserId) return jsonResponse({ error: 'Unauthorized' }, 401);

  /* 본인이거나 관리자면 고칠 수 있다. 관리자가 대신 꺼 주어야 하는
     경우가 있다 — 이메일 주소가 없는데 이메일 알림이 켜져 있으면
     발송 때마다 조용히 실패하는데, 그 계정은 로그인할 수도 없다. */
  const isSelf = tokenUserId === parseInt(userId);
  if (!isSelf && !(await verifyAdminStrict(request, env))) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const b = body;

  /* 푸시는 브라우저에서 구독해야 생기므로 관리자가 켜 줄 수는 없다.
     끌 수는 있어야 한다(단말을 잃었거나 해지 요청을 받은 경우). */
  if (b.clear_push) {
    await env.DB.prepare(
      'UPDATE users SET push_endpoint = NULL, push_p256dh = NULL, push_auth = NULL WHERE id = ?'
    ).bind(userId).run();
  }

  await env.DB.prepare(
    'UPDATE users SET notify_enabled = ?, notify_days = ?, notify_hour = ?, notify_minute = ?, email_enabled = ? WHERE id = ?'
  ).bind(b.notify_enabled ? 1 : 0, b.notify_days || null, b.notify_hour ?? null, b.notify_minute ?? 0,
         b.email_enabled ? 1 : 0, userId).run();

  return jsonResponse({ success: true, message: '알림 설정이 저장되었습니다.' });
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
  const userId = await readerId(request, env, null);
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
  const userId = await readerId(request, env, null);
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
  await ensureEmailColumns(env);

  // 오늘 아직 읽지 않았고, 스트릭이 걸려 있는 사용자
  let users = [];
  try {
    const r = await env.DB.prepare(`
      SELECT id, name, email, email_enabled, streak_count,
             push_endpoint, push_p256dh, push_auth
      FROM users
      WHERE notify_enabled = 1
        AND streak_count >= 1
        AND (last_wisdom_date IS NULL OR last_wisdom_date != ?)
    `).bind(today).all();
    users = r.results || [];
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }

  const url = 'https://99wisdombook.org/daily.html?autoopen=1';
  const results = { email_sent: 0, push_sent: 0, skipped: 0, errors: [] };

  for (const user of users) {
    const streak = user.streak_count || 1;
    const heading = `${streak}일 연속 기록이 오늘 끊길 수 있어요`;
    let touched = false;

    if (user.email_enabled && user.email) {
      try {
        const t = await ensureUnsubscribeToken(env, user.id);
        const unsubUrl = `https://99wisdombook.org/api/email/unsubscribe?t=${t}`;
        await sendAndLog(env, noticeEmail(env, user, {
          subject: `오늘의 한 문장이 아직 남아 있어요`,
          heading,
          lead: '오늘의 문장을 아직 읽지 않으셨어요.<br>한 문장이면 충분합니다.',
          cta: '오늘의 문장 읽기', ctaUrl: url, unsubUrl,
        }), { kind: 'reminder', user_id: user.id, user_name: user.name, user_email: user.email });
        results.email_sent++; touched = true;
      } catch (err) {
        results.errors.push({ userId: user.id, error: `Email: ${err.message}` });
      }
    }

    if (user.push_endpoint && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      try {
        await sendWebPushToUser(env, user,
          { title: heading, body: '오늘의 한 문장이 기다리고 있어요', url: '/daily.html?autoopen=1' }
        );
        results.push_sent++; touched = true;
      } catch (err) {
        results.errors.push({ userId: user.id, error: `WebPush: ${err.message}` });
      }
    }

    if (!touched) results.skipped++;
  }
  return jsonResponse({ success: true, date: today, total: users.length, ...results });
}

/* 매주 다른 칼럼을 고른다.

   발송 기록(send_logs)은 주기적으로 지워지므로 "이미 보낸 것"을 순번
   상태로 쓸 수 없다. 그래서 상태를 두지 않고 날짜에서 계산한다.
   고정 기준일부터 몇 주가 지났는지 세고, chapter_id 를 섞어 만든 고정
   순서에서 그 주차에 해당하는 칼럼을 꺼낸다.

   순서를 섞는 이유는 1장, 2장, 3장 순으로 나가면 한 부에 몇 달씩
   머물기 때문이다. 섞어 두면 주마다 다른 부의 글이 나간다.
   한 주에 한 칸씩 나아가므로 전부 한 번 돌고 나서야 처음으로 돌아온다.
   칼럼이 99편이면 약 이 년 주기다. */
const PROMO_EPOCH_MS = Date.UTC(2026, 0, 5); // 2026-01-05 (월)

function promoHash(n) {
  let x = Math.imul(n, 2654435761) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 2246822519) >>> 0;
  return (x ^ (x >>> 13)) >>> 0;
}

/** 발행된 칼럼의 chapter_id 를 섞은 고정 순서로 돌려준다. */
async function promoOrder(env) {
  const r = await env.DB.prepare(
    "SELECT chapter_id FROM insights WHERE status = 'published' ORDER BY chapter_id"
  ).all();
  return (r.results || [])
    .map((x) => x.chapter_id)
    .sort((a, b) => promoHash(a) - promoHash(b));
}

function promoWeek(nowMs) {
  return Math.floor((nowMs - PROMO_EPOCH_MS) / 604800000);
}

/** 그 주차에 나갈 chapter_id. 순서가 비어 있으면 null. */
function promoPick(order, week) {
  if (!order.length) return null;
  const n = order.length;
  return order[((week % n) + n) % n];
}

/* ── 칼럼 한 편 + 알림 설정 유도 (매주 수요일 12시) ──────────

   왜 별도 엔드포인트인가. 기존 /api/notify/cron 은 이미 알림을 켠
   사람에게 오늘의 칼럼을 보내는 정기 발송이다. 이쪽은 대상과 목적이
   다르다. 아직 알림을 켜지 않은 회원에게 칼럼을 한 편 보여 주고
   설정을 권하는 일이다.

   대상은 audience 로 고른다.
     subscribed (기본) — email_enabled = 1. 매주 수요일 정기 발송용.
     all               — 이메일이 있는 전 회원. 동의 없이 나가므로
                         1회 안내에만 쓴다. 반복 호출하지 말 것.
   to 를 주면 그 주소로만 한 통 보낸다(테스트). 회원 조회를 하지 않는다.
   dry_run 이면 보내지 않고 대상만 세어 돌려준다. */
/* ── 독자 비밀번호 지우기 (한 번만 쓰는 것) ──────────────────

   로그인을 없앴으니 독자 계정의 비밀번호 해시는 쓰이지 않는다. 쓰이지
   않는 자격증명을 남겨 두는 것은 보관할 이유가 없는 위험이다. 관리자
   계정은 그대로 둔다 — 관리자 화면은 계속 비밀번호로 들어간다.

   빈 문자열을 넣는다. password 가 NOT NULL 이라 NULL 을 넣을 수 없고,
   verifyPassword 는 빈 값을 먼저 걸러내므로 로그인은 되지 않는다.

   CLI 에서 D1 에 닿지 않아 엔드포인트로 둔다. 관리자 세션이나
   CRON_SECRET 중 하나면 된다. dry_run 으로 먼저 수를 볼 수 있다. */
async function handleClearReaderPasswords(request, env) {
  const b = await request.json().catch(() => ({}));
  const secret = (env.CRON_SECRET || '').trim();
  const byCron = secret && (request.headers.get('Authorization') || '') === `Bearer ${secret}`;
  if (!byCron && !(await verifyAdminStrict(request, env)))
    return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role != 'admin' AND password != ''"
    ).first();

    if (b.dry_run) return jsonResponse({ success: true, dry_run: true, would_clear: before?.n || 0 });

    await env.DB.prepare("UPDATE users SET password = '' WHERE role != 'admin'").run();

    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role != 'admin' AND password != ''"
    ).first();
    /* 비밀번호가 없어졌으니 남아 있던 독자 세션도 치운다. */
    try {
      await ensureSessionsTable(env);
      await env.DB.prepare(
        "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')"
      ).run();
    } catch (_) {}

    return jsonResponse({ success: true, cleared: before?.n || 0, remaining: after?.n || 0 });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

async function handlePromoCron(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const cronSecret = (env.CRON_SECRET || '').trim();
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`)
    return jsonResponse({ error: 'Unauthorized' }, 401);

  const b = await request.json().catch(() => ({}));
  /* 이 메일의 일은 '아직 알림을 켜지 않은 사람을 데려오는 것'이다.
     이미 켠 사람은 매일 아침 같은 칼럼을 받고 있으므로 보낼 이유가 없고,
     수요일에 두 통을 받게 된다. 그래서 기본 대상을 뒤집었다.

       promote(기본) 메일 주소는 있는데 알림을 켜지 않은 사람
       subscribed    이미 켠 사람 (예전 기본값 · 명시할 때만)
       all           주소가 있는 모든 사람 (1회성) */
  const audience = b.audience === 'all' ? 'all'
    : b.audience === 'subscribed' ? 'subscribed' : 'promote';
  const to = String(b.to || '').trim();
  const dryRun = !!b.dry_run;

  await ensureEmailColumns(env);

  /* chapter_id 를 주면 그 칼럼, 주지 않으면 이번 주 차례의 칼럼. */
  const order = await promoOrder(env);
  const week = promoWeek(Date.now());
  const chapterId = parseInt(b.chapter_id, 10) || promoPick(order, week);
  if (!chapterId)
    return jsonResponse({ success: false, error: '발행된 칼럼이 없습니다.' }, 404);

  /* 앞으로 어떤 순서로 나가는지 미리 볼 수 있게 한다. 상태가 없으므로
     날짜만 있으면 몇 주 뒤 것도 계산된다. */
  if (dryRun && b.preview) {
    const nWeeks = Math.min(parseInt(b.preview, 10) || 8, 99);
    const rows = [];
    for (let i = 0; i < nWeeks; i++) {
      const d = new Date(PROMO_EPOCH_MS + (week + i) * 604800000);
      rows.push({ week: week + i, from: d.toISOString().slice(0, 10), chapter_id: promoPick(order, week + i) });
    }
    return jsonResponse({ success: true, dry_run: true, total_columns: order.length, schedule: rows });
  }

  const col = await env.DB.prepare(
    "SELECT chapter_id, part_id, slug, title, hook, anchor_quote, body_md, action,"
    + " quotable, hero_image, updated_at, published_at"
    + " FROM insights WHERE status = 'published' AND chapter_id = ?"
  ).bind(chapterId).first();
  if (!col) return jsonResponse({ success: false, error: `${chapterId}장 칼럼이 없습니다.` }, 404);

  const item = { title: col.anchor_quote, id: col.chapter_id, column: col };

  /* 테스트 발송. 회원이 아닌 주소로도 보낼 수 있어야 한다.

     ⚠ 받는 주소가 회원이면 그 회원의 실제 토큰을 쓴다. 그러지 않으면
     메일의 알림 링크가 폴백으로 떨어져, 테스트로 본 메일과 회원이 받는
     메일이 달라진다. 링크를 고쳐도 테스트에서는 확인되지 않는다. */
  if (to) {
    if (dryRun) return jsonResponse({ success: true, dry_run: true, mode: 'test', to, week, chapter_id: chapterId, title: col.title });
    try {
      const member = await env.DB.prepare(
        'SELECT id, name FROM users WHERE email = ?'
      ).bind(to).first();
      const who = member ? { id: member.id, name: member.name, email: to } : { id: null, name: '독자', email: to };
      const unsubUrl = member
        ? 'https://99wisdombook.org/api/email/unsubscribe?t=' + (await ensureUnsubscribeToken(env, member.id))
        : 'https://99wisdombook.org/daily.html?notify=1';
      const noteUrl = member
        ? `https://99wisdombook.org/insight/${encodeURIComponent(col.slug)}?t=`
          + (await writeTokenFor(env, member.id))
        : '';
      const r = await sendAndLog(env,
        issueEmail(env, who, item, unsubUrl, {
          promo: true, noteUrl,
          notes: await notesForEmail(env, chapterId, member ? member.id : 0),
        }),
        { kind: 'promo_test', user_id: member ? member.id : null, user_email: to, chapter_id: chapterId });
      const want = (env.MAIL_FROM || '').trim() || MAIL_FROM_DEFAULT;
      return jsonResponse({
        success: true, mode: 'test', to, chapter_id: chapterId,
        id: r.id || null, from: r.from, verified: r.from === want,
      });
    } catch (err) {
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }

  const HAS_MAIL = " email IS NOT NULL AND email <> ''";
  const sql = audience === 'all'
    ? 'SELECT id, name, email FROM users WHERE' + HAS_MAIL
    : audience === 'subscribed'
      ? 'SELECT id, name, email FROM users WHERE email_enabled = 1 AND' + HAS_MAIL
      : 'SELECT id, name, email FROM users WHERE COALESCE(email_enabled, 0) != 1 AND' + HAS_MAIL;
  let users = [];
  try {
    users = (await env.DB.prepare(sql).all()).results || [];
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }

  /* 오늘 이미 메일을 받은 사람은 건너뛴다.

     대상을 뒤집어도 겹침이 완전히 사라지지는 않는다 — 아침에 알림을
     켠 사람은 낮 열두 시에는 'subscribed' 가 되어 있고, audience 를
     손으로 지정해 돌리는 경우도 있다. 보내기 직전에 한 번 더 본다.
     하루에 두 통은 그 자체로 해지 사유다. */
  await ensureSendLogTable(env);
  let sameDay = new Set();
  try {
    const r = await env.DB.prepare(
      "SELECT DISTINCT user_id FROM send_logs"
      + " WHERE channel = 'email' AND status = 'ok' AND user_id IS NOT NULL"
      + " AND kind IN ('issue', 'promo')"
      + " AND date(sent_at, '+9 hours') = date('now', '+9 hours')"
    ).all();
    sameDay = new Set((r.results || []).map((x) => x.user_id));
  } catch (_) {}

  const skippedToday = users.filter((u) => sameDay.has(u.id)).length;
  users = users.filter((u) => !sameDay.has(u.id));

  if (dryRun)
    return jsonResponse({
      success: true, dry_run: true, audience, week, chapter_id: chapterId,
      title: col.title, total: users.length, skipped_today: skippedToday,
    });

  const results = { sent: 0, errors: [] };
  for (const user of users) {
    try {
      const t = await ensureUnsubscribeToken(env, user.id);
      const noteTok = await writeTokenFor(env, user.id);
      await sendAndLog(env,
        issueEmail(env, user, item, `https://99wisdombook.org/api/email/unsubscribe?t=${t}`, {
          promo: true,
          noteUrl: `https://99wisdombook.org/insight/${encodeURIComponent(col.slug)}?t=${noteTok}`,
          notes: await notesForEmail(env, chapterId, user.id),
        }),
        { kind: 'promo', user_id: user.id, user_name: user.name, user_email: user.email, chapter_id: chapterId });
      results.sent++;
    } catch (err) {
      results.errors.push({ userId: user.id, error: err.message });
    }
  }
  return jsonResponse({
    success: true, audience, week, chapter_id: chapterId, title: col.title,
    total: users.length, skipped_today: skippedToday, ...results,
  });
}

// ── 주간 리포트 (일요일 저녁) ──────────────────────────────────
async function handleWeeklyCron(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const cronSecret = (env.CRON_SECRET || '').trim();
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`)
    return jsonResponse({ error: 'Unauthorized' }, 401);

  await ensureEmailColumns(env);

  // 스트릭이 있는 사용자 (채널은 아래에서 각자 확인)
  let users = [];
  try {
    const r = await env.DB.prepare(`
      SELECT id, name, email, email_enabled, streak_count,
             push_endpoint, push_p256dh, push_auth
      FROM users
      WHERE streak_count >= 1
    `).all();
    users = r.results || [];
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }

  const url = 'https://99wisdombook.org/daily.html?autoopen=1';
  const results = { email_sent: 0, push_sent: 0, skipped: 0, errors: [] };

  for (const user of users) {
    const streak = user.streak_count || 0;
    const name = user.name || '독자';
    const heading = `${name}님, 이번 주도 수고하셨어요`;
    const lead = `현재 ${streak}일 연속 읽고 계십니다.<br>꾸준함이 지혜가 됩니다.`;
    let touched = false;

    if (user.email_enabled && user.email) {
      try {
        const t = await ensureUnsubscribeToken(env, user.id);
        const unsubUrl = `https://99wisdombook.org/api/email/unsubscribe?t=${t}`;
        await sendAndLog(env, noticeEmail(env, user, {
          subject: `이번 주 기록 · ${streak}일 연속`,
          heading, lead,
          cta: '다음 문장 보기', ctaUrl: url, unsubUrl,
        }), { kind: 'weekly', user_id: user.id, user_name: user.name, user_email: user.email });
        results.email_sent++; touched = true;
      } catch (err) {
        results.errors.push({ userId: user.id, error: `Email: ${err.message}` });
      }
    }

    if (user.push_endpoint && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      try {
        await sendWebPushToUser(env, user,
          { title: heading, body: `${streak}일 연속 읽고 계십니다`, url: '/daily.html?autoopen=1' }
        );
        results.push_sent++; touched = true;
      } catch (err) {
        results.errors.push({ userId: user.id, error: `WebPush: ${err.message}` });
      }
    }

    if (!touched) results.skipped++;
  }
  return jsonResponse({ success: true, total: users.length, ...results });
}
// ── Cron 엔드포인트 ─────────────────────────────────────────
async function handleNotifyCron(request, env) {
  /* CRON_SECRET 인증.
     전에는 어느 경우든 똑같이 Unauthorized 만 돌려줘서, 외부 스케줄러가
     401 로 계속 실패해도 "헤더를 안 보낸 건지 값이 틀린 건지"를 알 수 없었다.
     실제로 cron-job.org 가 26번 연속 실패한 뒤 자동 중지된 일이 있었다.
     비밀은 드러내지 않으면서 어느 쪽인지만 구분해 준다. */
  const authHeader = request.headers.get('Authorization') || '';
  const cronSecret = (env.CRON_SECRET || '').trim();

  if (!cronSecret) {
    return jsonResponse({
      error: 'Unauthorized', reason: 'server_secret_missing',
      hint: 'Cloudflare Pages 에 CRON_SECRET 이 설정되지 않았습니다. 설정 후 재배포가 필요합니다.',
    }, 401);
  }
  if (!authHeader) {
    return jsonResponse({
      error: 'Unauthorized', reason: 'missing_authorization_header',
      hint: '요청에 Authorization 헤더가 없습니다. Authorization: Bearer <CRON_SECRET> 를 보내세요.',
    }, 401);
  }
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({
      error: 'Unauthorized', reason: 'missing_bearer_prefix',
      hint: 'Authorization 값은 Bearer 로 시작해야 합니다. 예: Bearer abc123',
    }, 401);
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    /* 길이만 알려 준다. 값을 비교해 줄 수는 없지만, 붙여넣기가 잘렸는지
       공백이 섞였는지는 이것만으로도 대개 드러난다. */
    return jsonResponse({
      error: 'Unauthorized', reason: 'secret_mismatch',
      sent_length: authHeader.slice(7).trim().length,
      expected_length: cronSecret.length,
      hint: '보낸 값이 서버의 CRON_SECRET 과 다릅니다. 길이가 같다면 앞뒤 공백이나 줄바꿈을 확인하세요.',
    }, 401);
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
      SELECT id, name, notify_enabled, notify_hour, notify_days
      FROM users WHERE notify_enabled = 1
    `).all();
    debugUsers = dbg.results || [];
  } catch (_) {}

  // 이 시각 알림 설정 사용자 조회 (refresh_token 조건 완화)
  let users;
  try {
    const result = await env.DB.prepare(`
      SELECT id, name, email, email_enabled, notify_days,
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
      "SELECT chapter_id, part_id, slug, title, hook, anchor_quote, body_md, action, quotable, hero_image, updated_at, published_at FROM insights WHERE status = 'published'"
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

  const results = { push_sent: 0, email_sent: 0, skipped: 0, errors: [] };

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

    // ── Web Push 알림 (독립적) ──
    if (user.push_endpoint && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      try {
        await sendWebPushToUser(env, user,
          {
            title: wisdomItem.column ? wisdomItem.title : '📚 오늘의 Daily Wisdom',
            body:  wisdomItem.column ? wisdomItem.column.title : wisdomItem.title,
            url:   pushUrl,
          }
        );
        results.push_sent++;
        await recordSend(env, {
          channel: 'push', kind: 'issue', status: 'ok',
          user_id: user.id, user_name: user.name, user_email: user.email,
          chapter_id: (wisdomItem && wisdomItem.column && wisdomItem.column.chapter_id) || null,
        });
      } catch (pushErr) {
        results.errors.push({ userId: user.id, error: `WebPush: ${pushErr.message}` });
        await recordSend(env, {
          channel: 'push', kind: 'issue', status: 'failed',
          user_id: user.id, user_name: user.name, user_email: user.email,
          error: pushErr.message,
        });
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

// ── 공유용 동적 이미지 (SVG 직접 반환) ────
function handleWisdomCard(request) {
  const url = new URL(request.url);
  const text = (url.searchParams.get('t') || '오늘의 한 문장').slice(0, 60);
  const square = url.searchParams.get('sq') === '1'; // 인스타용 정사각형
  const wide   = url.searchParams.get('wide') === '1';  // 링크 미리보기용 800×400

  const W = square ? 1080 : (wide ? 800 : 1200);
  const H = square ? 1080 : (wide ? 400 : 630);
  const cx = W / 2;

  // 어절(공백) 단위 줄바꿈 — 한 줄에 들어가면 1줄, 길면 단어 경계에서 분리
  const maxLineLen = square ? 10 : (wide ? 14 : 15);
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
    : wide
      ? (lines.length <= 2 ? 38 : lines.length <= 3 ? 32 : 28)
      : (lines.length <= 2 ? 58 : lines.length <= 3 ? 50 : 42);
  const lineH = fontSize * 1.55;
  const totalTextH = lines.length * lineH;

  // 헤더 높이 비율 조정
  const headerH = square ? 340 : (wide ? 110 : 200);
  const areaTop = headerH + (wide ? 20 : 30);
  const areaBot = H - (wide ? 44 : 60);
  const textStartY = areaTop + (areaBot - areaTop - totalTextH) / 2 + fontSize * 0.85;

  // 헤더 텍스트 크기
  const titleSize    = square ? 88 : (wide ? 44 : 68);
  const subtitleSize = square ? 34 : (wide ? 17 : 26);
  const titleY       = square ? 160 : (wide ? 62 : 105);
  const subtitleY    = square ? 230 : (wide ? 92 : 152);
  const lineY        = square ? 280 : (wide ? 110 : 185);
  const lineX1       = square ? 120 : (wide ? 60 : 100);
  const lineX2       = square ? 960 : (wide ? 740 : 1100);

  const tspans = lines.map((l, i) =>
    `<tspan x="${cx}" dy="${i === 0 ? 0 : lineH}">${escSvg(l)}</tspan>`
  ).join('');

  // 정사각/와이드용: 하단 URL 표시
  const urlText = (square || wide)
    ? `<text x="${cx}" y="${H - (wide ? 14 : 60)}" font-family="Georgia,serif" font-size="${wide ? 16 : 30}" fill="#c9a96e" text-anchor="middle" opacity="0.7">99wisdombook.org</text>`
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
    const err = new Error(`${res.status} ${txt.slice(0, 200)}`);
    err.statusCode = res.status;
    throw err;
  }
  return res.status;
}

/* 구독이 만료되면 푸시 서비스가 404/410 을 돌려준다. 그대로 두면 같은
   사용자에게서 같은 실패가 매일 쌓이고, 관리 화면의 발송 실패도 줄지
   않는다. 만료가 확인되면 구독 정보를 지워 다음부터 건너뛰게 한다. */
async function sendWebPushToUser(env, user, payload) {
  try {
    return await sendWebPush(
      user.push_endpoint, user.push_p256dh, user.push_auth, payload,
      env.VAPID_PRIVATE_KEY.trim(), env.VAPID_PUBLIC_KEY.trim(),
      (env.VAPID_SUBJECT || 'mailto:info@99wisdombook.org').trim()
    );
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      try {
        await env.DB.prepare(
          'UPDATE users SET push_endpoint = NULL, push_p256dh = NULL, push_auth = NULL WHERE id = ?'
        ).bind(user.id).run();
        err.message += ' — 만료된 구독이라 삭제했습니다';
      } catch (_) {}
    }
    throw err;
  }
}

// ── Web Push 구독 관리 ──────────────────────────────────────────

async function handlePushSubscribe(request, env) {
  const body = await request.json().catch(() => ({}));
  const tokenUserId = await readerId(request, env, body);
  if (!tokenUserId) return jsonResponse({ error: 'Unauthorized' }, 401);
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
  const tokenUserId = await readerId(request, env, null);
  if (!tokenUserId) return jsonResponse({ error: 'Unauthorized' }, 401);
  try {
    await env.DB.prepare(
      'UPDATE users SET push_endpoint=NULL, push_p256dh=NULL, push_auth=NULL WHERE id=?'
    ).bind(tokenUserId).run();
  } catch (_) {}
  return jsonResponse({ success: true });
}

async function handlePushTest(request, env) {
  const tokenUserId = await readerId(request, env, null);
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
  const tokenUserId = await readerId(request, env, null);
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
