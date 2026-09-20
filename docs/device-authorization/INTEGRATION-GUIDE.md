# INTEGRATION-GUIDE.md

How to fold this module into the real JMX Digital Card project. Nothing
here has been applied to your real project — this describes what a
developer should do after reviewing the code.

## 1. What this module needs from your project, and what it adds

**Adds (new collections):** `accounts` (if you don't already have an
equivalent), `identityProfiles`, `nfcDevices`, `deviceAuditLogs`.

**Reuses (existing, per brief §38):** Card IDs, Account IDs, Activation
Codes, plans (Basic/Premium/Business), your existing Google
Authentication and account-ownership checks. This module's job is
device authorization — it does not replace any of those.

## 2. Reusing your existing IDs instead of this module's generators

`services/ids.js` includes `generateAccountId()`, `generateCardId()`,
`generateIdentityProfileId()` so this ZIP's demo has something to seed
with real-looking data. **Do not use these when integrating** (brief
§43): every `nfcDevices/{deviceId}` document's `accountId`/`cardId`
fields should hold YOUR project's real, existing Account ID / Card ID —
whatever format and generator you already use. Only `generateDeviceId()`
and `generateDeviceToken()` are actually new concepts this module
introduces; keep using those two, adopt your own IDs for everything else.

If your project doesn't yet have a formal "Identity Profile" as its own
document (perhaps your card document already plays that role), you can
either: (a) introduce `identityProfiles` as this module proposes, with
`profileStatus` split out from card content, or (b) point
`identityProfileId` at your card's own ID and skip the collection
entirely, treating "profile" and "card" as the same document for now —
`validateDevice()`/`resolveNfcDevice()` only need SOME document at that
ID with a `profileStatus`-shaped field to check; adapt the field name if
yours differs.

## 3. What NOT to duplicate

- Don't create a second `accounts` collection if you already have
  account/customer records — add `allowedDeviceCount` (a single new
  field) to your existing collection instead of introducing a parallel
  one.
- Don't create a second Card ID scheme — `nfcDevices.cardId` should be
  your existing Card ID, verbatim.
- Don't duplicate plan data onto devices — plan lives on the account,
  exactly as it does today; `setPlan()`/your existing plan-change code
  never needs to touch `nfcDevices` at all (brief §37).

## 4. Cloud Functions to add

From `functions/deviceAuthorization.js`: `resolveNfcDevice`,
`createDevice`, `assignDevice`, `activateDevice`, `pauseDevice`,
`reactivateDevice`, `revokeDevice`, `replaceDevice`, `rotateDeviceToken`,
`setAllowedDeviceCount`. Copy `functions/index.js` and
`deviceAuthorization.js` into your Cloud Functions source (or add as a
second codebase), `npm install`, and update `assertStaff()` to match
however your project already determines staff/admin status if it isn't
the `admin` custom claim this file defaults to (see that file's header
comment).

## 5. Connecting `/d/{deviceId}` for real

Two implementation choices, both valid:

**Option A — static resolver page (what this ZIP demos):** Deploy
`resolver.html`/`resolver-app.js`, add a Hosting rewrite
(`/d/** → /resolver.html`), and have `resolver-app.js` call the
`resolveNfcDevice` **callable** function (via `httpsCallable`) instead of
the Local-Mode `validateDevice()` it uses in this ZIP. On success, redirect
into your real public card renderer using `destination.cardId`:
```js
const { data } = await resolveNfcDevice({ deviceId, token });
if (data.ok) window.location.replace(`/card/${data.destination.cardId}`);
```

**Option B — server-rendered redirect:** Convert `resolveNfcDevice` to an
`onRequest` HTTP function, put it directly behind the `/d/**` Hosting
rewrite, and have it issue an HTTP redirect itself — saves a client-side
round trip at the cost of losing the callable function's built-in
App Check / auth-context integration. Either is a legitimate choice;
Option A is what ships here because it mirrors the rest of this ZIP's
demo structure.

## 6. Wiring the admin UI into your existing admin console

`js/admin-ui.js` currently targets ONE hardcoded demo account
(`js/demo.js`'s `DEMO_IDS`). To use it against a real, multi-customer
admin console:

1. Replace `DEMO_IDS.accountId` references with whichever account the
   admin is currently viewing (from your existing customer-detail page's
   own routing/state).
2. Every `deviceService.js` call already takes `accountId`/`cardId`/
   `identityProfileId` as parameters — none of the lifecycle logic
   assumes a single demo account, only `admin-ui.js`'s rendering does.
3. Add a "Devices" tab/section to your existing per-customer admin
   screen that mounts `renderDevicesTab()`'s content (or reimplements
   its markup in your own admin's style) against the real
   `accountId`/`cardId`/`identityProfileId` for that customer.

## 7. Rules and indexes to review

`firebase/firestore.rules` — merge the `accounts` (if new to you),
`identityProfiles`, `nfcDevices`, `deviceAuditLogs` blocks into your real
rules. If `cards` here is your real existing collection, merge only the
`isStaff()` allowance into your current rule for it — read the header
comment in that file, and pay particular attention to the note under
`nfcDevices` about NOT granting Owner a direct read.

`firebase/firestore.indexes.json` — add these, or let Firebase's own
"this query needs an index" error guide you incrementally.

## 8. Migrating existing NFC hardware non-destructively

If you already have NFC devices in the field with no per-device
authorization record at all:

1. **Do nothing to hardware already issued.** It keeps working exactly
   as it does today — this module has no effect until you point a route
   at its resolver.
2. For NEW devices going forward, start minting them through
   `createDevice()`/`createBatch()` and programming the physical tag with
   `/d/{deviceId}?t={token}` instead of whatever direct URL scheme you
   use today.
3. Optionally, retroactively register already-issued hardware as
   `nfcDevices` records (using whatever identifier is already encoded on
   them as the new `deviceId`, if it fits the format — or leaving their
   URL scheme untouched and only using `nfcDevices` for hardware minted
   from this point forward). Either is fine; nothing forces a full
   backfill.

## 9. What still needs adaptation

- **Public card rendering**: `resolver-app.js`'s preview is a stand-in —
  point your real public card page at `destination.cardId`.
- **Role source of truth**: `assertStaff()` defaults to the `admin`
  custom claim; swap for your project's real role check.
- **Customer-facing device list**: build the recommended `getMyDevices`
  callable (see `SECURITY.md`) rather than reusing this demo's direct
  Local-Mode read in `customer-app.js`.
- **Rate limiting**: replace the in-memory limiter before relying on it
  in production — see `SECURITY.md`'s Rate limiting section for options.
