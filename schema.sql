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

CREATE INDEX IF NOT EXISTS idx_insights_status  ON insights(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_chapter ON insights(chapter_id);

CREATE INDEX IF NOT EXISTS idx_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_wisdom(user_id);
CREATE INDEX IF NOT EXISTS idx_login_logs_at ON login_logs(logged_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id);

INSERT INTO users (username, password, name, email, role, permissions)
VALUES (
    'admin',
    '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
    'Administrator',
    'admin@99wisdombook.org',
    'admin',
    '["korean","english","chinese","japanese","spanish","french","arabic","russian"]'
) ON CONFLICT(username) DO NOTHING;
