import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  createUser,
  deleteUser,
  getUserById,
  listUsers,
  verifyPassword,
} from './db';

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function readJson<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
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
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function sendNoContent(res: ServerResponse): void {
  res.statusCode = 204;
  res.end();
}

export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = req.url ?? '';
  if (!url.startsWith('/api/')) return false;

  setCors(res);
  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return true;
  }

  const pathOnly = url.split('?')[0] ?? '';

  try {
    if (pathOnly === '/api/login' && req.method === 'POST') {
      const body = await readJson<{ name?: string; password?: string }>(req);
      if (!body.name || !body.password) {
        sendJson(res, 400, { error: 'name and password required' });
        return true;
      }
      const user = verifyPassword(body.name, body.password);
      if (!user) {
        sendJson(res, 401, { error: 'invalid credentials' });
        return true;
      }
      sendJson(res, 200, user);
      return true;
    }

    if (pathOnly === '/api/users' && req.method === 'POST') {
      const body = await readJson<{
        name?: string;
        password?: string;
        apiKeys?: string[];
        isAdmin?: boolean;
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
        });
        sendJson(res, 201, user);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes('UNIQUE')) {
          sendJson(res, 409, { error: 'name already taken' });
        } else {
          sendJson(res, 500, { error: msg });
        }
      }
      return true;
    }

    if (pathOnly === '/api/users' && req.method === 'GET') {
      sendJson(res, 200, listUsers());
      return true;
    }

    const userIdMatch = pathOnly.match(/^\/api\/users\/(\d+)$/);
    if (userIdMatch) {
      const id = Number(userIdMatch[1]);
      if (req.method === 'GET') {
        const user = getUserById(id);
        if (!user) {
          sendJson(res, 404, { error: 'not found' });
        } else {
          sendJson(res, 200, user);
        }
        return true;
      }
      if (req.method === 'DELETE') {
        if (deleteUser(id)) {
          sendNoContent(res);
        } else {
          sendJson(res, 404, { error: 'not found' });
        }
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
