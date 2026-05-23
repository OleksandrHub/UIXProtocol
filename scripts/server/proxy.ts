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
import type { ProxyOpts } from '../shared/types';

const URL_RE = /https?:\/\/[^\s"'<>`\\)]+/gi;
const PROXY_PREFIX_SLASH = `${PROXY_PREFIX}/`;
const STRIP_HOST_RE = /^https?:\/\/[^/]+/;

function rewriteAllUrls(text: string, targetHost: string): string {
  return text.replace(URL_RE, (match, offset: number, full: string) => {
    if (
      offset >= PROXY_PREFIX_SLASH.length &&
      full.slice(offset - PROXY_PREFIX_SLASH.length, offset) === PROXY_PREFIX_SLASH
    ) {
      return match;
    }
    const lower = match.toLowerCase();
    const hostStart = lower.indexOf('://') + 3;
    const hostEnd = lower.indexOf('/', hostStart);
    const host = hostEnd < 0 ? lower.slice(hostStart) : lower.slice(hostStart, hostEnd);
    if (host === targetHost.toLowerCase()) {
      return match.replace(STRIP_HOST_RE, '');
    }
    return `${PROXY_PREFIX_SLASH}${match}`;
  });
}

function rewriteLocationToProxy(value: string): string {
  if (/^https?:\/\//i.test(value)) return `${PROXY_PREFIX}/${value}`;
  if (value.startsWith('//')) return `${PROXY_PREFIX}/https:${value}`;
  return value;
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
var W=window,D=document,N=navigator;
W.__uixKeepActive=true;
var def=function(o,k,v){try{Object.defineProperty(o,k,{configurable:true,get:function(){return v;}});}catch(e){}};

// Page Visibility API + vendor-prefixed variants
def(Document.prototype,'hidden',false);
def(Document.prototype,'webkitHidden',false);
def(Document.prototype,'mozHidden',false);
def(Document.prototype,'msHidden',false);
def(Document.prototype,'visibilityState','visible');
def(Document.prototype,'webkitVisibilityState','visible');
def(Document.prototype,'mozVisibilityState','visible');
def(Document.prototype,'msVisibilityState','visible');

// Page Lifecycle API
def(Document.prototype,'wasDiscarded',false);
def(Document.prototype,'prerendering',false);
try{def(Object.getPrototypeOf(D)||Document.prototype,'visibilityState','visible');}catch(e){}

// Focus
try{D.hasFocus=function(){return true;};}catch(e){}

// navigator.userActivation — many sites gate features behind it
try{
  var fakeUA={hasBeenActive:true,isActive:true};
  Object.defineProperty(N,'userActivation',{configurable:true,get:function(){return fakeUA;}});
}catch(e){}

// Always report online
try{Object.defineProperty(N,'onLine',{configurable:true,get:function(){return true;}});}catch(e){}

// Block events that signal becoming inactive
var BLOCK={
  visibilitychange:1,webkitvisibilitychange:1,mozvisibilitychange:1,msvisibilitychange:1,
  blur:1,pagehide:1,freeze:1,offline:1
};
var isTop=function(t){return t===D||t===W||t===W.frameElement;};
var origAdd=EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener=function(type,listener,options){
  if(typeof type==='string'&&BLOCK[type.toLowerCase()]&&isTop(this))return;
  return origAdd.call(this,type,listener,options);
};
var origRem=EventTarget.prototype.removeEventListener;
EventTarget.prototype.removeEventListener=function(type,listener,options){
  if(typeof type==='string'&&BLOCK[type.toLowerCase()]&&isTop(this))return;
  return origRem.call(this,type,listener,options);
};
var origDispatch=EventTarget.prototype.dispatchEvent;
EventTarget.prototype.dispatchEvent=function(ev){
  if(ev&&typeof ev.type==='string'&&BLOCK[ev.type.toLowerCase()]&&isTop(this))return true;
  return origDispatch.call(this,ev);
};

// on* event-handler properties
['onvisibilitychange','onwebkitvisibilitychange','onmozvisibilitychange','onmsvisibilitychange',
 'onblur','onpagehide','onfreeze','onoffline'].forEach(function(p){
  try{Object.defineProperty(D,p,{configurable:true,get:function(){return null;},set:function(){}});}catch(e){}
  try{Object.defineProperty(W,p,{configurable:true,get:function(){return null;},set:function(){}});}catch(e){}
});

// Emit "visible" + "focus" once after DOM is ready so sites that subscribed early
// see the page in an active state.
var fire=function(){
  try{var ev=new Event('visibilitychange');origDispatch.call(D,ev);}catch(e){}
  try{var ev2=new Event('focus');origDispatch.call(W,ev2);}catch(e){}
  try{var ev3=new Event('pageshow');origDispatch.call(W,ev3);}catch(e){}
};
if(D.readyState==='loading')D.addEventListener('DOMContentLoaded',fire,{once:true});
else setTimeout(fire,0);
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

const RUNTIME_URL_REWRITE_SCRIPT = `<script data-uix-urlhook>(function(){try{
var origin=location.origin;
function rewrite(u){
  if(typeof u!=='string'||!u)return u;
  var c=u.charAt(0);
  if(c==='#'||c==='?')return u;
  if(/^[a-z][a-z0-9+.-]*:/i.test(u)&&!/^https?:/i.test(u))return u;
  try{
    var url=new URL(u,location.href);
    if(url.protocol!=='http:'&&url.protocol!=='https:')return u;
    if(url.origin===origin)return u;
    return '/_p/'+url.href;
  }catch(e){return u;}
}
function hookProp(proto,prop){
  try{
    var d=Object.getOwnPropertyDescriptor(proto,prop);
    if(!d||!d.set)return;
    var origSet=d.set,origGet=d.get;
    Object.defineProperty(proto,prop,{
      configurable:true,enumerable:d.enumerable,
      get:function(){return origGet?origGet.call(this):undefined;},
      set:function(v){origSet.call(this,rewrite(v));}
    });
  }catch(e){}
}
hookProp(HTMLScriptElement.prototype,'src');
hookProp(HTMLLinkElement.prototype,'href');
hookProp(HTMLImageElement.prototype,'src');
hookProp(HTMLIFrameElement.prototype,'src');
if(typeof HTMLSourceElement!=='undefined')hookProp(HTMLSourceElement.prototype,'src');
if(typeof HTMLMediaElement!=='undefined')hookProp(HTMLMediaElement.prototype,'src');
try{
  var origSetAttr=Element.prototype.setAttribute;
  Element.prototype.setAttribute=function(name,value){
    try{
      var ln=String(name).toLowerCase();
      var tn=this.tagName?this.tagName.toLowerCase():'';
      if(ln==='src'&&(tn==='script'||tn==='img'||tn==='iframe'||tn==='source'||tn==='audio'||tn==='video')){
        value=rewrite(value);
      }else if(ln==='href'&&tn==='link'){
        value=rewrite(value);
      }
    }catch(e){}
    return origSetAttr.call(this,name,value);
  };
}catch(e){}
try{
  if(typeof window.fetch==='function'){
    var origFetch=window.fetch;
    window.fetch=function(input,init){
      try{
        if(typeof input==='string')input=rewrite(input);
      }catch(e){}
      return origFetch.call(this,input,init);
    };
  }
}catch(e){}
try{
  var origOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    var args=Array.prototype.slice.call(arguments);
    try{args[1]=rewrite(url);}catch(e){}
    return origOpen.apply(this,args);
  };
}catch(e){}
}catch(e){}})();</script>`;

const VIEWPORT_RE = /<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i;
const HEAD_RE = /<head\b([^>]*)>/i;
const INJECTED_HEAD_PREFIX = KEEP_ACTIVE_SCRIPT + IP_DIAG_SCRIPT + RUNTIME_URL_REWRITE_SCRIPT;

function injectHtmlHelpers(html: string): string {
  const hasViewport = VIEWPORT_RE.test(html);
  let body = hasViewport ? html.replace(VIEWPORT_RE, PERMISSIVE_VIEWPORT) : html;
  if (HEAD_RE.test(body)) {
    const injection = hasViewport
      ? `<head$1>${INJECTED_HEAD_PREFIX}`
      : `<head$1>${INJECTED_HEAD_PREFIX}${PERMISSIVE_VIEWPORT}`;
    return body.replace(HEAD_RE, injection);
  }
  return INJECTED_HEAD_PREFIX + body;
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
    referer:
      TARGET +
      (req.headers['referer'] ? new URL(req.headers['referer'], 'http://x').pathname : ''),
  };
  if (cleanedCookie) incomingHeaders['cookie'] = cleanedCookie;
  else delete incomingHeaders['cookie'];
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
      const needsRewrite = ct.includes('text/html') || ct.includes('javascript');

      if (needsRewrite) {
        const enc = String(proxyRes.headers['content-encoding'] ?? '').toLowerCase();
        let stream: Readable = proxyRes;
        if (enc === 'gzip') stream = proxyRes.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = proxyRes.pipe(zlib.createInflate());
        else if (enc === 'br') stream = proxyRes.pipe(zlib.createBrotliDecompress());
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => {
          let text = rewriteAllUrls(Buffer.concat(chunks).toString('utf-8'), targetHost);
          if (ct.includes('text/html')) {
            text = injectHtmlHelpers(text);
          }
          const body = Buffer.from(text, 'utf-8');
          delete headers['content-encoding'];
          headers['content-length'] = body.length;
          res.writeHead(proxyRes.statusCode ?? 502, headers);
          res.end(body);
        });
        stream.on('error', (err: Error) => {
          console.error('[Proxy decode error]', err.message);
          if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('decode error: ' + err.message);
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
  performProxy(req, res, target, reqPath, userId, preview ? { setPreviewCookie: userId } : {});
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
