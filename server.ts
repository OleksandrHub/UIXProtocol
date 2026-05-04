import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';

import { handleApi } from './api';
import { environment } from './environments/environment';

const rawTarget = environment.target.trim();
const TARGET = /^https?:\/\//i.test(rawTarget) ? rawTarget : `https://${rawTarget}`;
const PORT = environment.port;
const targetHost = new URL(TARGET).hostname;

function rewriteUrls(text: string): string {
  return text
    .replaceAll(`https://${targetHost}`, '')
    .replaceAll(`http://${targetHost}`, '');
}

http
  .createServer(async (req, res) => {
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (await handleApi(req, res)) return;

    let reqPath = req.url ?? '/';

    if (reqPath.startsWith(`https://${targetHost}`))
      reqPath = reqPath.slice(`https://${targetHost}`.length) || '/';
    if (reqPath.startsWith(`http://${targetHost}`))
      reqPath = reqPath.slice(`http://${targetHost}`.length) || '/';

    const targetUrl = new URL(reqPath === '/' ? '/' : reqPath, TARGET);

    const incomingHeaders: http.OutgoingHttpHeaders = {
      ...req.headers,
      host: targetHost,
      origin: TARGET,
      referer:
        TARGET +
        (req.headers['referer']
          ? new URL(req.headers['referer'], 'http://x').pathname
          : ''),
    };

    delete incomingHeaders['accept-encoding'];

    const options: https.RequestOptions = {
      hostname: targetUrl.hostname,
      port: 443,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: incomingHeaders,
    };

    const proxy = https.request(options, (proxyRes) => {
      const chunks: Buffer[] = [];
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on('end', () => {
        let buffer = Buffer.concat(chunks);
        const contentType = proxyRes.headers['content-type'] ?? '';
        const isHtml = contentType.includes('text/html');
        const isJs = contentType.includes('javascript');

        if (isHtml || isJs) {
          const text = rewriteUrls(buffer.toString('utf-8'));
          buffer = Buffer.from(text, 'utf-8');
        }

        const headers: http.OutgoingHttpHeaders = { ...proxyRes.headers };

        if (headers['location']) {
          const original = String(headers['location']);
          headers['location'] = rewriteUrls(original);
          console.log(
            `[${proxyRes.statusCode}] Redirect: ${original} → ${headers['location']}`
          );
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

        headers['content-length'] = buffer.length;

        res.writeHead(proxyRes.statusCode ?? 502, headers);
        res.end(buffer);
      });
    });

    req.pipe(proxy);

    proxy.on('error', (err) => {
      console.error('[Proxy Error]', err.message);
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Proxy error: ' + err.message);
    });
  })
  .listen(PORT, () => {
    console.log(`✅  Proxy  →  http://localhost:${PORT}`);
    console.log(`🎯  Target →  ${TARGET}`);
  });
