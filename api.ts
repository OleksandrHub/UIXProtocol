import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  createUser,
  deleteUser,
  getUserById,
  getUserByName,
  listUsers,
  updateUser,
  verifyPasswordById,
  verifyPasswordByName,
} from './db';
import { clearSession, getSessionUserId, setSession } from './session';
import { environment } from './environments/environment';

function readJson<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > 1_000_000) {
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendNoContent(res: ServerResponse): void {
  res.statusCode = 204;
  res.end();
}

function getCurrentUser(req: IncomingMessage) {
  const uid = getSessionUserId(req);
  return uid != null ? getUserById(uid) : null;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url ?? '';
  if (!url.startsWith('/api/') && url !== '/api') return false;

  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return true;
  }

  const path = url.split('?')[0] ?? '';

  try {
    if (path === '/api/login' && req.method === 'POST') {
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
    if (loginIdMatch && req.method === 'POST') {
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

    if (path === '/api/admin/login' && req.method === 'POST') {
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

    if (path === '/api/logout' && req.method === 'POST') {
      clearSession(req, res);
      sendNoContent(res);
      return true;
    }

    if (path === '/api/me' && req.method === 'GET') {
      const user = getCurrentUser(req);
      if (!user) {
        sendJson(res, 401, { error: 'not authenticated' });
        return true;
      }
      sendJson(res, 200, user);
      return true;
    }

    if (path === '/api/config' && req.method === 'GET') {
      sendJson(res, 200, {
        proxyPath: '/_p/',
        iframePermissions: environment.iframePermissions,
      });
      return true;
    }

    const byNameMatch = path.match(/^\/api\/users\/by-name\/([^/]+)$/);
    if (byNameMatch && req.method === 'GET') {
      const name = decodeURIComponent(byNameMatch[1]!);
      const u = getUserByName(name);
      if (!u) sendJson(res, 404, { error: 'not found' });
      else sendJson(res, 200, { id: u.id, name: u.name, targetUrl: u.targetUrl });
      return true;
    }

    if (path === '/api/me/url' && req.method === 'PUT') {
      const me = getCurrentUser(req);
      if (!me) {
        sendJson(res, 401, { error: 'not authenticated' });
        return true;
      }
      const body = await readJson<{ url?: string }>(req);
      if (typeof body.url !== 'string') {
        sendJson(res, 400, { error: 'url required' });
        return true;
      }
      sendJson(res, 200, updateUser(me.id, { targetUrl: body.url }));
      return true;
    }

    if (path === '/api/me/api-keys' && req.method === 'PUT') {
      const me = getCurrentUser(req);
      if (!me) {
        sendJson(res, 401, { error: 'not authenticated' });
        return true;
      }
      const body = await readJson<{ apiKeys?: string[] }>(req);
      if (!Array.isArray(body.apiKeys)) {
        sendJson(res, 400, { error: 'apiKeys array required' });
        return true;
      }
      sendJson(res, 200, updateUser(me.id, { apiKeys: body.apiKeys.filter(Boolean) }));
      return true;
    }

    if (path === '/api/me/password' && req.method === 'PUT') {
      const me = getCurrentUser(req);
      if (!me) {
        sendJson(res, 401, { error: 'not authenticated' });
        return true;
      }
      const body = await readJson<{ password?: string }>(req);
      if (!body.password) {
        sendJson(res, 400, { error: 'password required' });
        return true;
      }
      sendJson(res, 200, updateUser(me.id, { password: body.password }));
      return true;
    }

    const me = getCurrentUser(req);
    const requireAdmin = (): boolean => {
      if (!me) {
        sendJson(res, 401, { error: 'not authenticated' });
        return false;
      }
      if (!me.isAdmin) {
        sendJson(res, 403, { error: 'admin only' });
        return false;
      }
      return true;
    };

    if (path === '/api/users' && req.method === 'GET') {
      if (!requireAdmin()) return true;
      sendJson(res, 200, listUsers());
      return true;
    }

    if (path === '/api/users' && req.method === 'POST') {
      if (!requireAdmin()) return true;
      const body = await readJson<{
        name?: string;
        password?: string;
        apiKeys?: string[];
        isAdmin?: boolean;
        targetUrl?: string;
      }>(req);
      if (!body.name || !body.password) {
        sendJson(res, 400, { error: 'name and password required' });
        return true;
      }
      try {
        const user = createUser({
          name: body.name,
          password: body.password,
          apiKeys: body.apiKeys,
          isAdmin: body.isAdmin,
          targetUrl: body.targetUrl,
        });
        sendJson(res, 201, user);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes('UNIQUE')) sendJson(res, 409, { error: 'name already taken' });
        else sendJson(res, 500, { error: msg });
      }
      return true;
    }

    const userIdMatch = path.match(/^\/api\/users\/(\d+)$/);
    if (userIdMatch) {
      if (!requireAdmin()) return true;
      const id = Number(userIdMatch[1]);
      if (req.method === 'GET') {
        const user = getUserById(id);
        if (!user) sendJson(res, 404, { error: 'not found' });
        else sendJson(res, 200, user);
        return true;
      }
      if (req.method === 'PUT') {
        const body = await readJson<{
          name?: string;
          password?: string;
          apiKeys?: string[];
          isAdmin?: boolean;
          targetUrl?: string;
        }>(req);
        const user = updateUser(id, body);
        if (!user) sendJson(res, 404, { error: 'not found' });
        else sendJson(res, 200, user);
        return true;
      }
      if (req.method === 'DELETE') {
        if (deleteUser(id)) sendNoContent(res);
        else sendJson(res, 404, { error: 'not found' });
        return true;
      }
    }

    sendJson(res, 404, { error: 'not found' });
    return true;
  } catch (e) {
    sendJson(res, 500, { error: (e as Error).message });
    return true;
  }
}
