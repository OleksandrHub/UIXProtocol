import * as readline from 'node:readline';

import { createUser } from './db';

async function readStdin(): Promise<string[]> {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const lines: string[] = [];
  for await (const line of rl) lines.push(line);
  return lines;
}

function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((r) => rl.question(q, r));
}

async function interactive(): Promise<{ name: string; password: string; targetUrl: string }> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const name = (await prompt(rl, 'Name: ')).trim();
  const password = (await prompt(rl, 'Password: ')).trim();
  const targetUrl = (await prompt(rl, 'Target URL (optional): ')).trim();
  rl.close();
  return { name, password, targetUrl };
}

async function main(): Promise<void> {
  let name: string;
  let password: string;
  let targetUrl = '';

  const args = process.argv.slice(2);
  if (args.length >= 2) {
    name = args[0]!;
    password = args[1]!;
    targetUrl = args[2] ?? '';
  } else if (!process.stdin.isTTY) {
    const lines = await readStdin();
    name = (lines[0] ?? '').trim();
    password = (lines[1] ?? '').trim();
    targetUrl = (lines[2] ?? '').trim();
  } else {
    ({ name, password, targetUrl } = await interactive());
  }

  if (!name) {
    console.error('Name required');
    process.exit(1);
  }
  if (!password) {
    console.error('Password required');
    process.exit(1);
  }

  try {
    const user = createUser({ name, password, isAdmin: true, targetUrl });
    console.log(`Created admin #${user.id}: ${user.name}`);
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    process.exit(1);
  }
}

void main();
