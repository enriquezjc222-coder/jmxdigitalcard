#!/usr/bin/env node
/**
 * JMX inventory audit — DRY RUN by default (read-only).
 *
 *   DRY RUN (offline export):  node audit.mjs --dump export.json --out ./out
 *   DRY RUN (live, read-only): node audit.mjs --project jmx-digital-card --out ./out
 *   EXECUTE step 1 (soft):     node audit.mjs --project jmx-digital-card --out ./out --execute archive --confirm <runId>
 *   EXECUTE step 2 (hard):     node audit.mjs --project jmx-digital-card --out ./out --execute delete  --confirm <runId> --i-reviewed-the-backup
 *
 * EXECUTE never trusts the old dry run: it re-reads everything, re-classifies, and aborts
 * the whole run (nothing written) if ANY candidate changed or gained a reference.
 * archive = full JSON backup on disk + copy in inventoryCleanupArchive/{runId} + marker
 *           field `cleanupArchive` on the original documents (nothing deleted).
 * delete  = only documents already archived by the SAME runId and still YES; the archive
 *           copies and the local backup stay. Storage files are never deleted by this tool.
 * After every EXECUTE step the integrity counts are compared: no active count may drop.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runAudit, revalidate, compareIntegrity, markdownReport } from './lib/audit-core.mjs';
import { dumpStore, firestoreStore } from './lib/stores.mjs';

const USAGE = `Usage:
  node audit.mjs --dump <export.json> [--out <directory>]
  node audit.mjs --project <firebase-project-id> [--bucket <verified-bucket-name>] [--out <directory>]

Bucket resolution order: --bucket, FIREBASE_STORAGE_BUCKET, FIREBASE_CONFIG.storageBucket,
then the authenticated Firebase defaultBucket API. No bucket name is guessed.`;

export function parseArgs(argv) {
  const a = { out: './inventory-audit-out' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--help' || k === '-h') a.help = true;
    else if (k === '--i-reviewed-the-backup') a.reviewed = true;
    else if (k.startsWith('--')) { a[k.slice(2)] = argv[i + 1]; i++; }
  }
  return a;
}

export async function main(argv = process.argv.slice(2), log = console.log) {
  const args = parseArgs(argv);
  if (args.help) { log(USAGE); return { mode: 'help' }; }
  if (!args.dump && !args.project) throw new Error('Use --dump <export.json> or --project <firebase project id>.');
  const store = args.dump ? dumpStore(args.dump) : await firestoreStore({ projectId: args.project, bucket: args.bucket });
  mkdirSync(args.out, { recursive: true });

  if (!args.execute) {
    const { flatDb, storageFiles } = await store.read();
    const audit = runAudit(flatDb, { storageFiles, runId: `run-${new Date().toISOString().replace(/[:.]/g, '-')}` });
    const dir = join(args.out, audit.runId); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'inventory-report.json'), JSON.stringify({ runId: audit.runId, generatedAt: audit.generatedAt, summary: audit.summary, results: audit.results }, null, 1));
    writeFileSync(join(dir, 'DELETE-CANDIDATES.json'), JSON.stringify({ runId: audit.runId, generatedAt: audit.generatedAt, note: 'DRY RUN — nothing was deleted. Review, then run --execute archive --confirm <runId>.', candidates: audit.candidates }, null, 1));
    writeFileSync(join(dir, 'REVIEW-REQUIRED.json'), JSON.stringify(audit.review, null, 1));
    writeFileSync(join(dir, 'PLAN-AUDIT.json'), JSON.stringify(audit.planAudit, null, 1));
    writeFileSync(join(dir, 'integrity-before.json'), JSON.stringify(audit.summary.integrity, null, 1));
    writeFileSync(join(dir, 'inventory-report.md'), markdownReport(audit));
    log(`DRY RUN ${audit.runId}: ${audit.results.length} records · ${audit.candidates.length} delete candidates · ${audit.review.length} review · ${audit.planAudit.count} cards without a valid plan → ${dir}`);
    return { mode: 'dry-run', dir, audit };
  }

  // ------------------------------------------------------------------ EXECUTE
  if (!['archive', 'delete'].includes(args.execute)) throw new Error('--execute must be "archive" or "delete".');
  const runId = args.confirm; const dir = join(args.out, runId || '');
  if (!runId || !existsSync(join(dir, 'DELETE-CANDIDATES.json'))) throw new Error('--confirm <runId> must name an existing dry run in --out.');
  if (args.execute === 'delete' && !args.reviewed) throw new Error('Hard delete requires --i-reviewed-the-backup.');
  const planned = JSON.parse(readFileSync(join(dir, 'DELETE-CANDIDATES.json'), 'utf8'));
  if (planned.runId !== runId) throw new Error('runId mismatch.');
  const before = await store.read();
  const fresh = runAudit(before.flatDb, { storageFiles: before.storageFiles, runId });
  const candidates = revalidate(planned.candidates, fresh); // throws → nothing written
  const meta = { runId, at: new Date().toISOString(), tool: 'tools/inventory-audit' };
  const actions = [];
  if (args.execute === 'archive') {
    const backup = { runId, createdAt: meta.at, documents: {} };
    for (const c of candidates) for (const p of c.documents) if (before.flatDb[p] !== undefined) backup.documents[p] = { data: before.flatDb[p], reason: c.reason, category: c.category };
    writeFileSync(join(dir, `BACKUP-${runId}.json`), JSON.stringify(backup, null, 1)); // on disk BEFORE any write
    for (const [p, { data, reason }] of Object.entries(backup.documents)) { await store.archive(p, data, { ...meta, reason }); await store.markArchived(p, { ...meta, reason }); actions.push({ op: 'archive', path: p }); }
  } else {
    if (!existsSync(join(dir, `BACKUP-${runId}.json`))) throw new Error('No archive/backup for this run: run --execute archive first.');
    for (const c of candidates) for (const p of c.documents) {
      if (before.flatDb[p] === undefined) continue;
      if (before.flatDb[p]?.cleanupArchive?.runId !== runId) throw new Error(`ABORTED before deleting: ${p} was not archived by ${runId}.`);
    }
    for (const c of candidates) for (const p of c.documents) if (before.flatDb[p] !== undefined) { await store.remove(p); actions.push({ op: 'delete', path: p }); }
  }
  const after = await store.read();
  const afterAudit = runAudit(after.flatDb, { storageFiles: after.storageFiles, runId });
  const drops = compareIntegrity(fresh.summary.integrity, afterAudit.summary.integrity);
  writeFileSync(join(dir, `EXECUTE-${args.execute}-log.json`), JSON.stringify({ runId, mode: args.execute, at: meta.at, actions, integrityBefore: fresh.summary.integrity, integrityAfter: afterAudit.summary.integrity, drops }, null, 1));
  if (drops.length) throw new Error(`INTEGRITY ALERT after ${args.execute}: ${drops.join('; ')} — restore from BACKUP-${runId}.json`);
  log(`EXECUTE ${args.execute} ${runId}: ${actions.length} document operations, integrity OK.`);
  return { mode: args.execute, actions, integrityBefore: fresh.summary.integrity, integrityAfter: afterAudit.summary.integrity };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
