import * as crypto from 'node:crypto';
import * as path from 'node:path';
import Database from 'better-sqlite3';

const DB_PATH = path.join(process.cwd(), 'users.db');
const SCRYPT_KEYLEN = 64;

export interface User {
  id: number;
  name: string;
  apiKeys: string[];
  isAdmin: boolean;
  targetUrl: string;
}

export interface CreateUserInput {
  name: string;
  password: string;
  apiKeys?: string[];
  isAdmin?: boolean;
  targetUrl?: string;
}

export interface UpdateUserInput {
  name?: string;
  password?: string;
  apiKeys?: string[];
  isAdmin?: boolean;
  targetUrl?: string;
}

interface UserRow {
  id: number;
  name: string;
  password_hash: string;
  api_keys: string;
  is_admin: number;
  target_url: string;
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

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    apiKeys: JSON.parse(row.api_keys) as string[],
    isAdmin: row.is_admin === 1,
    targetUrl: row.target_url,
  };
}

export function createUser(input: CreateUserInput): User {
  const stmt = db.prepare(
    'INSERT INTO users (name, password_hash, api_keys, is_admin, target_url) VALUES (?, ?, ?, ?, ?)'
  );
  const info = stmt.run(
    input.name,
    hashPassword(input.password),
    JSON.stringify(input.apiKeys ?? []),
    input.isAdmin ? 1 : 0,
    input.targetUrl ?? ''
  );
  const user = getUserById(Number(info.lastInsertRowid));
  if (!user) throw new Error('failed to read created user');
  return user;
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

export function verifyPasswordById(id: number, password: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!row) return null;
  return verifyHash(password, row.password_hash) ? rowToUser(row) : null;
}

export function verifyPasswordByName(name: string, password: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE name = ?').get(name) as UserRow | undefined;
  if (!row) return null;
  return verifyHash(password, row.password_hash) ? rowToUser(row) : null;
}
