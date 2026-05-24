import * as path from 'node:path';

export const DB_PATH = path.join(process.cwd(), 'users.db');
export const DB_KEY_PATH = path.join(process.cwd(), 'db-secret.key');
export const DB_KEY_ENV = 'UIX_DB_KEY';
export const PUBLIC_DIR = path.join(process.cwd(), 'public');
export const PAGES_DIR = path.join(process.cwd(), 'pages');

export const CIPHER_ALGO = 'aes-256-gcm';
export const CIPHER_PREFIX = 'enc:v1:';
export const CIPHER_IV_LEN = 12;
export const CIPHER_TAG_LEN = 16;
export const CIPHER_BLOB_MAGIC = Buffer.from([0x55, 0x49, 0x58, 0x01]); 

export const USER_CACHE_TTL_MS = 30_000;

export const GEMINI_ERROR_RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

export const FRIEND_JOIN_SQL = `
  SELECT c.*, a.name AS asker_name, h.name AS helper_name
  FROM friend_connections c
  LEFT JOIN users a ON a.id = c.asker_id
  LEFT JOIN users h ON h.id = c.helper_id
`;
