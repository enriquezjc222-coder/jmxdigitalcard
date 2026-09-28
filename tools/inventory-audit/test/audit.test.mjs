// Inventory audit + classifier tests (offline, on the fictional fixtures). Run: node --test tools/inventory-audit/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildFixtures } from '../../../docs/qr-integration-tests/fixtures.mjs';
import { classifyCard, bundlesFromFlatDb, SAFE } from '../../../js/inventory-classifier.js';
import { main } from '../audit.mjs';
import { FEATURE_KEYS, BASIC_FEATURE_DEFAULTS, BUSINESS_ONLY_FEATURES } from '../lib/audit-core.mjs';
import { bucketFromFirebaseConfig, discoverDefaultBucket, normalizeBucketName, resolveStorageBucket } from '../lib/bucket-resolver.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const quiet = () => {};
function workspace(db = buildFixtures()) {
  const dir = mkdtempSync(join(tmpdir(), 'jmx-audit-'));
  const dump = join(dir, 'db.json'); writeFileSync(dump, JSON.stringify(db));
  return { dir, dump, out: join(dir, 'out'), read: () => JSON.parse(readFileSync(dump, 'utf8')), hash: () => createHash('sha256').update(readFileSync(dump)).digest('hex') };
}

test('classification of every fixture record (valid inventory is never a delete candidate)', () => {
  const byId = Object.fromEntries(bundlesFromFlatDb(buildFixtures()).map((b) => [b.id, classifyCard(b)]));
  const expect = {
    JMXB01: ['ACTIVE', 'NO'], AVAIL9: ['ACTIVE', 'NO'], LEG09: ['ACTIVE', 'NO'], LEG10: ['ACTIVE', 'NO'],
    STOCK01: ['IN_STOCK', 'NO'], STOCK02: ['IN_STOCK_PROGRAMMED', 'NO'], SOLD03: ['SOLD_PENDING_ACTIVATION', 'NO'],
    RESV04: ['ASSIGNED_NFC', 'NO'], REL05: ['HAS_REFERENCES', 'NO'], ORPH06: ['ORPHAN_FRAGMENT', 'YES'],
    stock7: ['UNREACHABLE_ID', 'YES'], INV08: ['ORPHANED_INVENTORY', 'REVIEW'], ORPH12: ['ORPHAN_FRAGMENT', 'REVIEW'],
  };
  for (const [id, [cat, safe]] of Object.entries(expect)) assert.deepEqual([byId[id].category, byId[id].safeToDelete], [cat, safe], id);
  assert.match(byId.REL05.references.join(), /cardHistory releases/);
  assert.match(byId.RESV04.references.join(), /nfcBatches\/BATCH-RESV/);
  assert.ok(!JSON.stringify(byId.STOCK01).includes('ACTSTOCK01'), 'activation codes are masked in reports');
});

test('fuzz: any hard reference (owner, used code, NFC, identity, wallet, leads, stats, history, client data, programmed tag, sold/active/suspended) ⇒ never YES', () => {
  let seed = 3; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const refs = [
    (b) => { b.owner = { ownerUid: 'U' }; }, (b) => { b.claim = { activationCode: 'X' }; }, (b) => { b.nfcDevices = [{ id: 'D', status: 'active' }]; },
    (b) => { b.nfcBatches = [{ id: 'B', status: 'pending' }]; }, (b) => { b.accounts = [{ id: 'A' }]; }, (b) => { b.identityProfiles = [{ id: 'P' }]; },
    (b) => { b.card = { ...(b.card || {}), googleWalletObjectId: 'W' }; }, (b) => { b.counts.leads = 1; }, (b) => { b.counts.monthlyStats = 2; },
    (b) => { b.counts.releases = 1; }, (b) => { b.counts.storageFiles = 3; }, (b) => { b.stats = { views: 4 }; }, (b) => { b.profile = { fullName: 'Ann' }; },
    (b) => { b.card = { ...(b.card || {}), nfcStatus: 'programmed' }; }, (b) => { b.card = { ...(b.card || {}), status: 'sold' }; },
    (b) => { b.card = { ...(b.card || {}), status: 'activated' }; }, (b) => { b.card = { ...(b.card || {}), status: 'suspended' }; }, (b) => { b.card = { ...(b.card || {}), accountId: 'ACC' }; },
  ];
  for (let i = 0; i < 5000; i++) {
    const id = R() < 0.3 ? `x${i}` : `X${i}`;
    const b = { id, card: R() < 0.6 ? { status: R() < 0.5 ? 'available' : undefined } : null, inventory: R() < 0.5 ? { status: 'available' } : null, profile: R() < 0.5 ? {} : null, counts: {}, nfcDevices: [], nfcBatches: [], accounts: [], identityProfiles: [] };
    refs[Math.floor(R() * refs.length)](b);
    assert.notEqual(classifyCard(b).safeToDelete, SAFE.YES, JSON.stringify(b));
  }
});

