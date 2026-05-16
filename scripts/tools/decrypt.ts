// Manual decryption helper.
//
//   npm run decrypt -- "enc:v1:...."        decrypt a single text token
//   npm run decrypt -- --b64 "<base64>"     decrypt a base64-encoded BLOB token
//   npm run decrypt -- --user 1             dump one user's decrypted fields
//   npm run decrypt -- --questions 1        dump a user's decrypted questions
//
// Uses the same key as the server (UIX_DB_KEY env var or db-secret.key file),
// so it must be run on the machine that holds that key. The token / --b64
// modes work standalone; the DB is only opened for --user / --questions.

import { decrypt, decryptBuffer } from '../db/cipher';

function usage(): never {
  console.log(
    [
      'Usage:',
      '  npm run decrypt -- "enc:v1:..."        decrypt a text token',
      '  npm run decrypt -- --b64 "<base64>"     decrypt a base64 BLOB token',
      '  npm run decrypt -- --user <id>          dump a user (decrypted)',
      '  npm run decrypt -- --questions <userId> dump questions (decrypted)',
    ].join('\n'),
  );
  process.exit(1);
}

// Lazily required so token/b64 modes never load the native sqlite binding.
function getDb() {
  return require('../db/connection').db as import('better-sqlite3').Database;
}

const args = process.argv.slice(2);
if (args.length === 0) usage();

const [flag, value] = args;

if (flag === '--b64') {
  if (!value) usage();
  process.stdout.write(decryptBuffer(Buffer.from(value, 'base64')));
} else if (flag === '--user') {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(Number(value)) as Record<string, unknown> | undefined;
  if (!row) {
    console.error(`user ${value} not found`);
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        id: row.id,
        name: row.name,
        isAdmin: row.is_admin === 1,
        passwordFirst: decrypt(String(row.password_first ?? '')),
        targetUrl: decrypt(String(row.target_url ?? '')),
        apiKeys: JSON.parse(decrypt(String(row.api_keys ?? '[]'))),
      },
      null,
      2,
    ),
  );
} else if (flag === '--questions') {
  const rows = getDb()
    .prepare('SELECT id, question, correct_answer FROM user_questions WHERE user_id = ?')
    .all(Number(value)) as Array<{ id: number; question: string; correct_answer: string }>;
  for (const r of rows) {
    console.log(
      JSON.stringify({
        id: r.id,
        question: decrypt(r.question),
        correctAnswer: decrypt(r.correct_answer),
      }),
    );
  }
} else {
  // Treat the first argument as a raw text token.
  console.log(decrypt(flag!));
}
