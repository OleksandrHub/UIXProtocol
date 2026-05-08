export interface UserPrompt {
  id: string;
  name: string;
  text: string;
}

export interface UserFileMeta {
  id: number;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
}

export interface UserFile extends UserFileMeta {
  data: Buffer;
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

export interface SolveOptions {
  apiKeys: string[];
  imageBase64: string;
  prompt: string;
  models: string[];
  files: UserFile[];
}

export interface PreloadResult {
  cached: number;
  total: number;
  errors: Array<{ fileId: number; apiKey: string; message: string }>;
}
