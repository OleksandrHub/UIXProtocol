import type { IncomingMessage, ServerResponse } from 'node:http';

import { getUserById } from '../db';
import { getSessionUserId } from '../auth/session';
import type { User } from '../shared/types';

export function readJson<T>(req: IncomingMessage, maxBytes = 1_000_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('payload too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf-8');
        resolve(text ? (JSON.parse(text) as T) : ({} as T));
      } catch (e) {
        reject(e as Error);
      }
    });
    req.on('error', reject);
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function sendNoContent(res: ServerResponse): void {
  res.statusCode = 204;
  res.end();
}

export function readBinary(req: IncomingMessage, maxBytes = 15_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('payload too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function getCurrentUser(req: IncomingMessage): User | null {
  const uid = getSessionUserId(req);
  return uid != null ? getUserById(uid) : null;
}

export function requireAuth(req: IncomingMessage, res: ServerResponse): User | null {
  const me = getCurrentUser(req);
  if (!me) {
    sendJson(res, 401, { error: 'not authenticated' });
    return null;
  }
  return me;
}
