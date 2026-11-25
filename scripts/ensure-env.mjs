// Prepares .env for local development:
// - creates it from .env.example on a fresh clone;
// - appends settings that .env.example gained since .env was created, without touching
//   values that are already set.
import { appendFileSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.env');
const example = join(root, '.env.example');

if (!existsSync(target)) {
  copyFileSync(example, target);
  console.log('Created .env from .env.example');
} else {
  const current = parseEnv(readFileSync(target, 'utf8'));
  const wanted = parseEnv(readFileSync(example, 'utf8'));
  const missing = Object.keys(wanted).filter((key) => !(key in current));
  if (missing.length > 0) {
    const lines = missing.map((key) => `${key}=${wanted[key]}`).join('\n');
    appendFileSync(target, `\n# Added from .env.example by npm run dev\n${lines}\n`);
    console.log(`Added to .env from .env.example: ${missing.join(', ')}`);
  }
}
