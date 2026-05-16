import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  addQuestion,
  addUserFile,
  deleteUserFile,
  getUserFiles,
  listUserFiles,
} from '../db';
import { DEFAULT_PROMPT_TEXT, KNOWN_MODELS } from '../shared/constants';
import {
  getCachedFileIds,
  invalidateUploadsForUser,
  preloadFiles,
  solveWithGemini,
} from '../gemini';
import { readJson, requireAuth, sendJson, sendNoContent } from '../api/helpers';

export async function handleFiles(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === '/api/me/files' && method === 'GET') {
    const me = requireAuth(req, res);
    if (!me) return true;
    sendJson(res, 200, listUserFiles(me.id));
    return true;
  }

  if (path === '/api/me/files' && method === 'POST') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const body = await readJson<{ name?: string; mime?: string; dataBase64?: string }>(
      req,
      30_000_000,
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
    const meta = addUserFile(me.id, body.name, body.mime ?? 'application/octet-stream', buf);
    sendJson(res, 201, meta);
    return true;
  }

  if (path === '/api/me/files/status' && method === 'GET') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const apiKeys = (me.apiKeys ?? []).filter(Boolean);
    const files = listUserFiles(me.id);
    const cachedByKey = apiKeys.map((k) => getCachedFileIds(k));
    const totalKeys = apiKeys.length;
    const fileStatuses = files.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      cachedKeys: cachedByKey.filter((s) => s.has(f.id)).length,
      totalKeys,
    }));
    const allReady = totalKeys > 0 && fileStatuses.every((s) => s.cachedKeys === totalKeys);
    sendJson(res, 200, {
      files: fileStatuses,
      totalKeys,
      ready: allReady,
      hasFiles: files.length > 0,
    });
    return true;
  }

  if (path === '/api/me/files/preload' && method === 'POST') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const apiKeys = (me.apiKeys ?? []).filter(Boolean);
    if (!apiKeys.length) {
      sendJson(res, 400, { error: 'no API keys configured' });
      return true;
    }
    const files = getUserFiles(me.id);
    try {
      const result = await preloadFiles(apiKeys, files);
      sendJson(res, 200, result);
    } catch (e) {
      sendJson(res, 502, { error: (e as Error).message });
    }
    return true;
  }

  const fileIdMatch = path.match(/^\/api\/me\/files\/(\d+)$/);
  if (fileIdMatch && method === 'DELETE') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const id = Number(fileIdMatch[1]);
    if (deleteUserFile(me.id, id)) {
      invalidateUploadsForUser([id]);
      sendNoContent(res);
    } else {
      sendJson(res, 404, { error: 'not found' });
    }
    return true;
  }

  if (path === '/api/gemini/solve' && method === 'POST') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const body = await readJson<{ imageBase64?: string }>(req, 15_000_000);
    if (!body.imageBase64) {
      sendJson(res, 400, { error: 'imageBase64 required' });
      return true;
    }
    const keys = (me.apiKeys ?? []).filter(Boolean);
    if (!keys.length) {
      sendJson(res, 400, { error: 'no API keys configured' });
      return true;
    }

    const promptText =
      me.prompts.find((p) => p.id === me.activePromptId)?.text ??
      me.prompts[0]?.text ??
      DEFAULT_PROMPT_TEXT;

    const knownSet = new Set<string>(KNOWN_MODELS);
    const enabled = (me.enabledModels ?? []).filter((m) => knownSet.has(m));
    const ordered =
      me.activeModel && enabled.includes(me.activeModel)
        ? [me.activeModel, ...enabled.filter((m) => m !== me.activeModel)]
        : enabled;
    const models = ordered.length ? ordered : ['gemini-2.5-flash'];

    const files = getUserFiles(me.id);

    try {
      const result = await solveWithGemini({
        apiKeys: keys,
        imageBase64: body.imageBase64,
        prompt: promptText,
        models,
        files,
      });
      try {
        const img = Buffer.from(body.imageBase64, 'base64');
        const parsed = result.questions.length
          ? result.questions
          : [{ question: '', options: [] as string[], correct: result.answer }];
        for (const q of parsed) {
          addQuestion(
            me.id,
            img,
            'image/jpeg',
            q.question,
            q.options,
            q.correct || result.answer,
          );
        }
      } catch (e) {
        console.error('[Questions] failed to archive:', (e as Error).message);
      }
      sendJson(res, 200, { answer: result.answer });
    } catch (e) {
      sendJson(res, 502, { error: (e as Error).message });
    }
    return true;
  }

  return false;
}
