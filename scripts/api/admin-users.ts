import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  createUser,
  deleteUser,
  getUserById,
  listUsers,
  updateUser,
} from '../db';
import { clearSessionsForUser } from '../auth/session';
import { getCurrentUser, readJson, sendJson, sendNoContent } from '../api/helpers';

function requireAdmin(req: IncomingMessage, res: ServerResponse): boolean {
  const me = getCurrentUser(req);
  if (!me) {
    sendJson(res, 401, { error: 'not authenticated' });
    return false;
  }
  if (!me.isAdmin) {
    sendJson(res, 403, { error: 'admin only' });
    return false;
  }
  return true;
}

export async function handleAdminUsers(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === '/api/users' && method === 'GET') {
    if (!requireAdmin(req, res)) return true;
    sendJson(res, 200, listUsers());
    return true;
  }

  if (path === '/api/users' && method === 'POST') {
    if (!requireAdmin(req, res)) return true;
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
    if (!requireAdmin(req, res)) return true;
    const id = Number(userIdMatch[1]);
    if (method === 'GET') {
      const user = getUserById(id);
      if (!user) sendJson(res, 404, { error: 'not found' });
      else sendJson(res, 200, user);
      return true;
    }
    if (method === 'PUT') {
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
    if (method === 'DELETE') {
      if (deleteUser(id)) {
        clearSessionsForUser(id);
        sendNoContent(res);
      } else sendJson(res, 404, { error: 'not found' });
      return true;
    }
  }

  return false;
}
