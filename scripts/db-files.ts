import { db } from './db-connection';
import type { UserFile, UserFileMeta, UserFileRow } from './types';

function nextFileId(): number {
  // Pick the smallest free positive id so deletes free IDs are reused.
  const row = db
    .prepare(
      `SELECT MIN(candidate) AS id
       FROM (
         SELECT 1 AS candidate
         UNION ALL
         SELECT id + 1 FROM user_files
       ) candidates
       WHERE NOT EXISTS (SELECT 1 FROM user_files f WHERE f.id = candidates.candidate)`,
    )
    .get() as { id: number | null };
  return Number(row?.id ?? 1);
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
      'SELECT id, user_id, name, mime, size, created_at FROM user_files WHERE user_id = ? ORDER BY id',
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
  data: Buffer,
): UserFileMeta {
  const insert = db.prepare(
    'INSERT INTO user_files (id, user_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const create = db.transaction((): UserFileMeta => {
    const id = nextFileId();
    insert.run(id, userId, name, mime, data.length, data, Date.now());
    const row = db
      .prepare('SELECT id, user_id, name, mime, size, created_at FROM user_files WHERE id = ?')
      .get(id) as UserFileRow;
    return rowToFileMeta(row);
  });
  return create();
}

export function deleteUserFile(userId: number, fileId: number): boolean {
  const info = db
    .prepare('DELETE FROM user_files WHERE id = ? AND user_id = ?')
    .run(fileId, userId);
  return info.changes > 0;
}
