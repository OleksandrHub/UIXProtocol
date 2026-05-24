export interface GeminiErrorRow {
  id: number;
  user_id: number;
  model: string;
  api_key_hint: string;
  message: string;
  created_at: number;
}

// Row shape returned by the listing query in `db/errors.ts` — adds the joined
// user name to the bare row so callers can render "<user> got error X" without
// a second lookup.
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
