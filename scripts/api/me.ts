import type { IncomingMessage, ServerResponse } from 'node:http';

import { getAppearance, setAppearance, updateUser } from '../db';
import type { Appearance } from '../db/appearance';
import { KNOWN_MODELS } from '../shared/constants';
import type { UserPrompt } from '../shared/types';
import { readJson, requireAuth, sendJson } from '../api/helpers';

export async function handleMe(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === '/api/me/url' && method === 'PUT') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const body = await readJson<{ url?: string }>(req);
    if (typeof body.url !== 'string') {
      sendJson(res, 400, { error: 'url required' });
      return true;
    }
    sendJson(res, 200, updateUser(me.id, { targetUrl: body.url }));
    return true;
  }

  if (path === '/api/me/api-keys' && method === 'PUT') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const body = await readJson<{ apiKeys?: string[] }>(req);
    if (!Array.isArray(body.apiKeys)) {
      sendJson(res, 400, { error: 'apiKeys array required' });
      return true;
    }
    sendJson(res, 200, updateUser(me.id, { apiKeys: body.apiKeys.filter(Boolean) }));
    return true;
  }

  if (path === '/api/me/password' && method === 'PUT') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const body = await readJson<{ password?: string }>(req);
    if (!body.password) {
      sendJson(res, 400, { error: 'password required' });
      return true;
    }
    sendJson(res, 200, updateUser(me.id, { password: body.password }));
    return true;
  }

  if (path === '/api/me/prompts' && method === 'PUT') {
    const me = requireAuth(req, res);
    if (!me) return true;
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
      typeof body.activePromptId === 'string' && cleaned.some((p) => p.id === body.activePromptId)
        ? body.activePromptId
        : (cleaned[0]?.id ?? '');
    sendJson(res, 200, updateUser(me.id, { prompts: cleaned, activePromptId: activeId }));
    return true;
  }

  if (path === '/api/me/models' && method === 'PUT') {
    const me = requireAuth(req, res);
    if (!me) return true;
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
        : (enabled[0] ?? '');
    sendJson(res, 200, updateUser(me.id, { enabledModels: enabled, activeModel: active }));
    return true;
  }

  if (path === '/api/me/active-model' && method === 'PUT') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const body = await readJson<{ activeModel?: string }>(req);
    if (typeof body.activeModel !== 'string' || !me.enabledModels.includes(body.activeModel)) {
      sendJson(res, 400, { error: 'activeModel must be one of enabledModels' });
      return true;
    }
    sendJson(res, 200, updateUser(me.id, { activeModel: body.activeModel }));
    return true;
  }

  if (path === '/api/me/appearance' && method === 'GET') {
    const me = requireAuth(req, res);
    if (!me) return true;
    sendJson(res, 200, getAppearance(me.id));
    return true;
  }

  if (path === '/api/me/appearance' && method === 'PUT') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const body = await readJson<Appearance>(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, { error: 'appearance object required' });
      return true;
    }
    sendJson(res, 200, setAppearance(me.id, body));
    return true;
  }

  return false;
}
