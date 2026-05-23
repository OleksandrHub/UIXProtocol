import * as http from 'node:http';
import * as https from 'node:https';
import * as zlib from 'node:zlib';
import type { Readable } from 'node:stream';
import { URL } from 'node:url';

import { getUserById } from '../db';
import { environment } from '../../environments/environment';
import {
  PREVIEW_COOKIE,
  PROXY_PREFIX,
  SESSION_COOKIE_NAME,
} from '../shared/constants';
import { getSessionUserId, parseCookie } from '../auth/session';
import { pickRelay, reportRelayFailure } from './relay-pool';
import { HostStripStream } from './stream-rewrite';
import type { ProxyOpts } from '../shared/types';


function rewriteAllUrls(text: string, targetHost: string): string {
  const tHostLower = targetHost.toLowerCase();
  const absRe = new RegExp(`https?://${tHostLower.replace(/\./g, '\\.')}`, 'gi');
  const step1 = text.replace(absRe, '');
  const protoRelRe = new RegExp(`//${tHostLower.replace(/\./g, '\\.')}`, 'gi');
  return step1.replace(protoRelRe, '');
}

function rewriteLocationToProxy(value: string): string {

  return value;
}

function buildOutboundReferer(
  raw: string | string[] | undefined,
  target: string,
  targetHost: string
): string {
  if (typeof raw !== 'string' || !raw) return target;
  let p: string;
  try {
    const u = new URL(raw, 'http://x');
    p = u.pathname + u.search;
  } catch {
    return target;
  }
  if (p.startsWith(`${PROXY_PREFIX}/`)) p = p.slice(PROXY_PREFIX.length);
  else if (p === PROXY_PREFIX) p = '/';
  const cross = p.match(/^\/(https?:\/\/[^/]+)(\/.*)?(\?.*)?$/i);
  if (cross) return cross[1]! + (cross[2] || '/') + (cross[3] || '');
  const base = `https://${targetHost}`;
  if (p.startsWith(base)) return p;
  if (!p.startsWith('/')) p = '/' + p;
  return base + p;
}

