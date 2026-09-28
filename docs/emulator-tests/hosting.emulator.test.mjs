import test from 'node:test';
import assert from 'node:assert/strict';

if (!process.env.FIREBASE_EMULATOR_HUB) throw new Error('Run through: firebase emulators:exec --only hosting "node --test docs/emulator-tests/hosting.emulator.test.mjs"');
// firebase-tools 15.28.1 exposes the hub but not a hosting-specific variable to
// emulators:exec. This project has no custom hosting emulator port, so Firebase's
// assigned default is 5000 (also printed by the CLI at startup).
const host = process.env.FIREBASE_HOSTING_EMULATOR_HOST || '127.0.0.1:5000';
const base = `http://${host}`;

async function get(path) {
  const response = await fetch(`${base}${path}`, { redirect: 'manual' });
  return { status: response.status, type: response.headers.get('content-type') || '', body: await response.text() };
}

test('/c/** keeps the public card rewrite', async () => {
  const r = await get('/c/JMX-HOSTING-CHECK');
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/html/);
  assert.match(r.body, /id="qrCode"/);
  assert.match(r.body, /src="script\.js"/);
});

test('/d/** keeps the NFC resolver rewrite', async () => {
  const r = await get('/d/JMX-DEVICE-CHECK');
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/html/);
  assert.match(r.body, /src="device\.js"/);
});

test('public application assets remain served', async () => {
  const r = await get('/script.js');
  assert.equal(r.status, 200);
  assert.match(r.type, /javascript/);
  assert.match(r.body, /cardQrTargetUrl/);
});

// firebase-tools' local Hosting emulator serves directly from `public` and does
// not apply deploy-time `ignore` globs. Upload exclusions are verified against
// the CLI's real listFiles implementation in hosting.manifest.test.mjs.
