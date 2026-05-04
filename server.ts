import * as http from 'node:http';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { URL } from 'node:url';

import { handleApi } from './api';
import { getSessionUserId, SESSION_COOKIE_NAME } from './session';
import { getUserById } from './db';
import { environment } from './environments/environment';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const PROXY_PREFIX = '/_p';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function serveFile(res: http.ServerResponse, file: string): void {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function safeStaticPath(reqPath: string): string | null {
  const rel = decodeURIComponent(reqPath.replace(/^\/static\//, ''));
  const target = path.normalize(path.join(PUBLIC_DIR, 'static', rel));
  const root = path.join(PUBLIC_DIR, 'static') + path.sep;
  return target.startsWith(root) ? target : null;
}

function rewriteUrls(text: string, targetHost: string): string {
  return text
    .replaceAll(`https://${targetHost}`, '')
    .replaceAll(`http://${targetHost}`, '');
}

function proxyHandle(req: http.IncomingMessage, res: http.ServerResponse): void {
  const uid = getSessionUserId(req);
  if (uid == null) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Not authenticated');
    return;
  }
  const user = getUserById(uid);
  if (!user) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('User not found');
    return;
  }
  const targetRaw = (user.targetUrl || environment.defaultTarget).trim();
  if (!targetRaw) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('No target URL set for this user');
    return;
  }
  const TARGET = /^https?:\/\//i.test(targetRaw) ? targetRaw : `https://${targetRaw}`;
  let targetHost: string;
  try {
    targetHost = new URL(TARGET).hostname;
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Invalid target URL');
    return;
  }

  let reqPath = req.url ?? '/';
  if (reqPath.startsWith(PROXY_PREFIX)) reqPath = reqPath.slice(PROXY_PREFIX.length) || '/';
  if (reqPath.startsWith(`https://${targetHost}`))
    reqPath = reqPath.slice(`https://${targetHost}`.length) || '/';
  if (reqPath.startsWith(`http://${targetHost}`))
    reqPath = reqPath.slice(`http://${targetHost}`.length) || '/';

  const targetUrl = new URL(reqPath === '/' ? '/' : reqPath, TARGET);

  const cookieHeader = req.headers['cookie'];
  let cleanedCookie: string | undefined;
  if (typeof cookieHeader === 'string' && cookieHeader.length) {
    const filtered = cookieHeader
      .split(';')
      .map((s) => s.trim())
      .filter((s) => !s.startsWith(`${SESSION_COOKIE_NAME}=`))
      .join('; ');
    cleanedCookie = filtered || undefined;
  }

  const incomingHeaders: http.OutgoingHttpHeaders = {
    ...req.headers,
    host: targetHost,
    origin: TARGET,
    referer:
      TARGET +
      (req.headers['referer'] ? new URL(req.headers['referer'], 'http://x').pathname : ''),
  };
  if (cleanedCookie) incomingHeaders['cookie'] = cleanedCookie;
  else delete incomingHeaders['cookie'];
  delete incomingHeaders['accept-encoding'];

  const isHttps = TARGET.startsWith('https:');
  const lib = isHttps ? https : http;
  const port = isHttps ? 443 : 80;

  const proxyReq = lib.request(
    {
      hostname: targetUrl.hostname,
      port,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: incomingHeaders,
    },
    (proxyRes) => {
      const headers: http.OutgoingHttpHeaders = { ...proxyRes.headers };

      if (headers['location']) {
        headers['location'] = rewriteUrls(String(headers['location']), targetHost);
      }
      const setCookie = headers['set-cookie'];
      if (Array.isArray(setCookie)) {
        headers['set-cookie'] = setCookie.map((c) =>
          c
            .replace(/Domain=[^;]+;?\s*/gi, '')
            .replace(/Secure;?\s*/gi, '')
            .replace(/SameSite=[^;]+;?\s*/gi, 'SameSite=Lax; ')
        );
      }
      delete headers['x-frame-options'];
      delete headers['content-security-policy'];
      delete headers['content-security-policy-report-only'];
      delete headers['strict-transport-security'];
      delete headers['feature-policy'];

      headers['permissions-policy'] = environment.iframePermissions
        .map((p) => `${p}=*`)
        .join(', ');

      const ct = String(proxyRes.headers['content-type'] ?? '');
      const needsRewrite = ct.includes('text/html') || ct.includes('javascript');

      if (needsRewrite) {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (c: Buffer) => chunks.push(c));
        proxyRes.on('end', () => {
          const body = Buffer.from(
            rewriteUrls(Buffer.concat(chunks).toString('utf-8'), targetHost),
            'utf-8'
          );
          headers['content-length'] = body.length;
          res.writeHead(proxyRes.statusCode ?? 502, headers);
          res.end(body);
        });
      } else {
        res.writeHead(proxyRes.statusCode ?? 502, headers);
        proxyRes.pipe(res);
      }
    }
  );

  req.pipe(proxyReq);

  proxyReq.on('error', (err) => {
    console.error('[Proxy Error]', err.message);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Proxy error: ' + err.message);
  });
}

http
  .createServer(async (req, res) => {
    const reqPath = (req.url ?? '/').split('?')[0] ?? '/';

    if (await handleApi(req, res)) return;

    if (reqPath === '/favicon.ico') {
      serveFile(res, path.join(PUBLIC_DIR, 'favicon.ico'));
      return;
    }

    if (reqPath.startsWith('/static/')) {
      const target = safeStaticPath(reqPath);
      if (!target) {
        res.writeHead(404);
        res.end();
        return;
      }
      serveFile(res, target);
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
      const uid = getSessionUserId(req);
      const file = uid === id ? 'user.html' : 'user-login.html';
      serveFile(res, path.join(PUBLIC_DIR, file));
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
