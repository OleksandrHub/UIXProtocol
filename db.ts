import * as path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';

const DB_PATH = path.join(process.cwd(), 'users.db');
const SALT_ROUNDS = 10;

export interface User {
  id: number;
  name: string;
  apiKeys: string[];
  isAdmin: boolean;
}

export interface CreateUserInput {
  name: string;
  password: string;
  apiKeys?: string[];
  isAdmin?: boolean;
}

interface UserRow {
  id: number;
  name: string;
  password_hash: string;
  api_keys: string;
  is_admin: number;
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    api_keys TEXT NOT NULL DEFAULT '[]',
    is_admin INTEGER NOT NULL DEFAULT 0
  );
`);

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    apiKeys: JSON.parse(row.api_keys) as string[],
    isAdmin: row.is_admin === 1,
  };
}

export function createUser(input: CreateUserInput): User {
  const hash = bcrypt.hashSync(input.password, SALT_ROUNDS);
  const stmt = db.prepare(
    'INSERT INTO users (name, password_hash, api_keys, is_admin) VALUES (?, ?, ?, ?)'
  );
  const info = stmt.run(
    input.name,
    hash,
    JSON.stringify(input.apiKeys ?? []),
    input.isAdmin ? 1 : 0
  );
  const user = getUserById(Number(info.lastInsertRowid));
  if (!user) throw new Error('failed to read created user');
  return user;
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

export function verifyPassword(name: string, password: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE name = ?').get(name) as UserRow | undefined;
  if (!row) return null;
  return bcrypt.compareSync(password, row.password_hash) ? rowToUser(row) : null;
}
