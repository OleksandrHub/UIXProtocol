import * as http from 'node:http';
import * as https from 'node:https';
import * as os from 'node:os';
import { URL } from 'node:url';

const PORT = Number(process.argv[2]) || 8787;

http
  .createServer((req, res) => {
    const relayUrlRaw = req.headers['x-relay-url'];
    if (typeof relayUrlRaw !== 'string') {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('missing X-Relay-Url');
      return;
    }

    let target: URL;
    try {
      target = new URL(relayUrlRaw);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad X-Relay-Url');
      return;
    }

    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    delete headers['x-relay-url'];
    headers.host = target.host;

    const lib = target.protocol === 'https:' ? https : http;
    const port = target.port || (target.protocol === 'https:' ? 443 : 80);

    const upstream = lib.request(
      {
        hostname: target.hostname,
        port,
        path: target.pathname + target.search,
        method: req.method,
        headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );

    upstream.on('error', (err) => {
      console.error('[Relay] upstream error:', err.message);
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('relay upstream error: ' + err.message);
    });

    req.pipe(upstream);
  })
  .listen(PORT, '0.0.0.0', () => {
    console.log(`✅  Laptop relay listening on 0.0.0.0:${PORT}`);
    console.log(`    Local:    http://localhost:${PORT}`);
    for (const name of Object.keys(os.networkInterfaces())) {
      for (const iface of os.networkInterfaces()[name] ?? []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log(`    Network:  http://${iface.address}:${PORT}   (${name})`);
        }
      }
    }
  });
