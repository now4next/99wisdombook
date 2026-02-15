-- D1 Database Schema for 99 Wisdom Book
-- This schema defines the users table with all necessary fields

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin')),
    permissions TEXT DEFAULT '[]', -- JSON array: ["english", "chinese", etc.]
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- Create index on username for faster lookups
CREATE INDEX IF NOT EXISTS idx_username ON users(username);

-- Create index on role for admin queries
CREATE INDEX IF NOT EXISTS idx_role ON users(role);

-- Insert default admin user (password: admin123 - should be changed!)
-- Password is SHA-256 hash of "admin123"
INSERT INTO users (username, password, name, email, role, permissions) 
VALUES (
    'admin',
    '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
    'Administrator',
    'admin@99wisdombook.org',
    'admin',
    '["korean", "english", "chinese", "japanese", "spanish", "french", "arabic", "russian"]'
) ON CONFLICT(username) DO NOTHING;
