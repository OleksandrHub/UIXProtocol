import * as fs from 'node:fs';
import * as path from 'node:path';
import posthtml from 'posthtml';
// @ts-expect-error — no types shipped
import include from 'posthtml-include';
import expressions from 'posthtml-expressions';

import { PAGES_DIR, PUBLIC_DIR } from './constants';

const processor = posthtml([
  include({ root: PAGES_DIR }),
  (expressions as unknown as () => unknown)(),
]);

async function buildOne(file: string): Promise<void> {
  const src = path.join(PAGES_DIR, file);
  const out = path.join(PUBLIC_DIR, file);
  const input = await fs.promises.readFile(src, 'utf-8');
  const result = await processor.process(input);
  await fs.promises.mkdir(path.dirname(out), { recursive: true });
  await fs.promises.writeFile(out, result.html, 'utf-8');
  console.log(`✓ ${file}`);
}

async function buildAll(): Promise<void> {
  const entries = await fs.promises.readdir(PAGES_DIR, { withFileTypes: true });
  const pages = entries.filter((e) => e.isFile() && e.name.endsWith('.html')).map((e) => e.name);
  await Promise.all(pages.map(buildOne));
}

async function main(): Promise<void> {
  await buildAll();
  if (!process.argv.includes('--watch')) return;

  console.log(`watching ${path.relative(process.cwd(), PAGES_DIR)}/ for changes…`);
  fs.watch(PAGES_DIR, { recursive: true }, (_event, filename) => {
    if (!filename || !filename.endsWith('.html')) return;
    buildAll().catch((err) => console.error('build error:', err));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
