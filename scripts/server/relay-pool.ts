import * as net from 'node:net';
import { URL } from 'node:url';

import { environment } from '../../environments/environment';

const HEALTH_CHECK_INTERVAL_MS = 10_000;
const HEALTH_CHECK_TIMEOUT_MS = 3_000;
const RECHECK_AFTER_FAIL_MS = 5_000;

interface RelayStatus {
  url: URL;
  raw: string;
  healthy: boolean;
  lastCheckedAt: number;
  lastError: string | null;
}

const status: RelayStatus[] = [];
let started = false;

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

function init(): void {
  if (started) return;
  started = true;
  for (const raw of environment.forwardProxies) {
    const url = parseUrl(raw);
    if (!url) {
      console.warn(`[RelayPool] skipping invalid relay URL: ${raw}`);
      continue;
    }
    status.push({
      url,
      raw,
      healthy: true,
      lastCheckedAt: 0,
      lastError: null,
    });
  }
  if (status.length === 0) return;
  void checkAll();
  setInterval(() => {
    void checkAll();
  }, HEALTH_CHECK_INTERVAL_MS).unref();
}

export function pickRelay(userId: number | null): URL | null {
  init();
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
  init();
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

export interface PublicRelayStatus {
  url: string;
  healthy: boolean;
  lastCheckedAt: number;
  lastError: string | null;
}

export function getRelayStatuses(): PublicRelayStatus[] {
  init();
  return status.map((s) => ({
    url: s.raw,
    healthy: s.healthy,
    lastCheckedAt: s.lastCheckedAt,
    lastError: s.lastError,
  }));
}
