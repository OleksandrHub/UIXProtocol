// db.ts

export interface CreateUserInput {
  name: string;
  password: string;
  apiKeys?: string[];
  isAdmin?: boolean;
  targetUrl?: string;
}

export interface UpdateUserInput {
  name?: string;
  password?: string;
  apiKeys?: string[];
  isAdmin?: boolean;
  targetUrl?: string;
  prompts?: UserPrompt[];
  activePromptId?: string;
  enabledModels?: string[];
  activeModel?: string;
}

export interface User {
  id: number;
  name: string;
  apiKeys: string[];
  isAdmin: boolean;
  targetUrl: string;
  prompts: UserPrompt[];
  activePromptId: string;
  enabledModels: string[];
  activeModel: string;
}

export interface UserFile extends UserFileMeta {
  data: Buffer;
}

export interface UserFileMeta {
  id: number;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
}

export interface UserFileRow {
  id: number;
  user_id: number;
  name: string;
  mime: string;
  size: number;
  data: Buffer;
  created_at: number;
}

export interface UserPrompt {
  id: string;
  name: string;
  text: string;
}

export interface QuestionMeta {
  id: number;
  question: string;
  options: string[];
  correctAnswer: string;
  createdAt: number;
}

export interface QuestionRow {
  id: number;
  user_id: number;
  image: Buffer;
  mime: string;
  question: string;
  options: string;
  correct_answer: string;
  created_at: number;
}

export interface QuestionImage {
  data: Buffer;
  mime: string;
}

export interface UserRow {
  id: number;
  name: string;
  password_hash: string;
  password_first: string;
  api_keys: string;
  is_admin: number;
  target_url: string;
  prompts: string;
  active_prompt_id: string;
  enabled_models: string;
  active_model: string;
}

// gemini.ts

export interface SolveOptions {
  apiKeys: string[];
  imageBase64: string;
  prompt: string;
  models: string[];
  files: UserFile[];
}

export interface SolveResult {
  answer: string;
  question: string;
  options: string[];
  correct: string;
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

// server.ts

export interface ProxyOpts {
  sendCookies?: boolean;
  stripSetCookie?: boolean;
  setPreviewCookie?: number;
}
