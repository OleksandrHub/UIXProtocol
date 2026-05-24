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
  archiveQuestions?: boolean;
  devTools?: boolean;
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
  archiveQuestions: boolean;
  devTools: boolean;
}

export interface UserPrompt {
  id: string;
  name: string;
  text: string;
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
  archive_questions: number;
  dev_tools: number;
}
