import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';

import { environment } from '../../environments/environment';
import {
  HEALTH_CHECK_INTERVAL_MS,
  HEALTH_CHECK_TIMEOUT_MS,
  RECHECK_AFTER_FAIL_MS,
  RECHECK_BACKOFF_MAX_MS,
} from '../shared/constants';
import type { PublicRelayStatus, RelayStatus } from '../shared/types';

const RELAY_PROBE_URL = 'https://api.ipify.org?format=text';

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
    const lib = s.url.protocol === 'https:' ? https : http;
    const port = Number(s.url.port) || (s.url.protocol === 'https:' ? 443 : 80);
    let done = false;
    const finish = (healthy: boolean, error: string | null): void => {
      if (done) return;
      done = true;
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

    const req = lib.request(
      {
        hostname: s.url.hostname,
        port,
        path: '/',
        method: 'GET',
        headers: { 'x-relay-url': RELAY_PROBE_URL },
        timeout: HEALTH_CHECK_TIMEOUT_MS,
      },
      (res) => {
        const code = res.statusCode ?? 0;
        const healthy = code >= 200 && code < 400;
        res.resume(); // drain so the socket can close
        finish(healthy, healthy ? null : `probe status ${code}`);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      finish(false, 'timeout');
    });
    req.on('error', (err: Error) => finish(false, err.message));
    req.end();
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
      const hadUnhealthy = status.some((s) => !s.healthy);
      void checkAll().then(() => {
        if (hadUnhealthy && status.some((s) => s.healthy)) {
          // a relay just came back — recheck sooner to confirm stability
          setTimeout(() => void checkAll(), RECHECK_AFTER_FAIL_MS * 2);
        }
      });
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

const recovering = new Set<RelayStatus>();

function scheduleRecovery(s: RelayStatus): void {
  if (recovering.has(s)) return;
  recovering.add(s);
  const attempt = (delay: number): void => {
    setTimeout(() => {
      void probeOne(s).then(() => {
        if (s.healthy) {
          recovering.delete(s);
        } else {
          attempt(Math.min(delay * 2, RECHECK_BACKOFF_MAX_MS));
        }
      });
    }, delay).unref();
  };
  attempt(RECHECK_AFTER_FAIL_MS);
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
    scheduleRecovery(s);
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
