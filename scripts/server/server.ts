import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { handleApi } from '../api/router';
import { getSessionUserId } from '../auth/session';
import { getUserById, pruneOldGeminiErrors } from '../db';
import { environment } from '../../environments/environment';
import { LOADERIO_FILE, LOADERIO_TOKEN, PREVIEW_RE, PUBLIC_DIR } from '../shared/constants';
import { safeJsPath, serveFile } from '../server/static';
import { proxyForUser, proxyHandle } from '../server/proxy';
import { initRelayPool } from '../server/relay-pool';
import { handleUpgrade } from '../server/websocket';

function serveLoaderioVerification(reqPath: string, res: http.ServerResponse): boolean {
  if (
    reqPath !== `/${LOADERIO_TOKEN}.txt` &&
    reqPath !== `/${LOADERIO_TOKEN}.html` &&
    reqPath !== `/${LOADERIO_TOKEN}/`
  ) {
    return false;
  }

  fs.readFile(LOADERIO_FILE, 'utf-8', (err, text) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      'Cache-Control': 'no-store',
    });
    res.end(text);
  });

  return true;
}

const PROJECT_JS_PATHS: Set<string> = (() => {
  try {
    const dir = path.join(PUBLIC_DIR, 'js');
    return new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => `/js/${f}`));
  } catch {
    return new Set<string>();
  }
})();

const requestHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> => {
  const reqPath = (req.url ?? '/').split('?')[0] ?? '/';

  if (serveLoaderioVerification(reqPath, res)) return;

  if (await handleApi(req, res)) return;

  if (reqPath === '/favicon.ico') {
    serveFile(res, path.join(PUBLIC_DIR, 'favicon.ico'));
    return;
  }

  if (reqPath === '/style.css' || reqPath === '/style.css.map') {
    serveFile(res, path.join(PUBLIC_DIR, reqPath.slice(1)));
    return;
  }

  if (reqPath.startsWith('/js/') && PROJECT_JS_PATHS.has(reqPath)) {
    const target = safeJsPath(reqPath);
    if (target) {
      serveFile(res, target);
      return;
    }
  }

  const previewMatch = reqPath.match(PREVIEW_RE);
  if (previewMatch) {
    const id = Number(previewMatch[1]);
    const subpath = previewMatch[2] || '/';
    proxyForUser(req, res, id, subpath, true);
    return;
  }

  if (reqPath === '/admin' || reqPath === '/admin/') {
    const uid = getSessionUserId(req);
    const user = uid != null ? getUserById(uid) : null;
    const file = user?.isAdmin ? 'admin.html' : 'admin-login.html';
    serveFile(res, path.join(PUBLIC_DIR, file));
    return;
  }

  const userMatch = reqPath.match(/^\/(\d+)\/?$/);
  if (userMatch) {
    const id = Number(userMatch[1]);
    const target = getUserById(id);
    if (!target) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('User not found');
      return;
    }
    serveFile(res, path.join(PUBLIC_DIR, 'user.html'));
    return;
  }

  if (reqPath === '/') {
    const uid = getSessionUserId(req);
    if (uid != null) {
      res.writeHead(302, { Location: `/${uid}/` });
      res.end();
      return;
    }
    serveFile(res, path.join(PUBLIC_DIR, 'login.html'));
    return;
  }

  proxyHandle(req, res);
};

const httpServer = http.createServer(requestHandler);
httpServer.on('upgrade', handleUpgrade);

void (async () => {
  await initRelayPool();
  httpServer.listen(environment.port, '0.0.0.0', () => {
    console.log(`✅  HTTP  listening on 0.0.0.0:${environment.port}`);
    console.log(`    Local:    http://localhost:${environment.port}`);
  });
  const pruned = pruneOldGeminiErrors();
  if (pruned > 0) console.log(`[cleanup] pruned ${pruned} old gemini_errors`);
  setInterval(() => {
    const n = pruneOldGeminiErrors();
    if (n > 0) console.log(`[cleanup] pruned ${n} old gemini_errors`);
  }, 24 * 60 * 60 * 1000).unref();
})();