test('DRY RUN is read-only and writes the report files', async () => {
  const w = workspace(); const h = w.hash();
  const r = await main(['--dump', w.dump, '--out', w.out], quiet);
  assert.equal(w.hash(), h, 'export untouched');
  for (const f of ['inventory-report.json', 'DELETE-CANDIDATES.json', 'REVIEW-REQUIRED.json', 'PLAN-AUDIT.json', 'integrity-before.json', 'inventory-report.md']) assert.ok(existsSync(join(r.dir, f)), f);
  const cands = JSON.parse(readFileSync(join(r.dir, 'DELETE-CANDIDATES.json'), 'utf8')).candidates;
  assert.deepEqual(cands.map((c) => c.id).sort(), ['ORPH06', 'stock7']);
  for (const c of cands) for (const k of ['id', 'url', 'status', 'references', 'reason', 'confidence', 'recommendedAction']) assert.ok(k in c, k);
  const plan = JSON.parse(readFileSync(join(r.dir, 'PLAN-AUDIT.json'), 'utf8'));
  assert.deepEqual(plan.rows.map((x) => [x.id, x.source, x.after.everywhere]).sort(), [['LEG09', 'missing', 'Premium'], ['LEG10', 'invalid', 'Premium']]);
  assert.equal(plan.rows[0].before.publicCard, 'Premium'); assert.equal(plan.rows[0].before.dashboard, 'Basic');
});

test('CLI entry point runs on Windows/POSIX instead of silently exiting', () => {
  const w = workspace();
  const cli = fileURLToPath(new URL('../audit.mjs', import.meta.url));
  const stdout = execFileSync(process.execPath, [cli, '--dump', w.dump, '--out', w.out], { encoding: 'utf8' });
  assert.match(stdout, /DRY RUN run-/);
  assert.equal(readdirSync(w.out).length, 1);
});

test('CLI help documents the optional verified bucket override', async () => {
  let output = '';
  const result = await main(['--help'], (line) => { output += line; });
  assert.equal(result.mode, 'help');
  assert.match(output, /--bucket <verified-bucket-name>/);
  assert.match(output, /No bucket name is guessed/);
});

test('bucket resolution supports modern and legacy Firebase defaults without guessing', async () => {
  const credential = { async getAccessToken() { return { access_token: 'test-token' }; } };
  const response = (bucketName) => async (url, options) => {
    assert.match(url, /firebasestorage\.googleapis\.com\/v1alpha\/projects\/demo-project\/defaultBucket$/);
    assert.equal(options.headers.authorization, 'Bearer test-token');
    return { ok: true, status: 200, async json() { return { bucket: { name: `projects/_/buckets/${bucketName}` } }; } };
  };
  assert.equal((await resolveStorageBucket({ projectId: 'demo-project', env: {}, credential, fetchImpl: response('demo-project.firebasestorage.app') })).name, 'demo-project.firebasestorage.app');
  assert.equal(await discoverDefaultBucket({ projectId: 'demo-project', credential, fetchImpl: response('demo-project.appspot.com') }), 'demo-project.appspot.com');
  assert.equal((await resolveStorageBucket({ projectId: 'demo-project', bucket: 'gs://verified.custom.example/', env: {}, credential })).name, 'verified.custom.example');
  assert.equal((await resolveStorageBucket({ projectId: 'demo-project', env: { FIREBASE_STORAGE_BUCKET: 'configured.appspot.com' }, credential })).name, 'configured.appspot.com');
  assert.equal(bucketFromFirebaseConfig('{"storageBucket":"configured.firebasestorage.app"}'), 'configured.firebasestorage.app');
  assert.equal(normalizeBucketName(''), '');
});

test('bucket resolution fails clearly when Firebase cannot resolve a configured default', async () => {
  const credential = { async getAccessToken() { return { access_token: 'test-token' }; } };
  const fetchImpl = async () => ({ ok: false, status: 404, async text() { return '{"error":{"message":"default bucket not found"}}'; } });
  await assert.rejects(resolveStorageBucket({ projectId: 'no-bucket-project', env: {}, credential, fetchImpl }), /Could not resolve the default Storage bucket[\s\S]*HTTP 404/);
  assert.throws(() => normalizeBucketName('not/a/bucket'), /Invalid Storage bucket name/);
});

