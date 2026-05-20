import { createPartFromUri } from '@google/genai';

import {
  dropCacheForKey,
  makeClient,
  uploadFileForKey,
} from '../gemini/cache';
import { parseResultText, parseStructured, STRUCTURED_SUFFIX } from '../gemini/parser';
import type { PreloadResult, SolveOptions, SolveResult, UserFile } from '../shared/types';

export { getCachedFileIds, invalidateUploadsForUser } from '../gemini/cache';

async function callOnce(
  apiKey: string,
  model: string,
  options: SolveOptions
): Promise<string> {
  const client = makeClient(apiKey);

  const uploads = await Promise.all(
    options.files.map((f) => uploadFileForKey(client, apiKey, f))
  );
  const fileParts = uploads.map((u) => createPartFromUri(u.uri, u.mimeType));

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

export class GeminiSolveError extends Error {
  model: string;
  apiKeyHint: string;
  constructor(message: string, model: string, apiKeyHint: string) {
    super(message);
    this.name = 'GeminiSolveError';
    this.model = model;
    this.apiKeyHint = apiKeyHint;
  }
}

export async function solveWithGemini(options: SolveOptions): Promise<SolveResult> {
  if (!options.models.length) throw new Error('no models enabled');

  const augmented: SolveOptions = {
    ...options,
    prompt: options.prompt + STRUCTURED_SUFFIX,
  };

  let lastError: Error | null = null;
  let lastModel = '';
  let lastKeyHint = '';

  for (const model of options.models) {
    for (const apiKey of options.apiKeys) {
      try {
        const text = await callOnce(apiKey, model, augmented);
        return {
          answer: parseResultText(text),
          questions: parseStructured(text),
        };
      } catch (e) {
        lastError = e as Error;
        lastModel = model;
        lastKeyHint = apiKey.slice(0, 8);
        console.error(
          `[Gemini] ${model} key ${apiKey.slice(0, 8)}…: ${(e as Error).message}`
        );
        dropCacheForKey(apiKey);
      }
    }
  }
  throw new GeminiSolveError(
    lastError ? lastError.message : 'all keys/models failed',
    lastModel,
    lastKeyHint,
  );
}

export async function preloadFiles(
  apiKeys: string[],
  files: UserFile[]
): Promise<PreloadResult> {
  const total = apiKeys.length * files.length;
  const errors: PreloadResult['errors'] = [];
  const tasks: Promise<boolean>[] = [];
  for (const apiKey of apiKeys) {
    const client = makeClient(apiKey);
    for (const file of files) {
      tasks.push(
        uploadFileForKey(client, apiKey, file).then(
          () => true,
          (e: unknown) => {
            errors.push({
              fileId: file.id,
              apiKey: apiKey.slice(0, 8),
              message: (e as Error).message,
            });
            return false;
          }
        )
      );
    }
  }
  const cached = (await Promise.all(tasks)).filter(Boolean).length;
  return { cached, total, errors };
}
