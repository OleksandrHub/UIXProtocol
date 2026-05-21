import { decrypt, encrypt } from '../db/cipher';
import { db } from '../db/connection';
import type { GeminiError, GeminiErrorRow } from '../shared/types';

interface JoinedRow extends GeminiErrorRow {
  user_name: string | null;
}

function rowToError(row: JoinedRow): GeminiError {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name ?? `#${row.user_id}`,
    model: row.model,
    apiKeyHint: decrypt(row.api_key_hint),
    message: decrypt(row.message),
    createdAt: row.created_at,
  };
}

export function addGeminiError(
  userId: number,
  model: string,
  apiKeyHint: string,
  message: string,
): void {
  db.prepare(
    `INSERT INTO gemini_errors (user_id, model, api_key_hint, message, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    userId,
    model ?? '',
    encrypt(apiKeyHint ?? ''),
    encrypt(message ?? ''),
    Date.now(),
  );
}

export function listGeminiErrors(limit = 200): GeminiError[] {
  const rows = db
    .prepare(
      `SELECT e.id, e.user_id, e.model, e.api_key_hint, e.message, e.created_at,
              u.name AS user_name
       FROM gemini_errors e
       LEFT JOIN users u ON u.id = e.user_id
       ORDER BY e.id DESC
       LIMIT ?`,
    )
    .all(Math.max(1, Math.min(1000, limit))) as JoinedRow[];
  return rows.map(rowToError);
}

export function deleteGeminiError(id: number): boolean {
  const info = db.prepare('DELETE FROM gemini_errors WHERE id = ?').run(id);
  return info.changes > 0;
}

export function clearGeminiErrors(): number {
  const info = db.prepare('DELETE FROM gemini_errors').run();
  return info.changes;
}

const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

export function pruneOldGeminiErrors(): number {
  const cutoff = Date.now() - RETAIN_MS;
  const info = db.prepare('DELETE FROM gemini_errors WHERE created_at < ?').run(cutoff);
  return info.changes;
}
