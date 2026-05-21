import * as crypto from 'node:crypto';

import { db } from '../db/connection';
import type { UploadedFile } from '../shared/types';

function hashKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 32);
}

interface UploadRow {
  uri: string;
  mime_type: string;
  expires_at: number;
}

export function getStoredUpload(apiKey: string, fileId: number): UploadedFile | null {
  const row = db
    .prepare(
      'SELECT uri, mime_type, expires_at FROM gemini_uploads WHERE api_key_hash = ? AND file_id = ?',
    )
    .get(hashKey(apiKey), fileId) as UploadRow | undefined;
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM gemini_uploads WHERE api_key_hash = ? AND file_id = ?').run(
      hashKey(apiKey),
      fileId,
    );
    return null;
  }
  return { uri: row.uri, mimeType: row.mime_type, expiresAt: row.expires_at };
}

export function saveStoredUpload(
  apiKey: string,
  fileId: number,
  entry: UploadedFile,
): void {
  db.prepare(
    `INSERT INTO gemini_uploads (api_key_hash, file_id, uri, mime_type, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(api_key_hash, file_id) DO UPDATE SET
       uri = excluded.uri,
       mime_type = excluded.mime_type,
       expires_at = excluded.expires_at`,
  ).run(hashKey(apiKey), fileId, entry.uri, entry.mimeType, entry.expiresAt);
}

export function dropStoredCacheForKey(apiKey: string): void {
  db.prepare('DELETE FROM gemini_uploads WHERE api_key_hash = ?').run(hashKey(apiKey));
}

export function dropStoredUploadsByFileIds(fileIds: number[]): void {
  if (!fileIds.length) return;
  const placeholders = fileIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM gemini_uploads WHERE file_id IN (${placeholders})`).run(...fileIds);
}

export function getStoredCachedFileIds(apiKey: string): Set<number> {
  const now = Date.now();
  db.prepare('DELETE FROM gemini_uploads WHERE expires_at <= ?').run(now);
  const rows = db
    .prepare('SELECT file_id FROM gemini_uploads WHERE api_key_hash = ?')
    .all(hashKey(apiKey)) as Array<{ file_id: number }>;
  return new Set(rows.map((r) => r.file_id));
}
