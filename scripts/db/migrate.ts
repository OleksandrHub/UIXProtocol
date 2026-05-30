import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { DB_PATH } from '../shared/constants';

const migrationsDir = path.resolve(__dirname, '../../migrations');

function ensureMigrationsTable(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations_applied (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

async function run() {
  const db = new Database(DB_PATH);
  ensureMigrationsTable(db);

  if (!fs.existsSync(migrationsDir)) {
    console.log('No migrations directory found:', migrationsDir);
    process.exit(0);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
    .sort();

  const applied = db
    .prepare('SELECT id FROM migrations_applied')
    .all()
    .map((r: { id: string }) => r.id);

  for (const file of files) {
    const full = path.join(migrationsDir, file);
    const fileUrl = `file://${full}`;
    const mod = await import(fileUrl);
    const id = mod.id ?? file;
    const name = mod.name ?? file;
    if (applied.includes(id)) {
      console.log('Skipping applied migration', id);
      continue;
    }

    console.log('Applying migration', id);
    try {
      await mod.up(db);
      db.prepare('INSERT INTO migrations_applied(id, name, applied_at) VALUES (?, ?, ?)').run(
        id,
        name,
        Date.now(),
      );
      console.log('Applied', id);
    } catch (err) {
      console.error('Migration failed', id, err);
      process.exit(1);
    }
  }

  console.log('Migrations complete');
  db.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
