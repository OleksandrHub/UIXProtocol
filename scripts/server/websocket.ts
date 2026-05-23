import * as http from 'node:http';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { URL } from 'node:url';

import { getSessionUserId } from '../auth/session';
import { getUserById } from '../db';
import { environment } from '../../environments/environment';
import {
  PREVIEW_COOKIE,
  PROXY_PREFIX,
  SESSION_COOKIE_NAME,
} from '../shared/constants';

export function handleUpgrade(
  req: http.IncomingMessage,
  socket: net.Socket,
  head: Buffer,
): void {
  socket.on('error', () => {
  });

  const userId = getSessionUserId(req);
  if (userId == null) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  const user = getUserById(userId);
  if (!user) {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }

  const targetRaw = (user.targetUrl || environment.defaultTarget).trim();
  const targetUrl = /^https?:\/\//i.test(targetRaw) ? targetRaw : `https://${targetRaw}`;
  let targetHost: string;
  let secure: boolean;
  try {
    const u = new URL(targetUrl);
    targetHost = u.hostname;
    secure = u.protocol === 'https:';
  } catch {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return;
  }

  let reqPath = req.url ?? '/';
  if (reqPath.startsWith(`${PROXY_PREFIX}/`)) reqPath = reqPath.slice(PROXY_PREFIX.length) || '/';
  else if (reqPath === PROXY_PREFIX) reqPath = '/';
  const cross = reqPath.match(/^\/(https?:\/\/[^/]+)(\/.*)?$/i);
  if (cross) {
    const u = new URL(cross[1]!);
    targetHost = u.hostname;
    secure = u.protocol === 'https:';
    reqPath = cross[2] || '/';
  }

  const headerLines = buildUpstreamHeaders(req.headers, targetHost);
  const upstreamRequest = `GET ${reqPath} HTTP/1.1\r\n${headerLines.join('\r\n')}\r\n\r\n`;

  const port = secure ? 443 : 80;
  const upstream = secure
    ? tls.connect({ host: targetHost, port, servername: targetHost, ALPNProtocols: ['http/1.1'] })
    : net.connect({ host: targetHost, port });

  upstream.on('error', (err: Error) => {
    if (!socket.destroyed) {
      socket.end(`HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\nupstream: ${err.message}`);
    }
  });

  const onReady = (): void => {
    upstream.write(upstreamRequest);
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  };
  if (secure) (upstream as tls.TLSSocket).once('secureConnect', onReady);
  else (upstream as net.Socket).once('connect', onReady);

  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
}

function buildUpstreamHeaders(
  incoming: http.IncomingHttpHeaders,
  targetHost: string,
): string[] {
  const out: string[] = [];
  out.push(`Host: ${targetHost}`);
  out.push(`Origin: https://${targetHost}`);
  for (const [name, value] of Object.entries(incoming)) {
    if (value == null) continue;
    const lname = name.toLowerCase();
    if (lname === 'host' || lname === 'origin') continue;
    if (lname === 'cookie') {
      const cleaned = String(value)
        .split(';')
        .map((s) => s.trim())
        .filter(
          (s) =>
            !s.startsWith(`${SESSION_COOKIE_NAME}=`) && !s.startsWith(`${PREVIEW_COOKIE}=`),
        )
        .join('; ');
      if (cleaned) out.push(`Cookie: ${cleaned}`);
      continue;
    }
    const val = Array.isArray(value) ? value.join(', ') : value;
    out.push(`${name}: ${val}`);
  }
  return out;
}
