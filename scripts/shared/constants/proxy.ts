export const PROXY_PREFIX = '/_p';
export const PREVIEW_RE = /^\/_p\/(\d+)(\/.*)?$/;
export const PREVIEW_COOKIE = 'uix_preview';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

export const VIEWPORT_RE = /<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i;
export const HEAD_RE = /<head\b([^>]*)>/i;
export const INTEGRITY_ATTR_RE = /\s+integrity\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
export const CROSSORIGIN_ATTR_RE = /\s+crossorigin\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
export const TURNSTILE_SCRIPT_TAG_RE =
  /<script\b[^>]*\bsrc\s*=\s*["'][^"']*challenges\.cloudflare\.com\/turnstile\/[^"']*["'][^>]*>\s*<\/script>/gi;

export const HEALTH_CHECK_INTERVAL_MS = 10_000;
export const HEALTH_CHECK_TIMEOUT_MS = 3_000;
export const RECHECK_AFTER_FAIL_MS = 5_000;

export const STREAM_OVERLAP = 256;
