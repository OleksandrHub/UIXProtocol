// Reversible field-level encryption for sensitive DB columns.
//
// Usage:
//   const enc = encrypt('my secret');   // -> "enc:v1:<base64>"
//   const raw = decrypt(enc);           // -> "my secret"
//
// decrypt() is migration-safe: a value that is not in the encrypted
// format is returned unchanged, so existing plaintext rows keep working
// and get encrypted on their next write.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

import {
  CIPHER_ALGO as ALGO,
  CIPHER_BLOB_MAGIC as MAGIC,
  CIPHER_IV_LEN as IV_LEN,
  CIPHER_PREFIX as PREFIX,
  CIPHER_TAG_LEN as TAG_LEN,
  DB_KEY_ENV,
  DB_KEY_PATH,
} from '../shared/constants';

function loadKey(): Buffer {
  const fromEnv = process.env[DB_KEY_ENV];
  if (fromEnv) {
    const buf = /^[0-9a-fA-F]{64}$/.test(fromEnv)
      ? Buffer.from(fromEnv, 'hex')
      : Buffer.from(fromEnv, 'base64');
    if (buf.length !== 32) {
      throw new Error(`${DB_KEY_ENV} must decode to 32 bytes (got ${buf.length})`);
    }
    return buf;
  }

  try {
    const saved = fs.readFileSync(DB_KEY_PATH);
    if (saved.length === 32) return saved;
  } catch {
    // file missing — fall through to generation
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(DB_KEY_PATH, key, { mode: 0o600 });
  // eslint-disable-next-line no-console
  console.warn(
    `[db-cipher] generated a new DB encryption key at ${DB_KEY_PATH}. ` +
      `Back it up — losing it makes encrypted columns unrecoverable. ` +
      `For production set the ${DB_KEY_ENV} env var instead.`,
  );
  return key;
}

const KEY = loadKey();

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encrypt(plaintext: string): string {
  if (isEncrypted(plaintext)) return plaintext; // idempotent
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(value: string): string {
  if (!isEncrypted(value)) return value; // legacy plaintext — return as-is
  try {
    const blob = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = blob.subarray(0, IV_LEN);
    const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = blob.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('[db-cipher] failed to decrypt value (wrong key or corrupted data)');
  }
}

export function isEncryptedBuffer(buf: Buffer): boolean {
  return buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

export function encryptBuffer(plain: Buffer): Buffer {
  if (isEncryptedBuffer(plain)) return plain; // idempotent
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, ct]);
}

export function decryptBuffer(buf: Buffer): Buffer {
  if (!isEncryptedBuffer(buf)) return buf; // legacy plaintext blob — return as-is
  try {
    const body = buf.subarray(MAGIC.length);
    const iv = body.subarray(0, IV_LEN);
    const tag = body.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = body.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new Error('[db-cipher] failed to decrypt blob (wrong key or corrupted data)');
  }
}
