import * as http from 'node:http';
import * as path from 'node:path';

import { handleApi } from '../api/router';
import { getSessionUserId } from '../auth/session';
import { getUserById } from '../db';
import { environment } from '../../environments/environment';
import { PREVIEW_RE, PUBLIC_DIR } from '../shared/constants';
import { safeJsPath, serveFile } from '../server/static';
import { proxyForUser, proxyHandle } from '../server/proxy';

http
  .createServer(async (req, res) => {
    const reqPath = (req.url ?? '/').split('?')[0] ?? '/';

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
  .listen(environment.port, () => {
    console.log(`✅  Server → http://localhost:${environment.port}`);
  });
