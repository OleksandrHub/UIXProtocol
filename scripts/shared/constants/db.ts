import * as path from 'node:path';

export const DB_PATH = path.join(process.cwd(), 'users.db');
export const DB_KEY_PATH = path.join(process.cwd(), 'db-secret.key');
export const DB_KEY_ENV = 'UIX_DB_KEY';
export const PUBLIC_DIR = path.join(process.cwd(), 'public');
export const PAGES_DIR = path.join(process.cwd(), 'pages');

// AES-256-GCM parameters used by `db/cipher.ts` for field-level column
// encryption. PREFIX tags the string form, MAGIC tags the binary BLOB form;
// IV_LEN/TAG_LEN are the GCM-standard nonce/auth-tag sizes (don't change
// without writing a migration — existing rows decode against these exact
// values).
export const CIPHER_ALGO = 'aes-256-gcm';
export const CIPHER_PREFIX = 'enc:v1:';
export const CIPHER_IV_LEN = 12;
export const CIPHER_TAG_LEN = 16;
export const CIPHER_BLOB_MAGIC = Buffer.from([0x55, 0x49, 0x58, 0x01]); // "UIX\x01"

// In-memory cache TTL for `getUserById`. 30s is short enough that role/target
// changes propagate quickly through the iframe lifetime, long enough to absorb
// the per-request lookup burst from each proxied subresource.
export const USER_CACHE_TTL_MS = 30_000;

// How long Gemini error rows stick around before `pruneOldGeminiErrors` deletes
// them on the daily janitor pass.
export const GEMINI_ERROR_RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

// Shared SELECT prefix for friend-connections queries: joins each row with the
// asker and helper user names so callers don't need a second query per row.
export const FRIEND_JOIN_SQL = `
  SELECT c.*, a.name AS asker_name, h.name AS helper_name
  FROM friend_connections c
  LEFT JOIN users a ON a.id = c.asker_id
  LEFT JOIN users h ON h.id = c.helper_id
`;
