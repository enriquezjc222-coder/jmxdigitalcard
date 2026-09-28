import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const config = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8')).hosting;

function firebaseToolsRoot() {
  if (process.env.FIREBASE_TOOLS_ROOT) return process.env.FIREBASE_TOOLS_ROOT;
  if (process.platform === 'win32' && process.env.APPDATA) {
    const candidate = join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Set FIREBASE_TOOLS_ROOT to the installed firebase-tools directory.');
}

const cliRequire = createRequire(join(firebaseToolsRoot(), 'package.json'));
const { listFiles } = cliRequire('./lib/listFiles.js');
const files = new Set(listFiles(resolve(ROOT, config.public), config.ignore));

test('Firebase CLI deployment manifest includes the public application', () => {
  for (const path of ['index.html', 'card.html', 'device.html', 'script.js', 'js/jmx-qr/card-qr.js']) {
    assert.ok(files.has(path), `${path} must be uploaded`);
  }
});

test('Firebase CLI deployment manifest excludes private/build-only paths', () => {
  const forbidden = [
    'firebase.json', '.firebaserc', 'storage.rules', 'firestore.rules', 'firestore.indexes.json',
    'functions/index.js', 'docs/emulator-tests/README.md', 'tools/inventory-audit/audit.mjs',
    'PRUEBA-8-FINAL-PRODUCTION-READY-V2-SEP2026.md', 'PREPARE-GITHUB-CLEAN.ps1',
    'firebase-debug.log', 'firestore-debug.log',
  ];
  for (const path of forbidden) assert.ok(!files.has(path), `${path} must not be uploaded`);
  for (const path of files) {
    assert.ok(!path.startsWith('functions/'), path);
    assert.ok(!path.startsWith('docs/'), path);
    assert.ok(!path.startsWith('tools/'), path);
    assert.ok(!path.includes('/node_modules/'), path);
    assert.ok(!path.endsWith('.log'), path);
  }
});
