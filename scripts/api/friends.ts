import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  acceptFriendship,
  addQuestion,
  getActiveHelperFor,
  getConnection,
  getUserById,
  getUserByName,
  listMyFriends,
  removeFriendship,
  requestFriendship,
} from '../db';
import { readJson, requireAuth, sendJson, sendNoContent } from '../api/helpers';

// In-flight screenshots awaiting a helper reply. Keyed by messageId so that
// when the reply arrives we can pair it with the original image and persist
// the question into the asker's archive. TTL keeps memory bounded if the
// helper never replies.
const PENDING_SCREENSHOT_TTL_MS = 10 * 60 * 1000;
const pendingScreenshots = new Map<
  number,
  { askerId: number; image: Buffer; mime: string; expiresAt: number }
>();
function gcPendingScreenshots(): void {
  const now = Date.now();
  for (const [id, e] of pendingScreenshots) {
    if (e.expiresAt < now) pendingScreenshots.delete(id);
  }
}

// ---- SSE registry ---------------------------------------------------------
// One entry per active EventSource subscription. A user may keep more than
// one tab open, so we store an array per userId.

const subscribers = new Map<number, ServerResponse[]>();

function subscribe(userId: number, res: ServerResponse): void {
  let list = subscribers.get(userId);
  if (!list) {
    list = [];
    subscribers.set(userId, list);
  }
  list.push(res);
}

function unsubscribe(userId: number, res: ServerResponse): void {
  const list = subscribers.get(userId);
  if (!list) return;
  const i = list.indexOf(res);
  if (i >= 0) list.splice(i, 1);
  if (list.length === 0) subscribers.delete(userId);
}

function broadcast(userId: number, event: object): void {
  const list = subscribers.get(userId);
  if (!list || list.length === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of list) {
    try {
      res.write(payload);
    } catch {
      // Stream is gone — will be cleaned up on its 'close' handler.
    }
  }
}

export function isUserOnline(userId: number): boolean {
  const list = subscribers.get(userId);
  return !!list && list.length > 0;
}

// ---- Helpers --------------------------------------------------------------

function openSseStream(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Initial comment to flush headers immediately through any proxy in front.
  res.write(': hello\n\n');
}

// ---- Route handlers -------------------------------------------------------

