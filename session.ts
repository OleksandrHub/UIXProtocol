import * as crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { environment } from './environments/environment';

export const SESSION_COOKIE_NAME = 'uix_session';

const sessions = new Map<string, { userId: number; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (s.expiresAt < now) sessions.delete(id);
}, 60_000).unref();

export function parseCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function getSessionUserId(req: IncomingMessage): number | null {
  const id = parseCookie(req, SESSION_COOKIE_NAME);
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    sessions.delete(id);
    return null;
  }
  return s.userId;
}

export function setSession(res: ServerResponse, userId: number): void {
  const id = crypto.randomBytes(24).toString('base64url');
  sessions.set(id, { userId, expiresAt: Date.now() + environment.sessionTtlMs });
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(environment.sessionTtlMs / 1000)}`
  );
}

export function clearSession(req: IncomingMessage, res: ServerResponse): void {
  const id = parseCookie(req, SESSION_COOKIE_NAME);
  if (id) sessions.delete(id);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
}
