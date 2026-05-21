import * as https from 'node:https';
import * as http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';

import { sendJson } from '../api/helpers';
import { environment } from '../../environments/environment';
import { getRelayStatuses } from '../server/relay-pool';

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

function probeViaSpecificRelay(rawRelayUrl: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    let relay: URL;
    try {
      relay = new URL(rawRelayUrl);
    } catch {
      reject(new Error('invalid relay URL'));
      return;
    }

    const lib = relay.protocol === 'https:' ? https : http;
    const relayPort = Number(relay.port) || (relay.protocol === 'https:' ? 443 : 80);
    const relayPath =
      (relay.pathname === '/' ? '' : relay.pathname) + (relay.search ?? '') || '/';

    const req = lib.request(
      {
        hostname: relay.hostname,
        port: relayPort,
        path: relayPath,
        method: 'GET',
        headers: {
          'x-relay-url': IP_PROBE,
          ...(environment.forwardProxySecret
            ? { 'x-relay-secret': environment.forwardProxySecret }
            : {}),
        },
      },
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
    req.setTimeout(8000, () => req.destroy(new Error('relay probe timeout')));
    req.end();
  });
}

export async function handleDiag(
  _req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === '/api/_diag/server-ip' && method === 'GET') {
    try {
      const ip = await fetchServerIp();
      sendJson(res, 200, { ip, probe: IP_PROBE });
    } catch (e) {
      sendJson(res, 502, { error: (e as Error).message });
    }
    return true;
  }

  if (path === '/api/_diag/relays' && method === 'GET') {
    sendJson(res, 200, { relays: getRelayStatuses() });
    return true;
  }

  if (path === '/api/_diag/relay-ip' && method === 'GET') {
    const healthy = getRelayStatuses().filter((r) => r.healthy);
    if (healthy.length === 0) {
      sendJson(res, 502, { error: 'no healthy relays configured' });
      return true;
    }
    const results = await Promise.all(
      healthy.map(async (r) => {
        try {
          const probeResult = await probeViaSpecificRelay(r.url);
          return { url: r.url, ip: probeResult.ip, status: probeResult.status };
        } catch (e) {
          return { url: r.url, ip: '', status: 0, error: (e as Error).message };
        }
      }),
    );
    sendJson(res, 200, { probe: IP_PROBE, relays: results });
    return true;
  }

  return false;
}
