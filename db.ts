import * as crypto from 'node:crypto';
import Database from 'better-sqlite3';

import { DB_PATH, SCRYPT_KEYLEN } from './models/constants';
import type {
  CreateUserInput,
  UpdateUserInput,
  User,
  UserFile,
  UserFileMeta,
  UserPrompt,
} from './models/types';

interface UserRow {
  id: number;
  name: string;
  password_hash: string;
  password_first: string;
  api_keys: string;
  is_admin: number;
  target_url: string;
  prompts: string;
  active_prompt_id: string;
  enabled_models: string;
  active_model: string;
}

const db = new Database(DB_PATH);
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

const userCols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
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

function firstChar(s: string): string {
  return [...s][0] ?? '';
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyHash(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function safeParseArray<T>(s: string): T[] {
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function rowToUser(row: UserRow): User {
  const prompts = safeParseArray<UserPrompt>(row.prompts);
  const enabledModels = safeParseArray<string>(row.enabled_models);
  return {
    id: row.id,
    name: row.name,
    apiKeys: safeParseArray<string>(row.api_keys),
    isAdmin: row.is_admin === 1,
    targetUrl: row.target_url,
    prompts,
    activePromptId: row.active_prompt_id ?? '',
    enabledModels,
    activeModel: row.active_model ?? '',
  };
}

function nextUserId(): number {
  // Pick the smallest free positive id so deletes free IDs are reused.
  const row = db
    .prepare(
      `SELECT MIN(candidate) AS id
       FROM (
         SELECT 1 AS candidate
         UNION ALL
         SELECT id + 1 FROM users
       ) candidates
       WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = candidates.candidate)`
    )
    .get() as { id: number | null };
  return Number(row?.id ?? 1);
}

export function createUser(input: CreateUserInput): User {
  const insert = db.prepare(
    'INSERT INTO users (id, name, password_hash, password_first, api_keys, is_admin, target_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const create = db.transaction((payload: CreateUserInput) => {
    const id = nextUserId();
    insert.run(
      id,
      payload.name,
      hashPassword(payload.password),
      firstChar(payload.password),
      JSON.stringify(payload.apiKeys ?? []),
      payload.isAdmin ? 1 : 0,
      payload.targetUrl ?? ''
    );
    const user = getUserById(id);
    if (!user) throw new Error('failed to read created user');
    return user;
  });
  return create(input);
}

export function updateUser(id: number, input: UpdateUserInput): User | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    params.push(input.name);
  }
  if (input.password !== undefined && input.password !== '') {
    sets.push('password_hash = ?');
    params.push(hashPassword(input.password));
    sets.push('password_first = ?');
    params.push(firstChar(input.password));
  }
  if (input.apiKeys !== undefined) {
    sets.push('api_keys = ?');
    params.push(JSON.stringify(input.apiKeys));
  }
  if (input.isAdmin !== undefined) {
    sets.push('is_admin = ?');
    params.push(input.isAdmin ? 1 : 0);
  }
  if (input.targetUrl !== undefined) {
    sets.push('target_url = ?');
    params.push(input.targetUrl);
  }
  if (input.prompts !== undefined) {
    sets.push('prompts = ?');
    params.push(JSON.stringify(input.prompts));
  }
  if (input.activePromptId !== undefined) {
    sets.push('active_prompt_id = ?');
    params.push(input.activePromptId);
  }
  if (input.enabledModels !== undefined) {
    sets.push('enabled_models = ?');
    params.push(JSON.stringify(input.enabledModels));
  }
  if (input.activeModel !== undefined) {
    sets.push('active_model = ?');
    params.push(input.activeModel);
  }
  if (!sets.length) return getUserById(id);
  params.push(id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getUserById(id);
}

export function getUserById(id: number): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function getUserByName(name: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE name = ?').get(name) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function listUsers(): User[] {
  const rows = db.prepare('SELECT * FROM users ORDER BY id').all() as UserRow[];
  return rows.map(rowToUser);
}

export function deleteUser(id: number): boolean {
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return info.changes > 0;
}

function backfillFirstChar(row: UserRow, password: string): void {
  if (row.password_first) return;
  const fc = firstChar(password);
  if (!fc) return;
  db.prepare('UPDATE users SET password_first = ? WHERE id = ?').run(fc, row.id);
}

export function verifyPasswordById(id: number, password: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!row) return null;
  if (!verifyHash(password, row.password_hash)) return null;
  backfillFirstChar(row, password);
  return rowToUser(row);
}

export function verifyPasswordByName(name: string, password: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE name = ?').get(name) as UserRow | undefined;
  if (!row) return null;
  if (!verifyHash(password, row.password_hash)) return null;
  backfillFirstChar(row, password);
  return rowToUser(row);
}

export function verifyFirstCharById(id: number, char: string): User | null {
  if (!char) return null;
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!row || !row.password_first) return null;
  return row.password_first === char ? rowToUser(row) : null;
}

interface UserFileRow {
  id: number;
  user_id: number;
  name: string;
  mime: string;
  size: number;
  data: Buffer;
  created_at: number;
}

function rowToFileMeta(row: UserFileRow): UserFileMeta {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    createdAt: row.created_at,
  };
}

export function listUserFiles(userId: number): UserFileMeta[] {
  const rows = db
    .prepare(
      'SELECT id, user_id, name, mime, size, created_at FROM user_files WHERE user_id = ? ORDER BY id'
    )
    .all(userId) as UserFileRow[];
  return rows.map(rowToFileMeta);
}

export function getUserFile(userId: number, fileId: number): UserFile | null {
  const row = db
    .prepare('SELECT * FROM user_files WHERE id = ? AND user_id = ?')
    .get(fileId, userId) as UserFileRow | undefined;
  if (!row) return null;
  return { ...rowToFileMeta(row), data: row.data };
}

export function getUserFiles(userId: number): UserFile[] {
  const rows = db
    .prepare('SELECT * FROM user_files WHERE user_id = ? ORDER BY id')
    .all(userId) as UserFileRow[];
  return rows.map((row) => ({ ...rowToFileMeta(row), data: row.data }));
}

export function addUserFile(
  userId: number,
  name: string,
  mime: string,
  data: Buffer
): UserFileMeta {
  const info = db
    .prepare(
      'INSERT INTO user_files (user_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(userId, name, mime, data.length, data, Date.now());
  const row = db
    .prepare('SELECT id, user_id, name, mime, size, created_at FROM user_files WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as UserFileRow;
  return rowToFileMeta(row);
}

export function deleteUserFile(userId: number, fileId: number): boolean {
  const info = db
    .prepare('DELETE FROM user_files WHERE id = ? AND user_id = ?')
    .run(fileId, userId);
  return info.changes > 0;
}