function normalizeIp(ip: string | undefined): string {
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

function buildClientForwarding(req: http.IncomingMessage): {
  xff: string;
  realIp: string;
  forwarded: string;
} {
  const peer = normalizeIp(req.socket?.remoteAddress);
  const incoming = req.headers['x-forwarded-for'];
  const incomingStr =
    typeof incoming === 'string' ? incoming : Array.isArray(incoming) ? incoming.join(', ') : '';
  const xff = incomingStr && peer ? `${incomingStr}, ${peer}` : incomingStr || peer;
  const realIp = (incomingStr ? incomingStr.split(',')[0]!.trim() : peer) || peer;
  const forwarded = peer ? `for="${peer.includes(':') ? `[${peer}]` : peer}"` : '';
  return { xff, realIp, forwarded };
}

const PERMISSIVE_VIEWPORT =
  '<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=0.1, maximum-scale=5">';

const KEEP_ACTIVE_SCRIPT = `<script data-uix-keepactive>(function(){try{
var W=window,D=document;
W.__uixKeepActive=true;
var def=function(o,k,v){try{Object.defineProperty(o,k,{configurable:true,get:function(){return v;}});}catch(e){}};

// Only fake "page is visible" — this is what stops browsers from throttling
// background timers. Vendor-prefixed variants are kept for older sites that
// poll them directly.
def(Document.prototype,'hidden',false);
def(Document.prototype,'webkitHidden',false);
def(Document.prototype,'mozHidden',false);
def(Document.prototype,'msHidden',false);
def(Document.prototype,'visibilityState','visible');
def(Document.prototype,'webkitVisibilityState','visible');
def(Document.prototype,'mozVisibilityState','visible');
def(Document.prototype,'msVisibilityState','visible');

// Block only the Page Lifecycle freeze event so the browser doesn't discard
// the iframe when the tab is backgrounded. visibilitychange / blur / pagehide
// / offline keep firing — those are real-user signals Cloudflare expects to
// see, and suppressing them is a bot tell.
var origAdd=EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener=function(type,listener,options){
  if(typeof type==='string'&&type.toLowerCase()==='freeze'&&(this===D||this===W))return;
  return origAdd.call(this,type,listener,options);
};
}catch(e){}})();</script>`;


const IP_DIAG_SCRIPT = `<script data-uix-ipdiag>(function(){
var TAG='%c[UIX-IP]',S='color:#2a6df4;font-weight:600';
console.log(TAG+' === діагностика IP стартує ===',S);

// 1) IP як бачить браузер напряму (реальний IP студента)
fetch('https://api.ipify.org?format=json').then(function(r){return r.json();}).then(function(d){
  console.log(TAG+' браузер → зовні (реальний IP клієнта):',S,d.ip);
}).catch(function(e){console.warn(TAG+' браузер-тест впав:',S,e.message);});

// 2) IP центрального сервера (прямий вихід, повз ноут-relay)
fetch('/api/_diag/server-ip',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(d){
  console.log(TAG+' центральний сервер → зовні (прямий):',S,d.ip);
}).catch(function(e){console.warn(TAG+' server-ip впав:',S,e.message);});

// 2b) IP через ноут-relay'ї — це IP'и які бачить target для проксованого контенту
fetch('/api/_diag/relay-ip',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(d){
  if(d && Array.isArray(d.relays) && d.relays.length){
    d.relays.forEach(function(r){
      if(r.ip) console.log(TAG+' relay '+r.url+' → '+r.ip,S);
      else console.warn(TAG+' relay '+r.url+' → no IP ('+(r.error||'unknown')+')',S);
    });
  } else {
    console.warn(TAG+' relay-ip відповів без relays:',S,d);
  }
}).catch(function(e){console.warn(TAG+' relay-ip впав (relay не налаштований чи недоступний):',S,e.message);});
})();</script>`;


const TURNSTILE_STUB_SCRIPT = `<script data-uix-turnstile-stub>(function(){try{
var nextId=0;
var stub={
  render:function(){return 'uix-stub-'+(++nextId);},
  reset:function(){},
  remove:function(){},
  getResponse:function(){return '';},
  execute:function(){},
  isExpired:function(){return false;},
  ready:function(cb){if(typeof cb==='function')setTimeout(cb,0);}
};
try{Object.defineProperty(window,'turnstile',{value:stub,writable:false,configurable:false});}catch(e){window.turnstile=stub;}
}catch(e){}})();</script>`;

const VIEWPORT_RE = /<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i;
const HEAD_RE = /<head\b([^>]*)>/i;
const INTEGRITY_ATTR_RE = /\s+integrity\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const CROSSORIGIN_ATTR_RE = /\s+crossorigin\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

const TURNSTILE_SCRIPT_TAG_RE = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*challenges\.cloudflare\.com\/turnstile\/[^"']*["'][^>]*>\s*<\/script>/gi;

function injectHtmlHelpers(html: string, devTools: boolean): string {
  // Diagnostic injections (IP probes + Turnstile stub) are gated behind the
  // per-user dev-tools flag. Default is OFF: regular users get a clean console
  // and Cloudflare Turnstile widgets run their real challenge so the target
  // site's security check actually passes.
  const prefix = devTools
    ? TURNSTILE_STUB_SCRIPT + KEEP_ACTIVE_SCRIPT + IP_DIAG_SCRIPT
    : KEEP_ACTIVE_SCRIPT;
  const hasViewport = VIEWPORT_RE.test(html);
  let body = hasViewport ? html.replace(VIEWPORT_RE, PERMISSIVE_VIEWPORT) : html;
  body = body.replace(INTEGRITY_ATTR_RE, '').replace(CROSSORIGIN_ATTR_RE, '');
  if (devTools) body = body.replace(TURNSTILE_SCRIPT_TAG_RE, '');
  if (HEAD_RE.test(body)) {
    const injection = hasViewport
      ? `<head$1>${prefix}`
      : `<head$1>${prefix}${PERMISSIVE_VIEWPORT}`;
    return body.replace(HEAD_RE, injection);
  }
  return prefix + body;
}

function pickForwardProxy(userId: number | null): URL | null {
  return pickRelay(userId);
}

function performProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  targetRaw: string,
  pathOnly: string,
  userId: number | null,
  opts: ProxyOpts = {}
): void {
  // Service Worker registration always carries the `Service-Worker: script`
  // request header. If we proxied the real SW, the browser would register it
  // against our origin, where it would intercept future navigation and cache
  // target-bound responses on the wrong host. Returning an empty JS lets
  // `navigator.serviceWorker.register()` resolve cleanly while the SW does
  // nothing (no fetch handler, no caching, no install).
  if (req.headers['service-worker'] === 'script') {
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': '/',
    });
    res.end('// uix: neutralised service worker\n');
    return;
  }

  const crossOrigin = pathOnly.match(/^\/(https?:\/\/[^/]+)(\/.*)?$/i);
  if (crossOrigin) {
    targetRaw = crossOrigin[1]!;
    pathOnly = crossOrigin[2] || '/';
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

  const fwd = buildClientForwarding(req);
  const incomingHeaders: http.OutgoingHttpHeaders = {
    ...req.headers,
    host: targetHost,
    origin: TARGET,
    referer: buildOutboundReferer(req.headers['referer'], TARGET, targetHost),
  };
  if (cleanedCookie) incomingHeaders['cookie'] = cleanedCookie;
  else delete incomingHeaders['cookie'];
  incomingHeaders['accept-encoding'] = 'gzip, deflate, br';
  if (fwd.xff) incomingHeaders['x-forwarded-for'] = fwd.xff;
  if (fwd.realIp) incomingHeaders['x-real-ip'] = fwd.realIp;
  if (fwd.forwarded) incomingHeaders['forwarded'] = fwd.forwarded;
  incomingHeaders['x-forwarded-proto'] = 'https';
  incomingHeaders['x-forwarded-host'] = targetHost;

  const fwdProxy = pickForwardProxy(userId);
  let outboundHostname: string;
  let outboundPort: number;
  let outboundPath: string;
  let outboundLib: typeof http | typeof https;
  if (fwdProxy) {
    outboundHostname = fwdProxy.hostname;
    outboundPort = Number(fwdProxy.port) || (fwdProxy.protocol === 'https:' ? 443 : 80);
    outboundPath = (fwdProxy.pathname === '/' ? '' : fwdProxy.pathname) + (fwdProxy.search ?? '');
    if (!outboundPath) outboundPath = '/';
    outboundLib = fwdProxy.protocol === 'https:' ? https : http;
    incomingHeaders.host = fwdProxy.host;
 
    delete incomingHeaders['x-forwarded-for'];
    delete incomingHeaders['x-real-ip'];
    delete incomingHeaders['forwarded'];
    delete incomingHeaders['x-forwarded-proto'];
    delete incomingHeaders['x-forwarded-host'];
    incomingHeaders['x-relay-url'] = targetUrl.href;
    if (environment.forwardProxySecret) {
      incomingHeaders['x-relay-secret'] = environment.forwardProxySecret;
    }
  } else {
    console.warn(`Proxy work on central server without`);
    outboundHostname = targetUrl.hostname;
    outboundPort = TARGET.startsWith('https:') ? 443 : 80;
    outboundPath = targetUrl.pathname + targetUrl.search;
    outboundLib = TARGET.startsWith('https:') ? https : http;
  }

  const proxyReq = outboundLib.request(
    {
      hostname: outboundHostname,
      port: outboundPort,
      path: outboundPath,
      method: req.method,
      headers: incomingHeaders,
    },
    (proxyRes) => {
      const headers: http.OutgoingHttpHeaders = { ...proxyRes.headers };

      if (headers['location']) {
        const loc = String(headers['location']);
        const stripped = loc.startsWith(`https://${targetHost}`)
          ? loc.slice(`https://${targetHost}`.length) || '/'
          : loc.startsWith(`http://${targetHost}`)
          ? loc.slice(`http://${targetHost}`.length) || '/'
          : loc;
        headers['location'] = rewriteLocationToProxy(stripped);
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
      const isHtml = ct.includes('text/html');
      const isJs = ct.includes('javascript');

      if (!isHtml && !isJs) {
        res.writeHead(proxyRes.statusCode ?? 502, headers);
        proxyRes.pipe(res);
        return;
      }

      const enc = String(proxyRes.headers['content-encoding'] ?? '').toLowerCase();
      let stream: Readable = proxyRes;
      if (enc === 'gzip') stream = proxyRes.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = proxyRes.pipe(zlib.createInflate());
      else if (enc === 'br') stream = proxyRes.pipe(zlib.createBrotliDecompress());

      const onDecodeError = (err: Error): void => {
        console.error('[Proxy decode error]', err.message);
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('decode error: ' + err.message);
      };
      stream.on('error', onDecodeError);

      if (isJs) {
        // JS responses can be megabytes (Moodle/Angular bundles). Streaming
        // through HostStripStream avoids buffering the whole file: chunks are
        // rewritten and forwarded as they arrive, with a small overlap to
        // catch matches that straddle a chunk boundary.
        delete headers['content-encoding'];
        delete headers['content-length'];
        res.writeHead(proxyRes.statusCode ?? 502, headers);
        stream.pipe(new HostStripStream(targetHost)).pipe(res);
        return;
      }

      // HTML still buffers: we need the full document to find <head> and
      // inject viewport / activity / (optional) dev-tools scripts. HTML is
      // typically 10-200KB so the buffering cost is negligible.
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        let text = rewriteAllUrls(Buffer.concat(chunks).toString('utf-8'), targetHost);
        text = injectHtmlHelpers(text, opts.devTools === true);
        const body = Buffer.from(text, 'utf-8');
        delete headers['content-encoding'];
        headers['content-length'] = body.length;
        res.writeHead(proxyRes.statusCode ?? 502, headers);
        res.end(body);
      });
    }
  );

  req.pipe(proxyReq);

  proxyReq.on('error', (err) => {
    console.error('[Proxy Error]', err.message);
    if (fwdProxy) reportRelayFailure(fwdProxy, err.message);
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
  const opts: ProxyOpts = { devTools: user.devTools };
  if (preview) opts.setPreviewCookie = userId;
  performProxy(req, res, target, reqPath, userId, opts);
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
