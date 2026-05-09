import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import { MIME, PUBLIC_DIR } from './constants';

export function serveFile(res: http.ServerResponse, file: string): void {
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

export function safeJsPath(reqPath: string): string | null {
  const rel = decodeURIComponent(reqPath.replace(/^\/js\//, ''));
  const target = path.normalize(path.join(PUBLIC_DIR, 'js', rel));
  const root = path.join(PUBLIC_DIR, 'js') + path.sep;
  return target.startsWith(root) ? target : null;
}
