import * as https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { requireAuth, sendJson } from '../api/helpers';

const IP_PROBE = 'https://api.ipify.org?format=json';
let cachedServerIp: { ip: string; at: number } | null = null;
const CACHE_MS = 60 * 60 * 1000;

interface ProbeResult {
  ip: string;
  status: number;
  body: string;
}

function probe(headers: Record<string, string> = {}): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      IP_PROBE,
      { method: 'GET', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          let ip = '';
          try {
            ip = (JSON.parse(body) as { ip?: string }).ip ?? '';
          } catch {}
          resolve({ ip, status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('probe timeout')));
    req.end();
  });
}

async function fetchServerIp(): Promise<string> {
  if (cachedServerIp && Date.now() - cachedServerIp.at < CACHE_MS) {
    return cachedServerIp.ip;
  }
  const r = await probe();
  cachedServerIp = { ip: r.ip, at: Date.now() };
  return r.ip;
}

export async function handleDiag(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === '/api/_diag/server-ip' && method === 'GET') {
    if (!requireAuth(req, res)) return true;
    try {
      const ip = await fetchServerIp();
      sendJson(res, 200, { ip, probe: IP_PROBE });
    } catch (e) {
      sendJson(res, 502, { error: (e as Error).message });
    }
    return true;
  }

  if (path === '/api/_diag/spoof-test' && method === 'GET') {
    if (!requireAuth(req, res)) return true;
    const fakeIp = '8.8.8.8';
    try {
      const [plain, spoofed] = await Promise.all([
        probe(),
        probe({
          'X-Forwarded-For': fakeIp,
          'X-Real-IP': fakeIp,
          'CF-Connecting-IP': fakeIp,
          'True-Client-IP': fakeIp,
          Forwarded: `for=${fakeIp}`,
        }),
      ]);
      sendJson(res, 200, {
        target: IP_PROBE,
        fakeIp,
        without: plain.ip,
        withSpoof: spoofed.ip,
        spoofWorked: spoofed.ip === fakeIp,
        note:
          spoofed.ip === fakeIp
            ? 'target ДОВІРЯЄ X-Forwarded-For — IP можна підмінити хедером'
            : 'target ІГНОРУЄ X-Forwarded-For — бачить тільки TCP source IP (наш сервер)',
      });
    } catch (e) {
      sendJson(res, 502, { error: (e as Error).message });
    }
    return true;
  }

  return false;
}
