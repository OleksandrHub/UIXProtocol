import { decrypt, encrypt } from '../db/cipher';
import { db } from '../db/connection';
import { firstChar, hashPassword, safeParseArray, verifyHash } from '../db/crypto';
import type {
  CreateUserInput,
  UpdateUserInput,
  User,
  UserPrompt,
  UserRow,
} from '../shared/types';

const USER_CACHE_TTL_MS = 30_000;
const userCache = new Map<number, { user: User; expiresAt: number }>();

function readCache(id: number): User | null {
  const entry = userCache.get(id);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    userCache.delete(id);
    return null;
  }
  return entry.user;
}

function writeCache(user: User): void {
  userCache.set(user.id, { user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
}

function invalidateCache(id: number): void {
  userCache.delete(id);
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    apiKeys: safeParseArray<string>(decrypt(row.api_keys)),
    isAdmin: row.is_admin === 1,
    targetUrl: decrypt(row.target_url),
    prompts: safeParseArray<UserPrompt>(row.prompts),
    activePromptId: row.active_prompt_id ?? '',
    enabledModels: safeParseArray<string>(row.enabled_models),
    activeModel: row.active_model ?? '',
    archiveQuestions: row.archive_questions !== 0,
    devTools: row.dev_tools !== 0,
  };
}

export function createUser(input: CreateUserInput): User {
  const insert = db.prepare(
    'INSERT INTO users (name, password_hash, password_first, api_keys, is_admin, target_url) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const create = db.transaction((payload: CreateUserInput) => {
    const info = insert.run(
      payload.name,
      hashPassword(payload.password),
      encrypt(firstChar(payload.password)),
      encrypt(JSON.stringify(payload.apiKeys ?? [])),
      payload.isAdmin ? 1 : 0,
      encrypt(payload.targetUrl ?? ''),
    );
    const user = getUserById(Number(info.lastInsertRowid));
    if (!user) throw new Error('failed to read created user');
    return user;
  });
  return create(input);
}

export function updateUser(id: number, input: UpdateUserInput): User | null {
  invalidateCache(id);
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
    params.push(encrypt(firstChar(input.password)));
  }
  if (input.apiKeys !== undefined) {
    sets.push('api_keys = ?');
    params.push(encrypt(JSON.stringify(input.apiKeys)));
  }
  if (input.isAdmin !== undefined) {
    sets.push('is_admin = ?');
    params.push(input.isAdmin ? 1 : 0);
  }
  if (input.targetUrl !== undefined) {
    sets.push('target_url = ?');
    params.push(encrypt(input.targetUrl));
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
  if (input.archiveQuestions !== undefined) {
    sets.push('archive_questions = ?');
    params.push(input.archiveQuestions ? 1 : 0);
  }
  if (input.devTools !== undefined) {
    sets.push('dev_tools = ?');
    params.push(input.devTools ? 1 : 0);
  }
  if (!sets.length) return getUserById(id);
  params.push(id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getUserById(id);
}

export function getUserById(id: number): User | null {
  const cached = readCache(id);
  if (cached) return cached;
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!row) return null;
  const user = rowToUser(row);
  writeCache(user);
  return user;
}

export function getUserByName(name: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE name = ?').get(name) as UserRow | undefined;
  if (!row) return null;
  const user = rowToUser(row);
  writeCache(user);
  return user;
}

export function listUsers(): User[] {
  const rows = db.prepare('SELECT * FROM users ORDER BY id').all() as UserRow[];
  return rows.map(rowToUser);
}

export function deleteUser(id: number): boolean {
  invalidateCache(id);
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return info.changes > 0;
}

function backfillFirstChar(row: UserRow, password: string): void {
  if (row.password_first) return;
  const fc = firstChar(password);
  if (!fc) return;
  db.prepare('UPDATE users SET password_first = ? WHERE id = ?').run(encrypt(fc), row.id);
  invalidateCache(row.id);
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
  return decrypt(row.password_first) === char ? rowToUser(row) : null;
}
