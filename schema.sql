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
    saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_wisdom(user_id);

INSERT INTO users (username, password, name, email, role, permissions)
VALUES (
    'admin',
    '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
    'Administrator',
    'admin@99wisdombook.org',
    'admin',
    '["korean","english","chinese","japanese","spanish","french","arabic","russian"]'
) ON CONFLICT(username) DO NOTHING;
