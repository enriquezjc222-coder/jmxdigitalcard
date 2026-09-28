# Rules tests on the Firebase Emulator (run BEFORE deploying storage.rules)

Validated on Windows with Firebase CLI 15.28.1, Node 20.20.2 and Java 21: **8/8 tests pass**.
Nothing here touches production: the project id is `demo-jmx`, which the emulators treat as
offline.

Requirements on your computer: Node 20/22, Java 11+ (for the Firestore emulator).

```powershell
# Windows PowerShell, from the project root. Running npm inside the folder avoids
# a Windows/npm 10 issue where `npm --prefix ... install` can search the root.
Push-Location docs/emulator-tests
npm install
Pop-Location
firebase.cmd emulators:exec --project demo-jmx --only firestore,storage "node --test docs/emulator-tests/rules.emulator.test.mjs"
```

```bash
# bash, from the project root
(cd docs/emulator-tests && npm install)
firebase emulators:exec --project demo-jmx --only firestore,storage \
  "node --test docs/emulator-tests/rules.emulator.test.mjs"
```

The root `firebase.json` already points the emulators at `firestore.rules` and
`storage.rules` (default ports 8080 / 9199). Expected: 8 tests, all passing.

| Case | Expected |
|---|---|
| OWNER uploads / overwrites / deletes `cards/X/qrBusinessLogo/a.png` | DENIED |
| OWNER uploads `cards/X/profile/a.png`, gallery JPG, catalog PDF; deletes own profile file | ALLOWED (unchanged) |
| ADMIN uploads + deletes `cards/X/qrBusinessLogo/a.png` | ALLOWED |
| another client / anonymous uploads | DENIED |
| non-PNG (jpeg, svg, pdf) in `qrBusinessLogo`, even admin | DENIED |
| file ≥ 12 MB | DENIED |
| public read of card media | ALLOWED (unchanged) |
| OWNER writes `cards/X.qrBusinessLogo` in Firestore | DENIED; ADMIN ALLOWED |

If any case fails, do **not** deploy `storage.rules`; the previous rules remain in effect.
