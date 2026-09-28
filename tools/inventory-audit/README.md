# JMX inventory audit (read-only by default)

Classifies every card / inventory record, lists **delete candidates** and **review-required**
records, audits cards **without a valid plan**, and snapshots integrity counts. This folder is
never deployed: it is excluded from Firebase Hosting (`firebase.json`) and GitHub Pages (`_config.yml`).

The classification code is the same one the dashboard uses before any delete or regenerate:
`js/inventory-classifier.js`.

## 1. DRY RUN (read-only)

```bash
cd tools/inventory-audit && npm install          # firebase-admin only
gcloud auth application-default login            # an account with read access to the project
node audit.mjs --project jmx-digital-card --out ./out
```

The live audit never guesses `<project>.appspot.com`. It resolves the bucket in this order:

1. `--bucket <verified-name>` (also accepts `gs://<verified-name>/`);
2. `FIREBASE_STORAGE_BUCKET`;
3. `storageBucket` in `FIREBASE_CONFIG`;
4. the authenticated, read-only Firebase `projects.getDefaultBucket` API.

This supports both modern `<project>.firebasestorage.app` and legacy
`<project>.appspot.com` buckets. If Firebase cannot return a configured bucket, the tool stops
with a clear error instead of inventing a bucket name. Use an explicit value only after verifying
it in Firebase or Google Cloud, for example:

```bash
node audit.mjs --project jmx-digital-card --bucket jmx-digital-card.firebasestorage.app --out ./out
```

If you have a JSON export (`{"cards/ID": {...}, "inventory/ID": {...}, ...}`), you can audit it offline instead:
`node audit.mjs --dump export.json --out ./out`.

The run writes these files to `out/<runId>/`:

- `inventory-report.md`: summary table (STATUS | COUNT | SAFE TO DELETE? | REASON) and integrity counts.
- `inventory-report.json`: every record, with its category, references and reason.
- `DELETE-CANDIDATES.json`: only YES records, with ID, URL, status, references, reason, confidence, recommended action and a fingerprint.
- `REVIEW-REQUIRED.json`: records that are not certain.
- `PLAN-AUDIT.json`: cards with a missing or unrecognised `plan`. Each one includes:
  - evidence (the plan stored in inventory, cardAdmin, complimentaryBasePlan and account);
  - behaviour before and after the change;
  - the exact dashboard and server feature changes;
  - the NFC impact.
- `integrity-before.json`

## 2. EXECUTE, in two stages (only after you review the dry run)

```bash
node audit.mjs --project jmx-digital-card --out ./out --execute archive --confirm <runId>
node audit.mjs --project jmx-digital-card --out ./out --execute delete  --confirm <runId> --i-reviewed-the-backup
```

- **Re-validation:** each step re-reads everything and re-classifies it. If any candidate changed, gained a reference or no longer exists, the whole run is aborted and nothing is written.
- **archive:**
  1. Writes `BACKUP-<runId>.json` to disk first (path, data and reason for every document).
  2. Copies each document to `inventoryCleanupArchive/<runId>/docs/…`.
  3. Adds a `cleanupArchive` marker to each original document.

  Nothing is deleted at this stage.
- **delete:** removes only documents archived by the same runId that are still YES. The archive copies and the backup are kept. Storage files are never deleted by this tool.
- **Integrity check:** after each step, the protected counts are compared (active clients, activated cards, profiles with client data, accounts, identity profiles, NFC devices, used activation codes, Wallet objects, in-stock and pending inventory). If any of them drops, the tool raises an alert and writes a log.

## Categories

| Category | Safe to delete? | Why |
|---|---|---|
| PROTECTED (BOSS, main) | NO | Protected IDs |
| ACTIVE / ASSIGNED | NO | Has an owner, a used activation code, or is activated |
| SUSPENDED | NO | The client still exists |
| SOLD_PENDING_ACTIVATION | NO | Sold, waiting for the client to activate |
| ASSIGNED_NFC | NO | Reserved or linked by an NFC device or batch |
| HAS_REFERENCES | NO | Has history, analytics, identity, Wallet, leads, client data, Storage files, … |
| IN_STOCK | NO | Valid unused stock |
| IN_STOCK_PROGRAMMED | NO | A physical tag already carries the URL |
| ORPHANED_INVENTORY | REVIEW | Inventory document without a card document |
| UNKNOWN_STATE | REVIEW | Unrecognised status |
| ORPHAN_FRAGMENT | YES, after validation (REVIEW if there are admin notes) | Only blank profile or cardAdmin stubs remain |
| UNREACHABLE_ID / UNREACHABLE_FRAGMENT | YES, after validation | The ID can never be served by `/c/{id}` (for example a lower-case duplicate), and nothing references it |
