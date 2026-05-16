import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  getUserByName,
  verifyFirstCharById,
  verifyPasswordById,
  verifyPasswordByName,
} from '../db';
import { DEFAULT_PROMPT_TEXT, KNOWN_MODELS } from '../shared/constants';
import { clearSession, setSession } from '../auth/session';
import { environment } from '../../environments/environment';
import { getCurrentUser, readJson, sendJson, sendNoContent } from '../api/helpers';

export async function handleAuth(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === '/api/login' && method === 'POST') {
    const body = await readJson<{ name?: string; password?: string }>(req);
    if (!body.name || !body.password) {
      sendJson(res, 400, { error: 'name and password required' });
      return true;
    }
    const user = verifyPasswordByName(body.name, body.password);
    if (!user) {
      sendJson(res, 401, { error: 'invalid credentials' });
      return true;
    }
    setSession(res, user.id);
    sendJson(res, 200, user);
    return true;
  }

  const loginIdMatch = path.match(/^\/api\/login\/(\d+)$/);
  if (loginIdMatch && method === 'POST') {
    const id = Number(loginIdMatch[1]);
    const body = await readJson<{ password?: string }>(req);
    if (!body.password) {
      sendJson(res, 400, { error: 'password required' });
      return true;
    }
    const user = verifyPasswordById(id, body.password);
    if (!user) {
      sendJson(res, 401, { error: 'invalid credentials' });
      return true;
    }
    setSession(res, user.id);
    sendJson(res, 200, user);
    return true;
  }

  const loginQuickMatch = path.match(/^\/api\/login\/(\d+)\/quick$/);
  if (loginQuickMatch && method === 'POST') {
    const id = Number(loginQuickMatch[1]);
    const body = await readJson<{ char?: string }>(req);
    const char = body.char ?? '';
    if (!char || [...char].length !== 1) {
      sendJson(res, 400, { error: 'single character required' });
      return true;
    }
    const user = verifyFirstCharById(id, char);
    if (!user) {
      sendJson(res, 401, { error: 'invalid credentials' });
      return true;
    }
    setSession(res, user.id);
    sendJson(res, 200, user);
    return true;
  }

  if (path === '/api/admin/login' && method === 'POST') {
    const body = await readJson<{ name?: string; password?: string }>(req);
    if (!body.name || !body.password) {
      sendJson(res, 400, { error: 'name and password required' });
      return true;
    }
    const user = verifyPasswordByName(body.name, body.password);
    if (!user || !user.isAdmin) {
      sendJson(res, 401, { error: 'invalid admin credentials' });
      return true;
    }
    setSession(res, user.id);
    sendJson(res, 200, user);
    return true;
  }

  if (path === '/api/logout' && method === 'POST') {
    clearSession(req, res);
    sendNoContent(res);
    return true;
  }

  if (path === '/api/me' && method === 'GET') {
    const user = getCurrentUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'not authenticated' });
      return true;
    }
    sendJson(res, 200, user);
    return true;
  }

  if (path === '/api/config' && method === 'GET') {
    sendJson(res, 200, {
      proxyPath: '/_p/',
      iframePermissions: environment.iframePermissions,
      knownModels: KNOWN_MODELS,
      defaultPrompt: DEFAULT_PROMPT_TEXT,
    });
    return true;
  }

  const byNameMatch = path.match(/^\/api\/users\/by-name\/([^/]+)$/);
  if (byNameMatch && method === 'GET') {
    const name = decodeURIComponent(byNameMatch[1]!);
    const u = getUserByName(name);
    if (!u) sendJson(res, 404, { error: 'not found' });
    else sendJson(res, 200, { id: u.id, name: u.name, targetUrl: u.targetUrl });
    return true;
  }

  return false;
}