export async function handleFriends(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === '/me/friends' && method === 'GET') {
    const me = requireAuth(req, res);
    if (!me) return true;
    sendJson(res, 200, listMyFriends(me.id));
    return true;
  }

  if (path === '/me/friends/request' && method === 'POST') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const body = await readJson<{ toName?: string }>(req);
    const toName = (body.toName ?? '').trim();
    if (!toName) {
      sendJson(res, 400, { error: 'toName required' });
      return true;
    }
    const helper = getUserByName(toName);
    if (!helper) {
      sendJson(res, 404, { error: 'user not found' });
      return true;
    }
    const result = requestFriendship(me.id, helper.id);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    // Notify helper that they have a pending request.
    broadcast(helper.id, { type: 'request', connection: result.connection });
    sendJson(res, 201, result.connection);
    return true;
  }

  if (path === '/me/friends/accept' && method === 'POST') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const body = await readJson<{ id?: number }>(req);
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      sendJson(res, 400, { error: 'id required' });
      return true;
    }
    const accepted = acceptFriendship(id, me.id);
    if (!accepted) {
      sendJson(res, 404, { error: 'not found or not allowed' });
      return true;
    }
    // Notify the asker that the helper accepted.
    broadcast(accepted.askerId, { type: 'accepted', connection: accepted });
    sendJson(res, 200, accepted);
    return true;
  }

  const removeMatch = path.match(/^\/me\/friends\/(\d+)$/);
  if (removeMatch && method === 'DELETE') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const id = Number(removeMatch[1]);
    const conn = getConnection(id);
    const ok = removeFriendship(id, me.id);
    if (!ok) {
      sendJson(res, 404, { error: 'not found' });
      return true;
    }
    // Tell the other side they were disconnected.
    if (conn) {
      const otherId = conn.askerId === me.id ? conn.helperId : conn.askerId;
      broadcast(otherId, { type: 'disconnected', connectionId: id });
    }
    sendNoContent(res);
    return true;
  }

  if (path === '/me/friends/screenshot' && method === 'POST') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const body = await readJson<{ imageBase64?: string }>(req, 15_000_000);
    if (!body.imageBase64) {
      sendJson(res, 400, { error: 'imageBase64 required' });
      return true;
    }
    const conn = getActiveHelperFor(me.id);
    if (!conn) {
      sendJson(res, 409, { error: 'no active helper — accept a connection first' });
      return true;
    }
    const messageId = Date.now() + Math.floor(Math.random() * 1000);
    if (!isUserOnline(conn.helperId)) {
      sendJson(res, 409, { error: 'helper is offline' });
      return true;
    }
    // Park the image so the matching reply can archive it later.
    gcPendingScreenshots();
    pendingScreenshots.set(messageId, {
      askerId: me.id,
      image: Buffer.from(body.imageBase64, 'base64'),
      mime: 'image/jpeg',
      expiresAt: Date.now() + PENDING_SCREENSHOT_TTL_MS,
    });
    broadcast(conn.helperId, {
      type: 'screenshot',
      messageId,
      connectionId: conn.id,
      from: { id: me.id, name: me.name },
      imageBase64: body.imageBase64,
    });
    sendJson(res, 200, { messageId, sentTo: { id: conn.helperId, name: conn.helperName } });
    return true;
  }

  if (path === '/me/friends/reply' && method === 'POST') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const body = await readJson<{ askerId?: number; text?: string; messageId?: number }>(req);
    const askerId = Number(body.askerId);
    const text = (body.text ?? '').toString();
    if (!Number.isFinite(askerId) || askerId <= 0 || !text.trim()) {
      sendJson(res, 400, { error: 'askerId and text required' });
      return true;
    }
    // Validate that this reply path is allowed — me must be the active helper
    // of askerId.
    const askersHelper = getActiveHelperFor(askerId);
    if (!askersHelper || askersHelper.helperId !== me.id) {
      sendJson(res, 403, { error: 'not the active helper for this user' });
      return true;
    }
    if (!isUserOnline(askerId)) {
      sendJson(res, 409, { error: 'asker is offline' });
      return true;
    }

    // Pair the reply with the parked screenshot via messageId and persist to
    // the asker's archive, mirroring the Gemini flow. archiveQuestions toggle
    // on the asker still gates it.
    const messageId = Number(body.messageId);
    if (Number.isFinite(messageId) && messageId > 0) {
      const pending = pendingScreenshots.get(messageId);
      if (pending && pending.askerId === askerId) {
        const asker = getUserById(askerId);
        if (asker && asker.archiveQuestions !== false) {
          try {
            addQuestion(asker.id, pending.image, pending.mime, '', [], text.trim());
          } catch (e) {
            console.error('[friends] archive failed:', (e as Error).message);
          }
        }
        pendingScreenshots.delete(messageId);
      }
    }

    broadcast(askerId, {
      type: 'reply',
      from: { id: me.id, name: me.name },
      text,
    });
    sendNoContent(res);
    return true;
  }

  if (path === '/me/friends/stream' && method === 'GET') {
    const me = requireAuth(req, res);
    if (!me) return true;

    openSseStream(res);
    subscribe(me.id, res);

    // Periodic comment to keep proxies / tunnels from killing idle connection.
    const keepalive = setInterval(() => {
      try {
        res.write(`: ka ${Date.now()}\n\n`);
      } catch {
        clearInterval(keepalive);
      }
    }, 25_000);

    const cleanup = (): void => {
      clearInterval(keepalive);
      unsubscribe(me.id, res);
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('error', cleanup);
    return true;
  }

  // Frontend can ask whether a candidate name maps to a real user (avoids
  // typo-only "no such user" surprises before sending the request).
  if (path.startsWith('/me/friends/check/') && method === 'GET') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const name = decodeURIComponent(path.slice('/me/friends/check/'.length));
    const u = getUserByName(name);
    if (!u || u.id === me.id) sendJson(res, 404, { error: 'not found' });
    else sendJson(res, 200, { id: u.id, name: u.name });
    return true;
  }

  // Resolve a user id to its public info (asker → helper UI needs this).
  const userInfoMatch = path.match(/^\/users-public\/(\d+)$/);
  if (userInfoMatch && method === 'GET') {
    const me = requireAuth(req, res);
    if (!me) return true;
    const u = getUserById(Number(userInfoMatch[1]));
    if (!u) sendJson(res, 404, { error: 'not found' });
    else sendJson(res, 200, { id: u.id, name: u.name });
    return true;
  }

  return false;
}
