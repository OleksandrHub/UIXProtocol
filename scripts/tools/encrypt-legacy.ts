// One-time migration helper for legacy plaintext data in the SQLite DB.
//
// Usage:
//   npm run encrypt-legacy
//   npm run encrypt-legacy -- --dry-run

import { encrypt, encryptBuffer, isEncrypted, isEncryptedBuffer } from '../db/cipher';
import { db } from '../db/connection';

const dryRun = process.argv.slice(2).includes('--dry-run');

const users = db
  .prepare('SELECT id, api_keys, target_url, password_first FROM users ORDER BY id')
  .all() as Array<{ id: number; api_keys: string; target_url: string; password_first: string }>;
const files = db
  .prepare('SELECT id, data FROM user_files ORDER BY id')
  .all() as Array<{ id: number; data: Buffer }>;
const questions = db
  .prepare('SELECT id, image, question, correct_answer FROM user_questions ORDER BY id')
  .all() as Array<{ id: number; image: Buffer; question: string; correct_answer: string }>;

let updatedUsers = 0;
let updatedFiles = 0;
let updatedQuestions = 0;

const migrate = db.transaction(() => {
  const updateUser = db.prepare(
    'UPDATE users SET api_keys = ?, target_url = ?, password_first = ? WHERE id = ?',
  );
  const updateFile = db.prepare('UPDATE user_files SET data = ? WHERE id = ?');
  const updateQuestion = db.prepare(
    'UPDATE user_questions SET image = ?, question = ?, correct_answer = ? WHERE id = ?',
  );

  for (const row of users) {
    const nextApiKeys = isEncrypted(row.api_keys) ? row.api_keys : encrypt(row.api_keys);
    const nextTargetUrl = isEncrypted(row.target_url) ? row.target_url : encrypt(row.target_url);
    const nextPasswordFirst = isEncrypted(row.password_first)
      ? row.password_first
      : encrypt(row.password_first);

    if (
      nextApiKeys !== row.api_keys ||
      nextTargetUrl !== row.target_url ||
      nextPasswordFirst !== row.password_first
    ) {
      updatedUsers += 1;
      if (!dryRun) updateUser.run(nextApiKeys, nextTargetUrl, nextPasswordFirst, row.id);
    }
  }

  for (const row of files) {
    if (isEncryptedBuffer(row.data)) continue;
    updatedFiles += 1;
    if (!dryRun) updateFile.run(encryptBuffer(row.data), row.id);
  }

  for (const row of questions) {
    const nextImage = isEncryptedBuffer(row.image) ? row.image : encryptBuffer(row.image);
    const nextQuestion = isEncrypted(row.question) ? row.question : encrypt(row.question);
    const nextCorrectAnswer = isEncrypted(row.correct_answer)
      ? row.correct_answer
      : encrypt(row.correct_answer);

    if (
      nextImage !== row.image ||
      nextQuestion !== row.question ||
      nextCorrectAnswer !== row.correct_answer
    ) {
      updatedQuestions += 1;
      if (!dryRun) updateQuestion.run(nextImage, nextQuestion, nextCorrectAnswer, row.id);
    }
  }
});

migrate();

console.log(
  dryRun
    ? [
        'Dry run complete.',
        `Would update users: ${updatedUsers}/${users.length}`,
        `Would update files: ${updatedFiles}/${files.length}`,
        `Would update questions: ${updatedQuestions}/${questions.length}`,
      ].join('\n')
    : [
        'Legacy data encryption complete.',
        `Updated users: ${updatedUsers}/${users.length}`,
        `Updated files: ${updatedFiles}/${files.length}`,
        `Updated questions: ${updatedQuestions}/${questions.length}`,
      ].join('\n'),
);