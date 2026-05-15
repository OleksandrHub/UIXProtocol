import { createPartFromUri } from '@google/genai';

import {
  dropCacheForKey,
  makeClient,
  uploadFileForKey,
} from './gemini-cache';
import { parseResultText, parseStructured, STRUCTURED_SUFFIX } from './gemini-parser';
import type { PreloadResult, SolveOptions, SolveResult, UserFile } from './types';

export { getCachedFileIds, invalidateUploadsForUser } from './gemini-cache';

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

export async function solveWithGemini(options: SolveOptions): Promise<SolveResult> {
  if (!options.models.length) throw new Error('no models enabled');

  const augmented: SolveOptions = {
    ...options,
    prompt: options.prompt + STRUCTURED_SUFFIX,
  };

  let lastError: unknown;

  for (const model of options.models) {
    for (const apiKey of options.apiKeys) {
      try {
        const text = await callOnce(apiKey, model, augmented);
        return {
          answer: parseResultText(text),
          questions: parseStructured(text),
        };
      } catch (e) {
        lastError = e;
        console.error(
          `[Gemini] ${model} key ${apiKey.slice(0, 8)}…: ${(e as Error).message}`
        );
        dropCacheForKey(apiKey);
      }
    }
  }
  throw lastError ?? new Error('all keys/models failed');
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
