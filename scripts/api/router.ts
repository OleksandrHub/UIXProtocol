import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendJson, sendNoContent } from '../api/helpers';
import { handleAuth } from '../api/auth';
import { handleMe } from '../api/me';
import { handleFiles } from '../api/files';
import { handleQuestions } from '../api/questions';
import { handleAdminUsers } from '../api/admin-users';
import { handleDiag } from '../api/diag';
import { handleFriends } from '../api/friends';
import { API_PREFIX } from '../shared/constants';

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url ?? '';
  if (!url.startsWith(`${API_PREFIX}/`) && url !== API_PREFIX) return false;

  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return true;
  }

  // Strip prefix once here so handlers can use bare paths like '/login' and
  // not embed the namespace in every regex/comparison they own.
  const fullPath = url.split('?')[0] ?? '';
  const path = fullPath.slice(API_PREFIX.length) || '/';
  const method = req.method ?? 'GET';

  try {
    if (await handleAuth(req, res, path, method)) return true;
    if (await handleMe(req, res, path, method)) return true;
    if (await handleFiles(req, res, path, method)) return true;
    if (await handleQuestions(req, res, path, method)) return true;
    if (await handleAdminUsers(req, res, path, method)) return true;
    if (await handleDiag(req, res, path, method)) return true;
    if (await handleFriends(req, res, path, method)) return true;

    sendJson(res, 404, { error: 'not found' });
    return true;
  } catch (e) {
    sendJson(res, 500, { error: (e as Error).message });
    return true;
  }
}
