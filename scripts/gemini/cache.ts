import { FileState, GoogleGenAI } from '@google/genai';

import {
  dropStoredCacheForKey,
  dropStoredUploadsByFileIds,
  getStoredCachedFileIds,
  getStoredUpload,
  saveStoredUpload,
} from '../db/gemini-uploads';
import {
  FILE_PROCESSING_POLL_MS,
  FILE_PROCESSING_TIMEOUT_MS,
  FILE_TTL_MS,
  REQUEST_TIMEOUT_MS,
} from '../shared/constants';
import type { UploadedFile, UserFile } from '../shared/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// In-flight uploads stay in memory: a Promise can't survive a process restart
// and we only need to dedupe concurrent uploads within a single Node process.
const pendingUploads = new Map<string, Promise<UploadedFile>>();

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
  file: UserFile,
): Promise<UploadedFile> {
  const cached = getStoredUpload(apiKey, file.id);
  if (cached) return cached;

  const key = cacheKey(apiKey, file.id);
  const inFlight = pendingUploads.get(key);
  if (inFlight) return inFlight;

  const work = doUpload(client, apiKey, file);
  pendingUploads.set(key, work);
  try {
    return await work;
  } finally {
    pendingUploads.delete(key);
  }
}

async function doUpload(
  client: GoogleGenAI,
  apiKey: string,
  file: UserFile,
): Promise<UploadedFile> {
  const blob = new Blob([new Uint8Array(file.data)], { type: file.mime });
  let uploaded = await client.files.upload({
    file: blob,
    config: { mimeType: file.mime, displayName: file.name },
  });

  const deadline = Date.now() + FILE_PROCESSING_TIMEOUT_MS;
  while (uploaded.state === FileState.PROCESSING) {
    if (Date.now() > deadline) {
      throw new Error(`file ${file.name} still PROCESSING after timeout`);
    }
    await sleep(FILE_PROCESSING_POLL_MS);
    if (!uploaded.name) throw new Error(`upload returned no name for ${file.name}`);
    uploaded = await client.files.get({ name: uploaded.name });
  }
  if (uploaded.state === FileState.FAILED) {
    throw new Error(`Gemini failed to process ${file.name}`);
  }
  if (!uploaded.uri || !uploaded.mimeType) {
    throw new Error(`upload returned no uri for ${file.name}`);
  }
  const entry: UploadedFile = {
    uri: uploaded.uri,
    mimeType: uploaded.mimeType,
    expiresAt: Date.now() + FILE_TTL_MS,
  };
  saveStoredUpload(apiKey, file.id, entry);
  return entry;
}

export function dropCacheForKey(apiKey: string): void {
  dropStoredCacheForKey(apiKey);
}

export function invalidateUploadsForUser(fileIds: number[]): void {
  dropStoredUploadsByFileIds(fileIds);
}

export function getCachedFileIds(apiKey: string): Set<number> {
  return getStoredCachedFileIds(apiKey);
}
