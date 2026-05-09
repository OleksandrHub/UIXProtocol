import Database from 'better-sqlite3';

import { DB_PATH } from './constants';

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    api_keys TEXT NOT NULL DEFAULT '[]',
    is_admin INTEGER NOT NULL DEFAULT 0,
    target_url TEXT NOT NULL DEFAULT ''
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
