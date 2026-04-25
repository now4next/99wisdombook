-- Migration: Phase 2 (보관함) + Phase 3 (스트릭)
-- Cloudflare D1 대시보드 > wisdom-book-db > Console 탭에서 아래 SQL을 한 줄씩 실행
-- (이미 실행된 줄은 오류가 나도 무시해도 됩니다)

ALTER TABLE users ADD COLUMN streak_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN last_wisdom_date TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS saved_wisdom (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chapter_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_wisdom(user_id);
