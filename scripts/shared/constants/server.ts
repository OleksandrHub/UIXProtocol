import * as path from 'node:path';

export const LOADERIO_TOKEN = 'loaderio-213257cff0bbdbf549a9fff9d55a3d2b';
export const LOADERIO_FILE = path.join(process.cwd(), `${LOADERIO_TOKEN}.txt`);

export const IP_PROBE = 'https://api.ipify.org?format=json';

export const TLS_DIR = path.join(process.cwd(), 'tls');
export const CERT_PATH = path.join(TLS_DIR, 'cert.pem');
export const KEY_PATH = path.join(TLS_DIR, 'key.pem');

// How long the IP-diagnostics endpoint reuses its last `api.ipify.org` answer
// for the central server's own egress IP. Server IP rarely changes, and the
// probe adds ~150ms of cross-internet latency we don't want on every page.
export const SERVER_IP_CACHE_MS = 60 * 60 * 1000;
