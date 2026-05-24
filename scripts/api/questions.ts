import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  addQuestion,
  deleteQuestion,
  getQuestionImage,
  getUserByName,
  listQuestions,
  listUsers,
  shareQuestions,
  updateQuestion,
} from '../db';
import { readJson, requireAuth, sendJson, sendNoContent } from '../api/helpers';

export async function handleQuestions(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === '/me/questions' && method === 'GET') {
    const me = requireAuth(req, res);
    if (!me) return true;
    sendJson(res, 200, listQuestions(me.id));
    return true;
  }

  if (path === '/me/questions' && method === 'POST') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const body = await readJson<{
      question?: string;
      options?: string[];
      correctAnswer?: string;
      tags?: string[];
    }>(req);
    const q = addQuestion(
      me.id,
      Buffer.alloc(0),
      'image/jpeg',
      typeof body.question === 'string' ? body.question : '',
      Array.isArray(body.options) ? body.options.map((o) => String(o)) : [],
      typeof body.correctAnswer === 'string' ? body.correctAnswer : '',
      Array.isArray(body.tags)
        ? body.tags.map((t) => String(t).trim()).filter(Boolean)
        : [],
    );
    sendJson(res, 201, q);
    return true;
  }

  if (path === '/me/share-targets' && method === 'GET') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const others = listUsers()
      .filter((u) => u.id !== me.id)
      .map((u) => ({ id: u.id, name: u.name }));
    sendJson(res, 200, others);
    return true;
  }

  if (path === '/me/questions/share' && method === 'POST') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const body = await readJson<{ toUser?: string; ids?: number[] }>(req);
    const toName = (body.toUser ?? '').trim();
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite) : [];
    if (!toName || !ids.length) {
      sendJson(res, 400, { error: 'toUser and ids required' });
      return true;
    }
    const target = getUserByName(toName);
    if (!target) {
      sendJson(res, 404, { error: 'user not found' });
      return true;
    }
    if (target.id === me.id) {
      sendJson(res, 400, { error: 'cannot share with yourself' });
      return true;
    }
    const shared = shareQuestions(me.id, target.id, ids);
    sendJson(res, 200, { shared });
    return true;
  }

  const imageMatch = path.match(/^\/me\/questions\/(\d+)\/image$/);
  if (imageMatch && method === 'GET') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const img = getQuestionImage(me.id, Number(imageMatch[1]));
    if (!img) {
      sendJson(res, 404, { error: 'not found' });
      return true;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', img.mime || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(img.data);
    return true;
  }

  const idMatch = path.match(/^\/me\/questions\/(\d+)$/);
  if (idMatch && method === 'PUT') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const id = Number(idMatch[1]);
    const body = await readJson<{
      question?: string;
      options?: string[];
      correctAnswer?: string;
      tags?: string[];
    }>(req);
    const patch: {
      question?: string;
      options?: string[];
      correctAnswer?: string;
      tags?: string[];
    } = {};
    if (typeof body.question === 'string') patch.question = body.question;
    if (Array.isArray(body.options)) patch.options = body.options.map((o) => String(o));
    if (typeof body.correctAnswer === 'string') patch.correctAnswer = body.correctAnswer;
    if (Array.isArray(body.tags)) {
      patch.tags = body.tags.map((t) => String(t).trim()).filter(Boolean);
    }
    const updated = updateQuestion(me.id, id, patch);
    if (!updated) {
      sendJson(res, 404, { error: 'not found' });
      return true;
    }
    sendJson(res, 200, updated);
    return true;
  }

  if (idMatch && method === 'DELETE') {
    const me = requireAuth(req, res);
    if (!me) return true;
    if (deleteQuestion(me.id, Number(idMatch[1]))) {
      sendNoContent(res);
    } else {
      sendJson(res, 404, { error: 'not found' });
    }
    return true;
  }

  return false;
}
