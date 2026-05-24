import type { UserFile } from './file-types';

export interface SolveOptions {
  apiKeys: string[];
  image: Buffer;
  imageMime: string;
  prompt: string;
  model: string;
  files: UserFile[];
  collectArchive?: boolean;
}

export interface ParsedQuestion {
  question: string;
  options: string[];
  correct: string;
}

export interface SolveResult {
  answer: string;
  questions: ParsedQuestion[];
}

export interface PreloadResult {
  cached: number;
  total: number;
  errors: Array<{ fileId: number; apiKey: string; message: string }>;
}

export interface UploadedFile {
  uri: string;
  mimeType: string;
  expiresAt: number;
}

// Row shape from the gemini_uploads table — narrows the columns selected by
// `getStoredUpload` so callers don't have to keep snake_case strings inline.
export interface GeminiUploadRow {
  uri: string;
  mime_type: string;
  expires_at: number;
}
