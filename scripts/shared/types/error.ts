export interface GeminiErrorRow {
  id: number;
  user_id: number;
  model: string;
  api_key_hint: string;
  message: string;
  created_at: number;
}

export interface JoinedGeminiErrorRow extends GeminiErrorRow {
  user_name: string | null;
}

export interface GeminiError {
  id: number;
  userId: number;
  userName: string;
  model: string;
  apiKeyHint: string;
  message: string;
  createdAt: number;
}
