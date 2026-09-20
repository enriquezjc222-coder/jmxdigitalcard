# TESTING.md

## 1. Automated functional tests — `tests/run-tests.mjs`

Runs entirely in plain Node (no browser, no Firebase project) against
the real `services/deviceService.js` code the UI calls, seeded from
`js/demo.js`. Possible because `services/kvStorage.js` falls back to an
in-memory store when `localStorage` doesn't exist, and `services/ids.js`
uses the Web Crypto API (`crypto.getRandomValues`/`crypto.subtle.digest`),
both available as globals in modern Node.

```bash
node tests/run-tests.mjs
```

**Last run: 43 / 43 checks passed.**

| Brief test case | Covered by | Result |
|---|---|---|
| 1. Valid device + valid token | `validateDevice()` on the seeded active device returns `ok: true` with the correct destination, no sensitive fields in the response | OK |
| 2. Nonexistent device | `validateDevice()` on a well-formed but unregistered Device ID returns `reason: not_found` | OK |
| 3. Revoked device | Seeded revoked device, even with its OWN former valid token, is denied with `reason: revoked` | OK |
| 4. Paused device | Seeded paused device is denied with `reason: paused` | OK |
| 5. Wrong token | An active device with a wrong token, and with no token at all, is denied with `reason: bad_token` | OK |
| 6. Token rotation | The original token works, then `rotateDeviceToken()` runs, then the OLD token fails and the NEW token succeeds | OK |
| 7. Device limit enforcement | An account at `allowedDeviceCount: 1` rejects a second `assignDevice()`; raising the limit then allows it | OK |

Additional coverage beyond the brief's minimum list, exercised in the
same run:

- **Plan change never touches any ID** (brief §37): `setPlan()` changes
  `account.plan` while `accountId` and every linked `deviceId` stay
  identical, and the device remains `ACTIVE`.
- **Replace device** (brief §14): old device becomes `REPLACED` and
  links forward; new device links back, lands on the identical
  `accountId`/`identityProfileId` (no new profile created), and is
  immediately `ACTIVE`; the old device is thereafter denied with
  `reason: replaced`.
- **Device ID generation**: 20 freshly generated Device IDs all pass
  `validateDeviceId()` and are pairwise distinct.

Re-run any time with `node tests/run-tests.mjs` — it seeds fresh state
on every run (Node has no `localStorage`, so each run starts from
`js/demo.js`'s seed plus whatever the test script itself creates),
making results deterministic.

## 2. Static code review (brief §50)

- **JavaScript syntax**: `node --check` against every `.js`/`.mjs` file
  (root `package.json` sets `"type": "module"` for the frontend/services
  files; `functions/` has its own CommonJS `package.json`). Zero syntax
  errors.
- **Import correctness**: a cross-check script verified every
  `import { X } from '...'` in `services/` and `js/` resolves to a real
  `export` in its target file. Zero mismatches.
- **Unused imports**: a second script flagged imports never referenced
  again in the same file. Zero remaining after cleanup (see "Bugs found
  and fixed" below).
- **HTML**: four pages, each with a single `#app-root` mount and no
  duplicate `id` attributes (checked explicitly); all JS loaded as
  `type="module"`.
- **JSON**: `firebase/firestore.indexes.json`, `functions/package.json`,
  and the root `package.json` all parse as valid JSON.
- **Firestore rules**: reviewed by hand for the one hard requirement
  (brief §26/§44) — no `allow read, write: if true` anywhere in
  `firebase/firestore.rules`.
- **Async/error handling**: every `deviceService.js`/
  `deviceAuthorization.js` function is `async` and throws a descriptive
  `Error`/`HttpsError` on invalid input or a failed precondition; the
  admin UI wraps every mutation in `withErrorToast()` so a thrown error
  becomes a toast instead of an unhandled rejection.
- **Token validation / revocation / pause / replace / rotation / device
  limit**: each has an explicit, passing automated test above, not just
  a manual read-through.

## 3. Bugs found and fixed during review

- `functions/deviceAuthorization.js` originally defined `exports.activateDevice`
  **twice** — once as a bare arrow function (never wrapped in `onCall`,
  so it would not have been a valid callable Cloud Function at all) and
  once correctly wrapped, immediately after. The first definition was
  simply overwritten by the second at module-load time, so the bug was
  silent (the correct version happened to win) rather than a hard
  failure — but silent-by-luck is still a bug. Removed the incorrect
  first definition and left the single, correctly-wrapped one in its
  proper place alongside `pauseDevice`/`reactivateDevice`.
- An early draft of `tests/run-tests.mjs`'s plan-change test computed a
  variable from a self-contradicting ternary (always the same value
  either way) and never used the result — harmless (dead code, no
  incorrect assertion), but removed for clarity once noticed.
- `admin-ui.js` had one unused import caught by the unused-import
  script (`DEVICE_TYPES`, redundant once only `DEVICE_TYPE_LABELS` is
  used there) — removed.

## 4. What was intentionally NOT tested end-to-end

- **Firebase Mode** itself (real Firestore, real Cloud Functions
  deployment, real Google Sign-In) — no live Firebase project exists in
  this environment, and the brief asks for no real deploys or
  credentials. `functions/deviceAuthorization.js` and `index.js` were
  syntax-checked and manually reviewed against the same business rules
  the passing Node tests verify for the client-side implementation, but
  not executed against a live Firestore.
- **Visual/manual browser testing** of `admin.html`/`resolver.html`/
  `customer.html` (no browser available in this environment) — the
  underlying logic those pages call (`deviceService.js`) is exactly what
  `tests/run-tests.mjs` exercises directly; the DOM-rendering code itself
  received a full static/manual read-through instead.
- **A real NTAG 424 DNA / SUN integration** — `securityMode` is stored
  but `SECURE_DYNAMIC` verification logic is explicitly not implemented;
  see `NFC-HARDWARE-NOTES.md`.
