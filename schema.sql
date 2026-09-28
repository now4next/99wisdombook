-- D1 Database Schema for 99 Wisdom Book
-- Complete schema (original + Phase 2/3 additions)

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin')),
    permissions TEXT DEFAULT '[]',
    streak_count INTEGER DEFAULT 0,
    last_wisdom_date TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

CREATE TABLE IF NOT EXISTS saved_wisdom (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chapter_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    memo TEXT,
    saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, chapter_id)
);

CREATE TABLE IF NOT EXISTS login_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    user_email TEXT,
    login_type TEXT DEFAULT 'local',
    ip_address TEXT,
    logged_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 칼럼(insights) — 9부 99장 × 10렌즈로 발행되는 글
-- 앱 기동 시 API가 CREATE TABLE IF NOT EXISTS로 자동 생성하므로 별도 마이그레이션 불필요
CREATE TABLE IF NOT EXISTS insights (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id    INTEGER NOT NULL,          -- 1~99 (앵커 장)
    part_id       INTEGER NOT NULL,          -- 1~9
    lens          TEXT NOT NULL,             -- origin|science|history|person|business
                                             -- |daily|counter|eastwest|practice|reflection
    slug          TEXT UNIQUE NOT NULL,
    title         TEXT NOT NULL,
    hook          TEXT,
    anchor_quote  TEXT,                      -- 99장 원문
    body_md       TEXT,
    action        TEXT,
    quotable      TEXT,                      -- 공유 카드용 한 줄 (발행 필수)
    hero_image    TEXT,
    reading_time  INTEGER,
    tags          TEXT,                      -- JSON 배열
    sources       TEXT,                      -- JSON 배열 (발행 시 1개 이상 필수)
    status        TEXT DEFAULT 'draft',      -- draft|review|scheduled|published
    scheduled_for TEXT,
    published_at  TEXT,
    author        TEXT,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 이메일 뉴스레터. API 가 필요 시 ALTER TABLE 로 자동 추가하므로 별도 마이그레이션은 없다.
--   email_enabled     : 1 이면 알림 시각에 오늘의 칼럼을 메일로도 보낸다
--   unsubscribe_token : 로그인 없이 해지할 수 있어야 해서 사용자마다 두는 32자 hex
-- ALTER TABLE users ADD COLUMN email_enabled INTEGER DEFAULT 0;
-- ALTER TABLE users ADD COLUMN unsubscribe_token TEXT;

-- 로그인 세션. API가 필요 시 자동 생성하므로 별도 마이그레이션은 필요 없다.
-- token_hash 는 클라이언트가 가진 64자 hex 토큰의 SHA-256 이며, 원본은 저장하지 않는다.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_insights_status  ON insights(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_chapter ON insights(chapter_id);

CREATE INDEX IF NOT EXISTS idx_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_wisdom(user_id);
CREATE INDEX IF NOT EXISTS idx_login_logs_at ON login_logs(logged_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id);

-- 발송 기록.
-- 이메일·푸시가 실제로 나갔는지를 되짚기 위한 표다. 성공과 실패를 모두 남긴다.
--   channel  email | push
--   kind     issue | reminder | weekly | admin_test | admin_sample | diag_check | diag_sample
--   status   ok | failed
-- 앱에서 ensureSendLogTable() 이 같은 정의로 자동 생성하므로 둘은 같아야 한다.
CREATE TABLE IF NOT EXISTS send_logs (
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
);
CREATE INDEX IF NOT EXISTS idx_send_logs_sent ON send_logs(sent_at DESC);

-- ⚠ 초기 관리자 계정.
-- password 는 PBKDF2-SHA256 해시다. 형식은 pbkdf2$<반복 횟수>$<소금 b64>$<해시 b64>.
-- (구버전인 64자리 SHA-256 16진 문자열도 로그인은 되지만, 성공하는 순간
--  새 형식으로 다시 저장된다. 새로 넣을 때는 아래 명령을 쓸 것.)
-- 예전에는 흔한 기본 비밀번호의 해시가 이 파일에 그대로 적혀 있었고, schema.sql 이
-- 사이트에서 그대로 내려받히고 있어 사실상 공개된 자격증명이었다.
-- 실제 값은 저장소에 두지 말고, 아래처럼 직접 만들어 넣을 것.
--   node -e "const s=crypto.getRandomValues(new Uint8Array(16));crypto.subtle.importKey('raw',new TextEncoder().encode(process.argv[1]),'PBKDF2',false,['deriveBits']).then(k=>crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:s,iterations:100000},k,256)).then(b=>console.log('pbkdf2$100000$'+Buffer.from(s).toString('base64')+'$'+Buffer.from(b).toString('base64')))" '새비밀번호'
INSERT INTO users (username, password, name, email, role, permissions)
VALUES (
    'admin',
    'CHANGE_ME_PBKDF2_HASH',  -- ⚠ 실제 해시를 이 파일에 적지 말 것 (위 주석 참고)
    'Administrator',
    'admin@99wisdombook.org',
    'admin',
    '["korean","english","chinese","japanese","spanish","french","arabic","russian"]'
) ON CONFLICT(username) DO NOTHING;
