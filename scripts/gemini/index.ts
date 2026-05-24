import { createPartFromUri } from '@google/genai';

import {
  dropCacheForKey,
  makeClient,
  uploadFileForKey,
} from '../gemini/cache';
import { parseResultText, parseStructured } from '../gemini/parser';
import { STRUCTURED_SUFFIX } from '../shared/constants';
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
        {
          inlineData: {
            mimeType: options.imageMime,
            data: options.image.toString('base64'),
          },
        },
      ],
    },
  ];

  const response = await client.models.generateContent({
    model,
    config: {
      thinkingConfig: { thinkingBudget: model.includes('pro') ? 8000 : 3000 },
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
  if (!options.model) throw new Error('no model selected');
  if (!options.apiKeys.length) throw new Error('no api keys configured');

  const augmented: SolveOptions = {
    ...options,
    prompt: options.collectArchive === false
      ? options.prompt
      : options.prompt + STRUCTURED_SUFFIX,
  };

  const errors: Array<{ apiKey: string; message: string }> = [];
  let resolved = false;

  const attempts = options.apiKeys.map(async (apiKey) => {
    try {
      const text = await callOnce(apiKey, options.model, augmented);
      if (resolved) return null;
      resolved = true;
      return text;
    } catch (e) {
      errors.push({ apiKey, message: (e as Error).message });
      console.error(
        `[Gemini] ${options.model} key ${apiKey.slice(0, 8)}…: ${(e as Error).message}`,
      );
      dropCacheForKey(apiKey);
      return null;
    }
  });

  const results = await Promise.all(attempts);
  const winner = results.find((t): t is string => typeof t === 'string' && t.length > 0);

  if (winner) {
    return {
      answer: parseResultText(winner),
      questions: options.collectArchive === false ? [] : parseStructured(winner),
    };
  }

  const last = errors[errors.length - 1];
  throw new GeminiSolveError(
    last?.message ?? 'all keys failed',
    options.model,
    last ? last.apiKey.slice(0, 8) : '',
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
