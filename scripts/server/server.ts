import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { handleApi } from '../api/router';
import { getSessionUserId } from '../auth/session';
import { getUserById, pruneOldGeminiErrors } from '../db';
import { environment } from '../../environments/environment';
import { PREVIEW_RE, PUBLIC_DIR } from '../shared/constants';
import { safeJsPath, serveFile } from '../server/static';
import { proxyForUser, proxyHandle } from '../server/proxy';

const LOADERIO_TOKEN = 'loaderio-213257cff0bbdbf549a9fff9d55a3d2b';
const LOADERIO_FILE = path.join(process.cwd(), `${LOADERIO_TOKEN}.txt`);

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

http
  .createServer(async (req, res) => {
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

    if (reqPath.startsWith('/js/')) {
      const target = safeJsPath(reqPath);
      if (!target) {
        res.writeHead(404);
        res.end();
        return;
      }
      serveFile(res, target);
      return;
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
  })
  .listen(environment.port, '0.0.0.0', () => {
    const port = environment.port;
    console.log(`✅  Backend listening on 0.0.0.0:${port}`);
    console.log(`    Local:    http://localhost:${port}`);
    const pruned = pruneOldGeminiErrors();
    if (pruned > 0) console.log(`[cleanup] pruned ${pruned} old gemini_errors`);
    setInterval(() => {
      const n = pruneOldGeminiErrors();
      if (n > 0) console.log(`[cleanup] pruned ${n} old gemini_errors`);
    }, 24 * 60 * 60 * 1000).unref();
  });
