import { GoogleGenAI, createPartFromUri } from '@google/genai';

import { FILE_TTL_MS, REQUEST_TIMEOUT_MS } from './models/constants';
import type { PreloadResult, SolveOptions, UserFile } from './models/types';

interface UploadedFile {
  uri: string;
  mimeType: string;
  expiresAt: number;
}

const uploadCache = new Map<string, UploadedFile>();

function cacheKey(apiKey: string, fileId: number): string {
  return `${apiKey}::${fileId}`;
}

function makeClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: REQUEST_TIMEOUT_MS,
      retryOptions: { attempts: 1 },
    },
  });
}

async function uploadFileForKey(
  client: GoogleGenAI,
  apiKey: string,
  file: UserFile
): Promise<UploadedFile> {
  const key = cacheKey(apiKey, file.id);
  const cached = uploadCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const blob = new Blob([new Uint8Array(file.data)], { type: file.mime });
  const uploaded = await client.files.upload({
    file: blob,
    config: { mimeType: file.mime, displayName: file.name },
  });
  if (!uploaded.uri || !uploaded.mimeType) {
    throw new Error(`upload returned no uri for ${file.name}`);
  }
  const entry: UploadedFile = {
    uri: uploaded.uri,
    mimeType: uploaded.mimeType,
    expiresAt: Date.now() + FILE_TTL_MS,
  };
  uploadCache.set(key, entry);
  return entry;
}

function parseResultText(text: string): string {
  const answerPatterns = [/Відповідь:\s*([^\n]+)/i, /Answer:\s*([^\n]+)/i];
  for (const pattern of answerPatterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value.slice(0, 60);
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return '0';

  const conciseAnswer = lines.find((line) => {
    return (
      /^\d+(?:,\d+)*$/.test(line) ||
      /^\d+(?:;\d+)*$/.test(line) ||
      /^\d+-[а-яa-z](?:,\d+-[а-яa-z])*$/i.test(line) ||
      /^(так|ні)$/i.test(line)
    );
  });

  return (conciseAnswer ?? lines[0] ?? '0').slice(0, 60);
}

async function callOnce(
  apiKey: string,
  model: string,
  options: SolveOptions
): Promise<string> {
  const client = makeClient(apiKey);

  const fileParts = [];
  for (const f of options.files) {
    const uploaded = await uploadFileForKey(client, apiKey, f);
    fileParts.push(createPartFromUri(uploaded.uri, uploaded.mimeType));
  }

  const contents = [
    {
      role: 'user',
      parts: [
        { text: options.prompt },
        ...fileParts,
        { inlineData: { mimeType: 'image/jpeg', data: options.imageBase64 } },
      ],
    },
  ];

  const response = await client.models.generateContent({
    model,
    config: {
      thinkingConfig: { thinkingBudget: model.includes('pro') ? 8000 : 2000 },
    },
    contents,
  });

  const text = response?.text ?? '';
  if (!text.trim()) throw new Error('empty response');
  return text;
}

export async function solveWithGemini(options: SolveOptions): Promise<string> {
  if (!options.models.length) throw new Error('no models enabled');

  const orderedModels = [...options.models];
  let lastError: unknown;

  for (const model of orderedModels) {
    for (const apiKey of options.apiKeys) {
      try {
        const text = await callOnce(apiKey, model, options);
        return parseResultText(text);
      } catch (e) {
        lastError = e;
        console.error(
          `[Gemini] ${model} key ${apiKey.slice(0, 8)}…: ${(e as Error).message}`
        );
        for (const key of [...uploadCache.keys()]) {
          if (key.startsWith(`${apiKey}::`)) uploadCache.delete(key);
        }
      }
    }
  }
  throw lastError ?? new Error('all keys/models failed');
}

export function invalidateUploadsForUser(fileIds: number[]): void {
  for (const id of fileIds) {
    for (const key of [...uploadCache.keys()]) {
      if (key.endsWith(`::${id}`)) uploadCache.delete(key);
    }
  }
}

export function getCachedFileIds(apiKey: string): Set<number> {
  const ids = new Set<number>();
  const prefix = `${apiKey}::`;
  for (const [key, entry] of uploadCache) {
    if (!key.startsWith(prefix)) continue;
    if (entry.expiresAt <= Date.now()) {
      uploadCache.delete(key);
      continue;
    }
    const id = Number(key.slice(prefix.length));
    if (Number.isFinite(id)) ids.add(id);
  }
  return ids;
}

export async function preloadFiles(
  apiKeys: string[],
  files: UserFile[]
): Promise<PreloadResult> {
  const total = apiKeys.length * files.length;
  let cached = 0;
  const errors: PreloadResult['errors'] = [];
  for (const apiKey of apiKeys) {
    const client = makeClient(apiKey);
    for (const file of files) {
      try {
        await uploadFileForKey(client, apiKey, file);
        cached++;
      } catch (e) {
        errors.push({
          fileId: file.id,
          apiKey: apiKey.slice(0, 8),
          message: (e as Error).message,
        });
      }
    }
  }
  return { cached, total, errors };
}
