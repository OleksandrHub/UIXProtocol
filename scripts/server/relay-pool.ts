import * as net from 'node:net';
import { URL } from 'node:url';

import { environment } from '../../environments/environment';
import {
  HEALTH_CHECK_INTERVAL_MS,
  HEALTH_CHECK_TIMEOUT_MS,
  RECHECK_AFTER_FAIL_MS,
} from '../shared/constants';
import type { PublicRelayStatus, RelayStatus } from '../shared/types';

const status: RelayStatus[] = [];
let initPromise: Promise<void> | null = null;

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function probeOne(s: RelayStatus): Promise<void> {
  return new Promise((resolve) => {
    const port = Number(s.url.port) || (s.url.protocol === 'https:' ? 443 : 80);
    const socket = net.createConnection({ host: s.url.hostname, port });
    let done = false;
    const finish = (healthy: boolean, error: string | null): void => {
      if (done) return;
      done = true;
      socket.destroy();
      const wasHealthy = s.healthy;
      s.healthy = healthy;
      s.lastCheckedAt = Date.now();
      s.lastError = error;
      if (wasHealthy && !healthy) {
        console.warn(`[RelayPool] ${s.raw} → unhealthy: ${error}`);
      } else if (!wasHealthy && healthy) {
        console.log(`[RelayPool] ${s.raw} → healthy`);
      }
      resolve();
    };
    socket.setTimeout(HEALTH_CHECK_TIMEOUT_MS);
    socket.on('connect', () => finish(true, null));
    socket.on('timeout', () => finish(false, 'timeout'));
    socket.on('error', (err) => finish(false, err.message));
  });
}

async function checkAll(): Promise<void> {
  await Promise.all(status.map(probeOne));
}

export function initRelayPool(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    for (const raw of environment.forwardProxies) {
      const url = parseUrl(raw);
      if (!url) {
        console.warn(`[RelayPool] skipping invalid relay URL: ${raw}`);
        continue;
      }
      status.push({
        url,
        raw,
        healthy: false,
        lastCheckedAt: 0,
        lastError: null,
      });
    }
    if (status.length === 0) return;
    await checkAll();
    setInterval(() => {
      void checkAll();
    }, HEALTH_CHECK_INTERVAL_MS).unref();
  })();
  return initPromise;
}

export function pickRelay(userId: number | null): URL | null {
  if (!initPromise) void initRelayPool();
  if (userId == null || status.length === 0) return null;
  const startIdx = Math.abs(userId) % status.length;
  for (let i = 0; i < status.length; i++) {
    const idx = (startIdx + i) % status.length;
    const s = status[idx];
    if (s && s.healthy) return s.url;
  }
  return null;
}

export function reportRelayFailure(target: URL, error: string): void {
  if (!initPromise) void initRelayPool();
  for (const s of status) {
    if (s.url.host !== target.host) continue;
    if (s.healthy) {
      console.warn(`[RelayPool] ${s.raw} → unhealthy (live failure): ${error}`);
    }
    s.healthy = false;
    s.lastError = error;
    s.lastCheckedAt = Date.now();
    setTimeout(() => {
      void probeOne(s);
    }, RECHECK_AFTER_FAIL_MS).unref();
    return;
  }
}

export function getRelayStatuses(): PublicRelayStatus[] {
  if (!initPromise) void initRelayPool();
  return status.map((s) => ({
    url: s.raw,
    healthy: s.healthy,
    lastCheckedAt: s.lastCheckedAt,
    lastError: s.lastError,
  }));
}
