import { db } from './db-connection';
import { safeParseArray } from './db-crypto';
import type { QuestionImage, QuestionMeta, QuestionRow } from './types';

function rowToMeta(row: QuestionRow): QuestionMeta {
  return {
    id: row.id,
    question: row.question,
    options: safeParseArray<string>(row.options),
    correctAnswer: row.correct_answer,
    createdAt: row.created_at,
  };
}

export function listQuestions(userId: number): QuestionMeta[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, mime, question, options, correct_answer, created_at
       FROM user_questions WHERE user_id = ? ORDER BY id DESC`,
    )
    .all(userId) as QuestionRow[];
  return rows.map(rowToMeta);
}

export function addQuestion(
  userId: number,
  image: Buffer,
  mime: string,
  question: string,
  options: string[],
  correctAnswer: string,
): QuestionMeta {
  const info = db
    .prepare(
      `INSERT INTO user_questions (user_id, image, mime, question, options, correct_answer, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      image,
      mime || 'image/jpeg',
      question ?? '',
      JSON.stringify(Array.isArray(options) ? options : []),
      correctAnswer ?? '',
      Date.now(),
    );
  const row = db
    .prepare('SELECT * FROM user_questions WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as QuestionRow;
  return rowToMeta(row);
}

export function getQuestionImage(userId: number, id: number): QuestionImage | null {
  const row = db
    .prepare('SELECT image, mime FROM user_questions WHERE id = ? AND user_id = ?')
    .get(id, userId) as { image: Buffer; mime: string } | undefined;
  if (!row) return null;
  return { data: row.image, mime: row.mime };
}

export function updateQuestion(
  userId: number,
  id: number,
  patch: { question?: string; options?: string[]; correctAnswer?: string },
): QuestionMeta | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.question !== undefined) {
    sets.push('question = ?');
    params.push(patch.question);
  }
  if (patch.options !== undefined) {
    sets.push('options = ?');
    params.push(JSON.stringify(Array.isArray(patch.options) ? patch.options : []));
  }
  if (patch.correctAnswer !== undefined) {
    sets.push('correct_answer = ?');
    params.push(patch.correctAnswer);
  }
  if (sets.length) {
    params.push(id, userId);
    const info = db
      .prepare(`UPDATE user_questions SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...params);
    if (info.changes === 0) return null;
  }
  const row = db
    .prepare(
      `SELECT id, user_id, mime, question, options, correct_answer, created_at
       FROM user_questions WHERE id = ? AND user_id = ?`,
    )
    .get(id, userId) as QuestionRow | undefined;
  return row ? rowToMeta(row) : null;
}

export function deleteQuestion(userId: number, id: number): boolean {
  const info = db
    .prepare('DELETE FROM user_questions WHERE id = ? AND user_id = ?')
    .run(id, userId);
  return info.changes > 0;
}

// Copies the selected questions (owned by fromUserId) to toUserId as fresh,
// independently-editable rows. Returns how many were shared.
export function shareQuestions(
  fromUserId: number,
  toUserId: number,
  ids: number[],
): number {
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT * FROM user_questions
       WHERE user_id = ? AND id IN (${placeholders})`,
    )
    .all(fromUserId, ...ids) as QuestionRow[];
  if (!rows.length) return 0;
  const insert = db.prepare(
    `INSERT INTO user_questions (user_id, image, mime, question, options, correct_answer, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((list: QuestionRow[]) => {
    const now = Date.now();
    for (const r of list) {
      insert.run(toUserId, r.image, r.mime, r.question, r.options, r.correct_answer, now);
    }
    return list.length;
  });
  return tx(rows);
}
