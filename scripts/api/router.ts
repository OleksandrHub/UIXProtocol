import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendJson, sendNoContent } from '../api/helpers';
import { handleAuth } from '../api/auth';
import { handleMe } from '../api/me';
import { handleFiles } from '../api/files';
import { handleQuestions } from '../api/questions';
import { handleAdminUsers } from '../api/admin-users';
import { handleDiag } from '../api/diag';

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url ?? '';
  if (!url.startsWith('/api/') && url !== '/api') return false;

  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return true;
  }

  const path = url.split('?')[0] ?? '';
  const method = req.method ?? 'GET';

  try {
    if (await handleAuth(req, res, path, method)) return true;
    if (await handleMe(req, res, path, method)) return true;
    if (await handleFiles(req, res, path, method)) return true;
    if (await handleQuestions(req, res, path, method)) return true;
    if (await handleAdminUsers(req, res, path, method)) return true;
    if (await handleDiag(req, res, path, method)) return true;

    sendJson(res, 404, { error: 'not found' });
    return true;
  } catch (e) {
    sendJson(res, 500, { error: (e as Error).message });
    return true;
  }
}
