// Firebase Emulator tests for storage.rules (+ the firestore.rules card-write rule the
// Business Logo QR relies on). NOT executed in the delivery environment (no firebase-tools:
// the npm registry is blocked there). Run them before deploying the rules — see README.md.
//
//   npm --prefix docs/emulator-tests install
//   npx firebase-tools@latest emulators:exec --project demo-jmx --only firestore,storage \
//       "node --test docs/emulator-tests/rules.emulator.test.mjs"
//
// "demo-jmx" is a demo project id: the emulators never touch production.
import test, { before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('./package.json', import.meta.url));
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { ref, uploadBytes, deleteObject, getBytes } = require('firebase/storage');
const { doc, setDoc } = require('firebase/firestore');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ADMIN = 'ADMIN_UID'; const OWNER = 'OWNER_X'; const OTHER = 'OWNER_Y';
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const big = new Uint8Array(12 * 1024 * 1024 + 16); big.set(png);
let env;

before(async () => {
  const [fh, fp] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  const [sh, sp] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-jmx',
    firestore: { rules: readFileSync(`${ROOT}firestore.rules`, 'utf8'), host: fh, port: Number(fp) },
    storage: { rules: readFileSync(`${ROOT}storage.rules`, 'utf8'), host: sh, port: Number(sp) },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'platform/config'), { adminUid: ADMIN });
    await setDoc(doc(db, 'cardOwners/X'), { ownerUid: OWNER, cardId: 'X' });
    await setDoc(doc(db, 'cardOwners/Y'), { ownerUid: OTHER, cardId: 'Y' });
    await setDoc(doc(db, 'cards/X'), { status: 'activated', plan: 'Business' });
    await uploadBytes(ref(ctx.storage(), 'cards/X/qrBusinessLogo/seed.png'), png, { contentType: 'image/png' });
    await uploadBytes(ref(ctx.storage(), 'cards/X/profile/seed.png'), png, { contentType: 'image/png' });
  });
});
after(async () => { await env?.cleanup(); });

const st = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
const up = (uid, path, data = png, type = 'image/png') => uploadBytes(ref(st(uid), path), data, { contentType: type });

test('OWNER → cards/X/qrBusinessLogo/a.png DENIED (create, overwrite, delete)', async () => {
  await assertFails(up(OWNER, 'cards/X/qrBusinessLogo/a.png'));
  await assertFails(up(OWNER, 'cards/X/qrBusinessLogo/seed.png'));
  await assertFails(deleteObject(ref(st(OWNER), 'cards/X/qrBusinessLogo/seed.png')));
});
test('OWNER → cards/X/profile/a.png ALLOWED (unchanged owner media permission)', async () => {
  await assertSucceeds(up(OWNER, 'cards/X/profile/a.png'));
  await assertSucceeds(up(OWNER, 'cards/X/gallery-0/a.jpg', png, 'image/jpeg'));
  await assertSucceeds(up(OWNER, 'cards/X/catalog/a.pdf', png, 'application/pdf'));
  await assertSucceeds(deleteObject(ref(st(OWNER), 'cards/X/profile/seed.png')));
});
test('ADMIN → cards/X/qrBusinessLogo/a.png ALLOWED; delete ALLOWED', async () => {
  await assertSucceeds(up(ADMIN, 'cards/X/qrBusinessLogo/a.png'));
  await assertSucceeds(deleteObject(ref(st(ADMIN), 'cards/X/qrBusinessLogo/a.png')));
});
test('NOT ADMIN / NOT OWNER → DENIED', async () => {
  await assertFails(up(OTHER, 'cards/X/qrBusinessLogo/a.png'));
  await assertFails(up(OTHER, 'cards/X/profile/a.png'));
  await assertFails(up(null, 'cards/X/qrBusinessLogo/a.png'));
  await assertFails(up(null, 'cards/X/profile/a.png'));
});
test('non-PNG in qrBusinessLogo → DENIED (even for the admin)', async () => {
  await assertFails(up(ADMIN, 'cards/X/qrBusinessLogo/a.jpg', png, 'image/jpeg'));
  await assertFails(up(ADMIN, 'cards/X/qrBusinessLogo/a.svg', png, 'image/svg+xml'));
  await assertFails(up(ADMIN, 'cards/X/qrBusinessLogo/a.pdf', png, 'application/pdf'));
});
test('file too large (≥ 12 MB) → DENIED', async () => {
  await assertFails(up(ADMIN, 'cards/X/qrBusinessLogo/big.png', big));
  await assertFails(up(OWNER, 'cards/X/profile/big.png', big));
});
test('public read unchanged; other paths denied', async () => {
  await assertSucceeds(getBytes(ref(st(null), 'cards/X/qrBusinessLogo/seed.png')));
  await assertFails(up(ADMIN, 'other/a.png'));
  await assertFails(up(OWNER, 'cards/X/a/b/c.png'));
});
test('firestore: the owner cannot write cards/X.qrBusinessLogo; the admin can', async () => {
  await assertFails(setDoc(doc(env.authenticatedContext(OWNER).firestore(), 'cards/X'), { qrBusinessLogo: { url: 'https://evil' } }, { merge: true }));
  await assertSucceeds(setDoc(doc(env.authenticatedContext(ADMIN).firestore(), 'cards/X'), { qrBusinessLogo: { mode: 'jmx' } }, { merge: true }));
});
