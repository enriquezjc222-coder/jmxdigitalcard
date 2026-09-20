# TESTING.md

## 1. Automated tests — `tests/run-tests.mjs`

Runs entirely in plain Node (no browser). Exercises the real
`nfcSecurityService.js`'s `verifyNfcTap()` — the exact function a
`/d/{deviceId}` route calls — against `js/mock/mockDevices.js`'s seeded
data plus a handful of freshly registered devices.

```bash
node tests/run-tests.mjs
```

**Last run: 26 / 26 checks passed**, covering every scenario in brief §43:

| # | Scenario | Result |
|---|---|---|
| 1 | Legacy valid | OK |
| 2 | Legacy invalid token | OK |
| 3 | Legacy revoked | OK |
| 4 | Secure valid | OK |
| 5 | Secure invalid CMAC | OK |
| 6 | Secure replay | OK |
| 7 | Secure counter increment | OK |
| 8 | Secure revoked | OK |
| 9 | Mixed legacy + secure, same profile | OK |
| 10 | Multiple devices, same profile (revoking one doesn't affect another) | OK |
| 11 | Replacement device | OK |

Plus one bonus scenario beyond the brief's minimum list: **key rotation
actually invalidates a signature computed under the old key version**
(not just a cosmetic version-number bump).

Re-run any time — it seeds fresh state on every run (Node has no
`localStorage`), so results are deterministic.

## 2. Static code review (brief §45)

- **JavaScript syntax**: `node --check` against every `.js`/`.mjs` file.
  Zero syntax errors.
- **Imports**: a cross-check script verified every `import { X } from
  '...'` resolves to a real `export` in its target file, across the
  whole `js/` tree. Zero mismatches.
- **Unused imports**: a second script flagged imports never referenced
  again in the same file. Zero remaining.
- **JSON**: `firebase/firestore.indexes.json`, both `package.json` files
  parse as valid JSON.
- **Functions**: `functions/index.js` syntax-checked as CommonJS
  (its own `package.json` has no `"type": "module"`, matching the
  frontend's ESM `package.json` at the repo root).

## 3. Bugs found and fixed during development

- **Security-relevant**: `cryptoAdapter.js`'s `verifyDynamicMessage()`
  originally let the incoming tap payload's own `keyVersion` parameter
  override which key version was used to verify the signature. This
  meant rotating a device's key would NOT actually invalidate an old,
  captured signature — an attacker (or a stale/cloned tag) could simply
  keep asserting the old version number and the mock would happily
  re-derive and accept it. Fixed to always derive using the device
  record's own CURRENT `secureKeyVersion`, never a value the payload
  claims. The "Bonus" test above was written specifically to catch a
  regression of this and passes against the fixed version.
- `js/mock/mockSecureTap.js`'s first draft contained a dead scaffold
  function (`signCounter`) that computed a value and threw it away,
  left over from restructuring the file mid-write — removed, replaced
  with the real `cryptoAdapter.js`'s `signMessageForTests()` export.
- `js/adapters/cryptoAdapter.js`'s `hashToken()` first draft called an
  unrelated HMAC computation and discarded its result before separately
  computing the real SHA-256 hash — confused leftover code with no
  effect on correctness (the discarded call's result was never used) but
  removed for clarity.
- `functions/index.js`'s `verifySecurePath()` first draft contained a
  nonsensical self-referential ternary (always evaluating to the same
  string either way) — simplified to a plain return.
- `js/app.js`'s first draft used a `.then()`-based dynamic `import()`
  inside a click handler without awaiting it before calling `render()`
  immediately after — a real race condition that could show stale data
  after revoking a legacy device. Fixed by importing `updateDevice`
  statically at the top of the file instead.
- Two demo legacy token hashes were initially fabricated (arbitrary hex
  strings not actually corresponding to any real token) rather than
  computed from real tokens. Replaced with genuinely generated tokens
  and their verified SHA-256 hashes — confirmed by recomputing each hash
  from its token and comparing before shipping (one transcription error,
  a dropped trailing hex digit, was caught this way and fixed).

## 4. What was intentionally NOT tested

- **Real NTAG 424 DNA hardware or real AES-CMAC** — none exists to test
  against; that is the entire premise of this module (brief §25/§35).
  `cryptoAdapter.js`'s mock is tested thoroughly; the real cryptography
  it stands in for is not implemented here at all.
- **Visual/manual browser testing** of `admin.html`/`secure-nfc-test.html`
  (no browser available in this environment) — the logic those pages
  call (`verifyNfcTap()` and the mock device store) is exactly what
  `tests/run-tests.mjs` exercises directly.
- **Firestore rules simulation** — `firebase/firestore.rules` was
  reviewed by hand against brief §22's requirements (see
  `SECURITY-NOTES.md`) but not run against the Firebase emulator's rules
  test harness, since no Firebase project exists in this environment.
