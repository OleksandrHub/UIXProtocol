import Database from 'better-sqlite3';

import { DB_PATH } from '../shared/constants';

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    api_keys TEXT NOT NULL DEFAULT '[]',
    is_admin INTEGER NOT NULL DEFAULT 0,
    target_url TEXT NOT NULL DEFAULT '',
    last_seen INTEGER NOT NULL DEFAULT 0
  );
`);

const userCols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
const hasCol = (name: string): boolean => userCols.some((c) => c.name === name);
if (!hasCol('password_first')) {
  db.exec("ALTER TABLE users ADD COLUMN password_first TEXT NOT NULL DEFAULT ''");
}
if (!hasCol('prompts')) {
  db.exec("ALTER TABLE users ADD COLUMN prompts TEXT NOT NULL DEFAULT '[]'");
}
if (!hasCol('active_prompt_id')) {
  db.exec("ALTER TABLE users ADD COLUMN active_prompt_id TEXT NOT NULL DEFAULT ''");
}
if (!hasCol('enabled_models')) {
  db.exec("ALTER TABLE users ADD COLUMN enabled_models TEXT NOT NULL DEFAULT '[]'");
}
if (!hasCol('active_model')) {
  db.exec("ALTER TABLE users ADD COLUMN active_model TEXT NOT NULL DEFAULT ''");
}
if (!hasCol('archive_questions')) {
  db.exec('ALTER TABLE users ADD COLUMN archive_questions INTEGER NOT NULL DEFAULT 1');
}
if (!hasCol('dev_tools')) {
  db.exec('ALTER TABLE users ADD COLUMN dev_tools INTEGER NOT NULL DEFAULT 0');
}
if (!hasCol('last_seen')) {
  db.exec('ALTER TABLE users ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS user_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_user_files_user ON user_files(user_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_appearance (
    user_id INTEGER PRIMARY KEY,
    data TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    image BLOB NOT NULL,
    mime TEXT NOT NULL DEFAULT 'image/jpeg',
    question TEXT NOT NULL DEFAULT '',
    options TEXT NOT NULL DEFAULT '[]',
    correct_answer TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_user_questions_user ON user_questions(user_id);
`);

const questionCols = db
  .prepare('PRAGMA table_info(user_questions)')
  .all() as Array<{ name: string }>;
if (!questionCols.some((c) => c.name === 'tags')) {
  db.exec("ALTER TABLE user_questions ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS friend_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asker_id INTEGER NOT NULL,
    helper_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (asker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (helper_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (asker_id, helper_id)
  );
  CREATE INDEX IF NOT EXISTS idx_friends_asker ON friend_connections(asker_id);
  CREATE INDEX IF NOT EXISTS idx_friends_helper ON friend_connections(helper_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS gemini_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    api_key_hint TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_gemini_errors_created ON gemini_errors(created_at DESC);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS gemini_uploads (
    api_key_hash TEXT NOT NULL,
    file_id INTEGER NOT NULL,
    uri TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (api_key_hash, file_id),
    FOREIGN KEY (file_id) REFERENCES user_files(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_gemini_uploads_file ON gemini_uploads(file_id);
  CREATE INDEX IF NOT EXISTS idx_gemini_uploads_key ON gemini_uploads(api_key_hash);
`);
