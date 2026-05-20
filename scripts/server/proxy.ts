import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';

import { getUserById } from '../db';
import { environment } from '../../environments/environment';
import {
  PREVIEW_COOKIE,
  PROXY_PREFIX,
  SESSION_COOKIE_NAME,
} from '../shared/constants';
import { getSessionUserId, parseCookie } from '../auth/session';
import type { ProxyOpts } from '../shared/types';

function rewriteUrls(text: string, targetHost: string): string {
  return text
    .replaceAll(`https://${targetHost}`, '')
    .replaceAll(`http://${targetHost}`, '');
}

const PERMISSIVE_VIEWPORT =
  '<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=0.1, maximum-scale=5">';

// const KEEP_ACTIVE_SCRIPT = `<script>(function(){try{
// var W=window,D=document;
// var def=function(o,k,v){try{Object.defineProperty(o,k,{configurable:true,get:function(){return v;}});}catch(e){}};
// def(Document.prototype,'hidden',false);
// def(Document.prototype,'webkitHidden',false);
// def(Document.prototype,'visibilityState','visible');
// def(Document.prototype,'webkitVisibilityState','visible');
// try{D.hasFocus=function(){return true;};}catch(e){}
// var BLOCK={visibilitychange:1,webkitvisibilitychange:1,mozvisibilitychange:1,msvisibilitychange:1,blur:1,pagehide:1,freeze:1};
// var isTop=function(t){return t===D||t===W;};
// var origAdd=EventTarget.prototype.addEventListener;
// EventTarget.prototype.addEventListener=function(type,listener,options){
//   if(typeof type==='string'&&BLOCK[type.toLowerCase()]&&isTop(this))return;
//   return origAdd.call(this,type,listener,options);
// };
// var origDispatch=EventTarget.prototype.dispatchEvent;
// EventTarget.prototype.dispatchEvent=function(ev){
//   if(ev&&typeof ev.type==='string'&&BLOCK[ev.type.toLowerCase()]&&isTop(this))return true;
//   return origDispatch.call(this,ev);
// };
// ['onvisibilitychange','onwebkitvisibilitychange','onblur','onpagehide','onfreeze'].forEach(function(p){
//   try{Object.defineProperty(D,p,{configurable:true,get:function(){return null;},set:function(){}});}catch(e){}
//   try{Object.defineProperty(W,p,{configurable:true,get:function(){return null;},set:function(){}});}catch(e){}
// });
// }catch(e){}})();</script>`;

// function injectKeepActive(html: string): string {
//   if (/<head\b[^>]*>/i.test(html)) {
//     return html.replace(/<head\b([^>]*)>/i, `<head$1>${KEEP_ACTIVE_SCRIPT}`);
//   }
//   return KEEP_ACTIVE_SCRIPT + html;
// }

function rewriteViewport(html: string): string {
  const viewportRe = /<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i;
  if (viewportRe.test(html)) {
    return html.replace(viewportRe, PERMISSIVE_VIEWPORT);
  }
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b([^>]*)>/i, `<head$1>${PERMISSIVE_VIEWPORT}`);
  }
  return html;
}

function performProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  targetRaw: string,
  pathOnly: string,
  opts: ProxyOpts = {}
): void {
  const TARGET = /^https?:\/\//i.test(targetRaw) ? targetRaw : `https://${targetRaw}`;
  let targetHost: string;
  try {
    targetHost = new URL(TARGET).hostname;
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Invalid target URL');
    return;
  }

  let reqPath = pathOnly;
  if (reqPath.startsWith(`https://${targetHost}`))
    reqPath = reqPath.slice(`https://${targetHost}`.length) || '/';
  if (reqPath.startsWith(`http://${targetHost}`))
    reqPath = reqPath.slice(`http://${targetHost}`.length) || '/';

  const targetUrl = reqPath === '/' ? new URL(TARGET) : new URL(reqPath, TARGET);

  const cookieHeader = req.headers['cookie'];
  let cleanedCookie: string | undefined;
  if (opts.sendCookies !== false && typeof cookieHeader === 'string' && cookieHeader.length) {
    const filtered = cookieHeader
      .split(';')
      .map((s) => s.trim())
      .filter(
        (s) => !s.startsWith(`${SESSION_COOKIE_NAME}=`) && !s.startsWith(`${PREVIEW_COOKIE}=`)
      )
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
      if (opts.stripSetCookie) {
        delete headers['set-cookie'];
      } else {
        const setCookie = headers['set-cookie'];
        if (Array.isArray(setCookie)) {
          headers['set-cookie'] = setCookie.map((c) =>
            c
              .replace(/Domain=[^;]+;?\s*/gi, '')
              .replace(/Secure;?\s*/gi, '')
              .replace(/SameSite=[^;]+;?\s*/gi, 'SameSite=Lax; ')
          );
        }
      }
      if (opts.setPreviewCookie != null) {
        const cookie = `${PREVIEW_COOKIE}=${opts.setPreviewCookie}; HttpOnly; Path=/; SameSite=Lax`;
        const sc = headers['set-cookie'];
        if (Array.isArray(sc)) sc.push(cookie);
        else if (typeof sc === 'string') headers['set-cookie'] = [sc, cookie];
        else headers['set-cookie'] = [cookie];
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
          let text = rewriteUrls(Buffer.concat(chunks).toString('utf-8'), targetHost);
          // if (ct.includes('text/html')) {
          //   text = injectKeepActive(text);
          //   text = rewriteViewport(text);
          // }
          const body = Buffer.from(text, 'utf-8');
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

export function proxyForUser(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  userId: number,
  reqPath: string,
  preview: boolean
): void {
  const user = getUserById(userId);
  if (!user) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('User not found');
    return;
  }
  const target = (user.targetUrl || environment.defaultTarget).trim();
  if (!target) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('No target URL set for this user');
    return;
  }
  performProxy(req, res, target, reqPath, preview ? { setPreviewCookie: userId } : {});
}

function getCookiePreviewId(req: http.IncomingMessage): number | null {
  const v = parseCookie(req, PREVIEW_COOKIE);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getRefererPreviewId(req: http.IncomingMessage): number | null {
  const referer = req.headers['referer'];
  if (typeof referer !== 'string') return null;
  try {
    const r = new URL(referer);
    const m = r.pathname.match(/^\/_p\/(\d+)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

export function proxyHandle(req: http.IncomingMessage, res: http.ServerResponse): void {
  let reqPath = req.url ?? '/';
  if (reqPath.startsWith(PROXY_PREFIX + '/')) {
    reqPath = reqPath.slice(PROXY_PREFIX.length) || '/';
  } else if (reqPath === PROXY_PREFIX) {
    reqPath = '/';
  }

  const uid = getSessionUserId(req);
  if (uid != null) {
    proxyForUser(req, res, uid, reqPath, false);
    return;
  }

  const refId = getRefererPreviewId(req);
  if (refId != null) {
    proxyForUser(req, res, refId, reqPath, true);
    return;
  }

  const cookieId = getCookiePreviewId(req);
  if (cookieId != null) {
    proxyForUser(req, res, cookieId, reqPath, true);
    return;
  }

  res.writeHead(403, { 'Content-Type': 'text/plain' });
  res.end('Not authenticated');
}
