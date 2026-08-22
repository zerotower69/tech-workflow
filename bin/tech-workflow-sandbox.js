#!/usr/bin/env node

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { main } = require(resolve(root, 'skills/tech-workflow/scripts/sandbox/cli.cjs'));

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  const payload = { ok: false, code: error.code || 'E_INTERNAL', message: error.message, details: error.details || null };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
}
