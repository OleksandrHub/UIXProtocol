import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TLS_DIR = path.join(process.cwd(), 'tls');
const CERT_PATH = path.join(TLS_DIR, 'cert.pem');
const KEY_PATH = path.join(TLS_DIR, 'key.pem');

export function ensureSelfSignedCert(): { key: Buffer; cert: Buffer } | null {
  try {
    if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
      return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
    }
    fs.mkdirSync(TLS_DIR, { recursive: true });
    execSync(
      [
        'openssl',
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        JSON.stringify(KEY_PATH),
        '-out',
        JSON.stringify(CERT_PATH),
        '-days',
        '3650',
        '-nodes',
        '-subj',
        '"/CN=localhost"',
        '-addext',
        '"subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1"',
      ].join(' '),
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    console.log(`[tls] generated self-signed cert at ${CERT_PATH}`);
    return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
  } catch (err) {
    console.warn('[tls] could not generate self-signed cert:', (err as Error).message);
    console.warn('[tls] HTTPS listener will be skipped — install openssl to enable it.');
    return null;
  }
}
