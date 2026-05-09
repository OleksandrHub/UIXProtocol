import { GoogleGenAI } from '@google/genai';

import { FILE_TTL_MS, REQUEST_TIMEOUT_MS } from './constants';
import type { UploadedFile, UserFile } from './types';

const uploadCache = new Map<string, UploadedFile>();

function cacheKey(apiKey: string, fileId: number): string {
  return `${apiKey}::${fileId}`;
}

export function makeClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: REQUEST_TIMEOUT_MS,
      retryOptions: { attempts: 1 },
    },
  });
}

export async function uploadFileForKey(
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

export function dropCacheForKey(apiKey: string): void {
  const prefix = `${apiKey}::`;
  for (const key of [...uploadCache.keys()]) {
    if (key.startsWith(prefix)) uploadCache.delete(key);
  }
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
