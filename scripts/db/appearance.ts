import { db } from '../db/connection';
import type { Appearance } from '../shared/types';

export function getAppearance(userId: number): Appearance {
  const row = db
    .prepare('SELECT data FROM user_appearance WHERE user_id = ?')
    .get(userId) as { data: string } | undefined;
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.data);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Appearance)
      : {};
  } catch {
    return {};
  }
}

export function setAppearance(userId: number, data: Appearance): Appearance {
  const json = JSON.stringify(data ?? {});
  db.prepare(
    `INSERT INTO user_appearance (user_id, data) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data`,
  ).run(userId, json);
  return data;
}
