import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  addUserFile,
  createUser,
  DEFAULT_PROMPT_TEXT,
  deleteUser,
  deleteUserFile,
  getUserById,
  getUserByName,
  getUserFiles,
  KNOWN_MODELS,
  listUserFiles,
  listUsers,
  updateUser,
  verifyFirstCharById,
  verifyPasswordById,
  verifyPasswordByName,
} from './db';
import type { UserPrompt } from './db';
import { clearSession, clearSessionsForUser, getSessionUserId, setSession } from './session';
import { environment } from './environments/environment';
import {
  getCachedFileIds,
  invalidateUploadsForUser,
  preloadFiles,
  solveWithGemini,
} from './gemini';

function readJson<T>(req: IncomingMessage, maxBytes = 1_000_000): Promise<T> {
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

    const loginQuickMatch = path.match(/^\/api\/login\/(\d+)\/quick$/);
    if (loginQuickMatch && req.method === 'POST') {
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
        knownModels: KNOWN_MODELS,
        defaultPrompt: DEFAULT_PROMPT_TEXT,
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

    if (path === '/api/me/prompts' && req.method === 'PUT') {
      const meUser = getCurrentUser(req);
      if (!meUser) {
        sendJson(res, 401, { error: 'not authenticated' });
        return true;
      }
      const body = await readJson<{ prompts?: UserPrompt[]; activePromptId?: string }>(req);
      if (!Array.isArray(body.prompts)) {
        sendJson(res, 400, { error: 'prompts array required' });
        return true;
      }
      const cleaned = body.prompts
        .filter((p) => p && typeof p.id === 'string' && typeof p.text === 'string')
        .map((p) => ({
          id: p.id,
          name: typeof p.name === 'string' ? p.name : 'Untitled',
          text: p.text,
        }));
      const activeId =
        typeof body.activePromptId === 'string' &&
        cleaned.some((p) => p.id === body.activePromptId)
          ? body.activePromptId
          : cleaned[0]?.id ?? '';
      sendJson(res, 200, updateUser(meUser.id, { prompts: cleaned, activePromptId: activeId }));
      return true;
    }

    if (path === '/api/me/models' && req.method === 'PUT') {
      const meUser = getCurrentUser(req);
      if (!meUser) {
        sendJson(res, 401, { error: 'not authenticated' });
        return true;
      }
      const body = await readJson<{ enabledModels?: string[]; activeModel?: string }>(req);
      if (!Array.isArray(body.enabledModels)) {
        sendJson(res, 400, { error: 'enabledModels array required' });
        return true;
      }
      const known = new Set<string>(KNOWN_MODELS);
      const enabled = body.enabledModels.filter((m) => known.has(m));
      const active =
        typeof body.activeModel === 'string' && enabled.includes(body.activeModel)
          ? body.activeModel
          : enabled[0] ?? '';
      sendJson(
        res,
        200,
        updateUser(meUser.id, { enabledModels: enabled, activeModel: active })
      );
      return true;
    }

    if (path === '/api/me/active-model' && req.method === 'PUT') {
      const meUser = getCurrentUser(req);
      if (!meUser) {
        sendJson(res, 401, { error: 'not authenticated' });
        return true;
      }
      const body = await readJson<{ activeModel?: string }>(req);
      if (typeof body.activeModel !== 'string' || !meUser.enabledModels.includes(body.activeModel)) {
        sendJson(res, 400, { error: 'activeModel must be one of enabledModels' });
        return true;
      }
      sendJson(res, 200, updateUser(meUser.id, { activeModel: body.activeModel }));
      return true;
    }

    if (path === '/api/me/files' && req.method === 'GET') {
      const meUser = getCurrentUser(req);
      if (!meUser) {
        sendJson(res, 401, { error: 'not authenticated' });
        return true;
      }
      sendJson(res, 200, listUserFiles(meUser.id));
      return true;
    }

    if (path === '/api/me/files' && req.method === 'POST') {
      const meUser = getCurrentUser(req);
      if (!meUser) {
        sendJson(res, 401, { error: 'not authenticated' });
        return true;
      }
      const body = await readJson<{ name?: string; mime?: string; dataBase64?: string }>(
        req,
        30_000_000
      );
      if (!body.name || !body.dataBase64) {
        sendJson(res, 400, { error: 'name and dataBase64 required' });
        return true;
      }
      const buf = Buffer.from(body.dataBase64, 'base64');
      if (!buf.length) {
        sendJson(res, 400, { error: 'empty file' });
        return true;
      }
      const meta = addUserFile(meUser.id, body.name, body.mime ?? 'application/octet-stream', buf);
      sendJson(res, 201, meta);
      return true;
    }

    if (path === '/api/me/files/status' && req.method === 'GET') {
      const meUser = getCurrentUser(req);
      if (!meUser) {
        sendJson(res, 401, { error: 'not authenticated' });
        return true;
      }
      const apiKeys = (meUser.apiKeys ?? []).filter(Boolean);
      const files = listUserFiles(meUser.id);
      const cachedByKey = apiKeys.map((k) => getCachedFileIds(k));
      const totalKeys = apiKeys.length;
      const fileStatuses = files.map((f) => {
        const cachedIn = cachedByKey.filter((s) => s.has(f.id)).length;
        return {
          id: f.id,
          name: f.name,
          size: f.size,
          cachedKeys: cachedIn,
          totalKeys,
        };
      });
      const allReady = totalKeys > 0 && fileStatuses.every((s) => s.cachedKeys === totalKeys);
      sendJson(res, 200, {
        files: fileStatuses,
        totalKeys,
        ready: allReady,
        hasFiles: files.length > 0,
      });
      return true;
    }

    if (path === '/api/me/files/preload' && req.method === 'POST') {
      const meUser = getCurrentUser(req);
      if (!meUser) {
        sendJson(res, 401, { error: 'not authenticated' });
        return true;
      }
      const apiKeys = (meUser.apiKeys ?? []).filter(Boolean);
      if (!apiKeys.length) {
        sendJson(res, 400, { error: 'no API keys configured' });
        return true;
      }
      const files = getUserFiles(meUser.id);
      try {
        const result = await preloadFiles(apiKeys, files);
        sendJson(res, 200, result);
      } catch (e) {
        sendJson(res, 502, { error: (e as Error).message });
      }
      return true;
    }

    const fileIdMatch = path.match(/^\/api\/me\/files\/(\d+)$/);
    if (fileIdMatch && req.method === 'DELETE') {
      const meUser = getCurrentUser(req);
      if (!meUser) {
        sendJson(res, 401, { error: 'not authenticated' });
        return true;
      }
      const id = Number(fileIdMatch[1]);
      if (deleteUserFile(meUser.id, id)) {
        invalidateUploadsForUser([id]);
        sendNoContent(res);
      } else {
        sendJson(res, 404, { error: 'not found' });
      }
      return true;
    }

    if (path === '/api/gemini/solve' && req.method === 'POST') {
      const meUser = getCurrentUser(req);
      if (!meUser) {
        sendJson(res, 401, { error: 'not authenticated' });
        return true;
      }
      const body = await readJson<{ imageBase64?: string }>(req, 15_000_000);
      if (!body.imageBase64) {
        sendJson(res, 400, { error: 'imageBase64 required' });
        return true;
      }
      const keys = (meUser.apiKeys ?? []).filter(Boolean);
      if (!keys.length) {
        sendJson(res, 400, { error: 'no API keys configured' });
        return true;
      }

      const promptText =
        meUser.prompts.find((p) => p.id === meUser.activePromptId)?.text ??
        meUser.prompts[0]?.text ??
        DEFAULT_PROMPT_TEXT;

      const knownSet = new Set<string>(KNOWN_MODELS);
      const enabled = (meUser.enabledModels ?? []).filter((m) => knownSet.has(m));
      const ordered =
        meUser.activeModel && enabled.includes(meUser.activeModel)
          ? [meUser.activeModel, ...enabled.filter((m) => m !== meUser.activeModel)]
          : enabled;
      const models = ordered.length ? ordered : ['gemini-2.5-flash'];

      const files = getUserFiles(meUser.id);

      try {
        const answer = await solveWithGemini({
          apiKeys: keys,
          imageBase64: body.imageBase64,
          prompt: promptText,
          models,
          files,
        });
        sendJson(res, 200, { answer });
      } catch (e) {
        sendJson(res, 502, { error: (e as Error).message });
      }
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
        if (deleteUser(id)) {
          clearSessionsForUser(id);
          sendNoContent(res);
        }
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