test('EXECUTE: confirmation required, archive first (backup + copy + marker, nothing deleted), then delete only archived candidates; integrity kept', async () => {
  const w = workspace(); const r = await main(['--dump', w.dump, '--out', w.out], quiet); const runId = r.audit.runId;
  await assert.rejects(main(['--dump', w.dump, '--out', w.out, '--execute', 'archive'], quiet), /--confirm/);
  await assert.rejects(main(['--dump', w.dump, '--out', w.out, '--execute', 'delete', '--confirm', runId, '--i-reviewed-the-backup'], quiet), /archive first/);
  const before = w.read();
  const a = await main(['--dump', w.dump, '--out', w.out, '--execute', 'archive', '--confirm', runId], quiet);
  const afterArchive = w.read();
  assert.ok(existsSync(join(r.dir, `BACKUP-${runId}.json`)));
  for (const p of ['profiles/ORPH06', 'cardAdmin/ORPH06', 'cards/stock7', 'inventory/stock7', 'profiles/stock7', 'cardAdmin/stock7']) {
    assert.ok(afterArchive[p], `${p} still exists after archive`); assert.equal(afterArchive[p].cleanupArchive.runId, runId);
    assert.deepEqual(afterArchive[`inventoryCleanupArchive/${runId}/docs/${p.replaceAll('/', '__')}`].data, before[p]);
  }
  for (const k of Object.keys(before)) if (!/ORPH06|stock7/.test(k)) assert.deepEqual(afterArchive[k], before[k], `${k} untouched`);
  assert.deepEqual(a.integrityAfter, a.integrityBefore);
  await assert.rejects(main(['--dump', w.dump, '--out', w.out, '--execute', 'delete', '--confirm', runId], quiet), /i-reviewed-the-backup/);
  const d = await main(['--dump', w.dump, '--out', w.out, '--execute', 'delete', '--confirm', runId, '--i-reviewed-the-backup'], quiet);
  const final = w.read();
  assert.deepEqual(d.actions.map((x) => x.path).sort(), ['cardAdmin/ORPH06', 'cardAdmin/stock7', 'cards/stock7', 'inventory/stock7', 'profiles/ORPH06', 'profiles/stock7']);
  for (const k of Object.keys(before)) if (!/ORPH06|stock7/.test(k)) assert.deepEqual(final[k], before[k], `${k} untouched`);
  for (const k of ['activeClients', 'activatedCards', 'profilesWithClientData', 'accounts', 'nfcDevices', 'inventoryInStock', 'inventoryPending']) assert.ok(d.integrityAfter[k] >= d.integrityBefore[k], k);
  assert.ok(final[`inventoryCleanupArchive/${runId}/docs/profiles__ORPH06`], 'archive copy kept after delete');
});

test('EXECUTE aborts (writes nothing) when a candidate gained a reference after the dry run', async () => {
  const w = workspace(); const r = await main(['--dump', w.dump, '--out', w.out], quiet);
  const db = w.read(); db['cardOwners/ORPH06'] = { ownerUid: 'NEW' }; writeFileSync(w.dump, JSON.stringify(db)); const h = w.hash();
  await assert.rejects(main(['--dump', w.dump, '--out', w.out, '--execute', 'archive', '--confirm', r.audit.runId], quiet), /ABORTED[\s\S]*ORPH06/);
  assert.equal(w.hash(), h, 'nothing written');
  assert.ok(!readdirSync(r.dir).some((f) => f.startsWith('BACKUP-')));
});

test('audit tool feature lists are identical to script.js', () => {
  const s = readFileSync(`${ROOT}script.js`, 'utf8');
  assert.deepEqual(FEATURE_KEYS, JSON.parse(s.match(/const FEATURE_KEYS=(\[[^\]]*\]);/)[1]));
  assert.deepEqual([...BASIC_FEATURE_DEFAULTS], JSON.parse(s.match(/const BASIC_FEATURE_DEFAULTS=new Set\((\[[^\]]*\])\)/)[1]));
  assert.deepEqual([...BUSINESS_ONLY_FEATURES], JSON.parse(s.match(/const BUSINESS_ONLY_FEATURES=new Set\((\[[^\]]*\])\)/)[1]));
});
