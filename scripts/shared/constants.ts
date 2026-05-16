import * as path from 'node:path';

// Filesystem
export const DB_PATH = path.join(process.cwd(), 'users.db');
export const DB_KEY_PATH = path.join(process.cwd(), 'db-secret.key');
export const DB_KEY_ENV = 'UIX_DB_KEY';
export const PUBLIC_DIR = path.join(process.cwd(), 'public');
export const PAGES_DIR = path.join(process.cwd(), 'pages');

// Auth
export const SCRYPT_KEYLEN = 64;
export const SESSION_COOKIE_NAME = 'uix_session';

// Proxy
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

// Gemini
export const REQUEST_TIMEOUT_MS = 20000;
export const FILE_TTL_MS = 40 * 60 * 60 * 1000;

export const KNOWN_MODELS = [
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
] as const;

export const DEFAULT_PROMPT_TEXT = `You are an expert test solver. Analyze the screenshot carefully.

TASK: Find and solve ALL questions/tests visible on the screen.

RULES:
- Single choice: output the number (e.g., 2)
- Multiple correct answers: comma-separated (e.g., 1,3,4)
- Multiple questions on screen: semicolon-separated (e.g., 1;3;2)
- Matching: pairs (e.g., 1-б,2-а,3-в)
- Open-ended: short answer word/phrase in Ukrainian
- True/False: Так or Ні

IMPORTANT:
- Read ALL text carefully before answering
- If reference materials are provided (PDFs, images, text, etc.), use them to find the correct answer
- Answer based on the content, not guessing
- Output ONLY in format below, nothing else

FORMAT: Відповідь: [your answer]

Example: Відповідь: 3`;
