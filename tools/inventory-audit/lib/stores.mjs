// Data stores for the audit tool. Both expose the same interface:
//   read() → { flatDb: {"col/id[/sub/id]": data}, storageFiles: {cardId: count} }
//   archive(path, data, meta) / markArchived(path, meta) / remove(path)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolveStorageBucket } from './bucket-resolver.mjs';

/** Offline store: a JSON export {"cards/ID": {...}, ...}. Used for tests and for exports. */
export function dumpStore(file) {
  const load = () => JSON.parse(readFileSync(file, 'utf8'));
  const save = (db) => writeFileSync(file, JSON.stringify(db, null, 1));
  return {
    kind: 'dump',
    async read() { const db = load(); const storageFiles = db.__storageFiles || {}; delete db.__storageFiles; return { flatDb: db, storageFiles }; },
    async archive(path, data, meta) { const db = load(); db[`inventoryCleanupArchive/${meta.runId}/docs/${path.replaceAll('/', '__')}`] = { path, data, ...meta }; save(db); },
    async markArchived(path, meta) { const db = load(); if (db[path]) db[path] = { ...db[path], cleanupArchive: meta }; save(db); },
    async remove(path) { const db = load(); delete db[path]; save(db); },
  };
}

/** Live store: Firestore + Storage through firebase-admin (Application Default Credentials). */
export async function firestoreStore({ projectId, bucket }) {
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  const { getStorage } = await import('firebase-admin/storage');
  const credential = applicationDefault();
  const resolvedBucket = await resolveStorageBucket({ projectId, bucket, credential });
  const app = initializeApp({ credential, projectId, storageBucket: resolvedBucket.name });
  const db = getFirestore(app);
  const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x === 'object' && typeof x.toDate === 'function' ? { __ts: x.toDate().toISOString() } : x)));
  return {
    kind: 'firestore',
    bucket: resolvedBucket,
    async read() {
      const flatDb = {};
      const full = ['cards', 'inventory', 'profiles', 'cardAdmin', 'cardOwners', 'cardClaims', 'cardStats', 'aiScannerTotals', 'ownerActivity', 'nfcDevices', 'nfcBatches', 'accounts', 'identityProfiles'];
      for (const col of full) (await db.collection(col).get()).forEach((d) => { flatDb[`${col}/${d.id}`] = plain(d.data()); });
      for (const id of ['publicSettings', 'nfcDeviceSettings']) { const s = await db.doc(`platform/${id}`).get(); if (s.exists) flatDb[`platform/${id}`] = plain(s.data()); }
      for (const col of ['monthlyStats', 'dailyStats', 'identityAuditLogs']) (await db.collection(col).select('cardId').get()).forEach((d) => { flatDb[`${col}/${d.id}`] = { cardId: d.get('cardId') ?? null }; });
      (await db.collection('nfcDeviceEvents').select('cardId', 'previousCardId').get()).forEach((d) => { flatDb[`nfcDeviceEvents/${d.id}`] = { cardId: d.get('cardId') ?? null, previousCardId: d.get('previousCardId') ?? null }; });
      // sub-collections: only the paths are needed (existence counts)
      for (const group of ['items', 'releases', 'media']) (await db.collectionGroup(group).select().get()).forEach((d) => { flatDb[d.ref.path] = {}; });
      const storageFiles = {};
      const [files] = await getStorage(app).bucket().getFiles({ prefix: 'cards/', autoPaginate: true });
      for (const f of files) { const id = f.name.split('/')[1]; if (id) storageFiles[id] = (storageFiles[id] || 0) + 1; }
      return { flatDb, storageFiles };
    },
    async archive(path, data, meta) { await db.doc(`inventoryCleanupArchive/${meta.runId}/docs/${path.replaceAll('/', '__')}`).set({ path, data, ...meta, archivedAtServer: FieldValue.serverTimestamp() }); },
    async markArchived(path, meta) { await db.doc(path).set({ cleanupArchive: meta }, { merge: true }); },
    async remove(path) { await db.doc(path).delete(); },
  };
}
