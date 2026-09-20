# SECURITY.md

## The honest premise (brief §2/§19)

This module does **not** promise a copied NFC tag is impossible. With a
standard NTAG213/215/216-class chip, anyone who can read the tag's full
memory can copy its URL onto another blank tag. What this module DOES
guarantee is that the copy doesn't work unless it was independently
authorized:

- Every physical unit has its own **Device ID**, registered server-side.
- A URL alone resolving requires that Device ID's record to exist, be
  `ACTIVE`, and be `AUTHORIZED` — copying the URL doesn't copy that
  server-side state.
- If a device is suspected compromised, **revoke it** (permanent) or
  **rotate its token** (if using one) — either instantly stops that
  specific physical object from resolving, without affecting any other
  device on the same profile.

## Where validation actually runs (brief §23)

The decision is never made by client-side JavaScript alone:

- **Firebase Mode (production):** `functions/deviceAuthorization.js`'s
  `resolveNfcDevice` is the authority. It runs with the Admin SDK, which
  bypasses Firestore rules entirely — so `firebase/firestore.rules`
  can safely deny public reads of `nfcDevices` altogether (see that
  file's comments) without breaking the resolver.
- **Local Mode (this ZIP's demo, no server available):**
  `services/deviceService.js#validateDevice()` implements the identical
  algorithm and runs it client-side, because there is no server to call.
  This is a demo-only necessity — **do not** ship Local Mode's resolver
  path to production. `resolver.html`/`resolver-app.js` should call the
  `resolveNfcDevice` Cloud Function once Firebase Mode is configured;
  swapping that one call site is the entire migration (see
  `INTEGRATION-GUIDE.md`).

## Token storage (brief §17/§45)

- Generated with `crypto.getRandomValues`/`crypto.randomBytes` — never
  `Math.random()`. 128 bits of entropy (16 random bytes, hex-encoded).
- Only `hashToken(rawToken)` (SHA-256, hex) is ever persisted, as
  `tokenHash`. The raw token is shown to the admin exactly once, at
  creation/rotation/replacement time, in a one-time "copy this now"
  modal — the UI never displays it again afterward, and it is never
  written to `localStorage` or any log.
- Comparison at resolve time uses a constant-time-equal check
  (`crypto.timingSafeEqual` server-side; an equivalent constant-time XOR
  loop client-side in `ids.js#tokenMatchesHash`) so a timing side-channel
  can't be used to guess the token byte-by-byte.
- A device created without calling for a token check simply has no
  `tokenHash` set — the resolver's `if (device.tokenHash)` branch means
  Device-ID-only validation still works for devices that don't need the
  extra layer, without special-casing.

## Rate limiting / abuse (brief §25) — and its real limitation

`deviceService.js` and `deviceAuthorization.js` both include a small,
best-effort in-memory rate limiter: 5 failed resolutions per Device ID
per 60-second window trips `RATE_LIMITED`. **This is not sufficient on
its own in production**, for one specific reason worth stating plainly:
a Cloud Function's in-memory state does not persist across cold starts
and is not shared across concurrent instances — an attacker spread
across enough parallel requests, or simply unlucky/lucky timing around
an instance recycling, can exceed 5 attempts without ever hitting the
same in-memory counter twice.

What this demo's limiter DOES give you: a real deterrent against a naive
single-threaded brute-force loop hitting one warm instance repeatedly,
and a concrete place to plug in something stronger. Before relying on
this in production, replace `recentFailures`/`isRateLimited`/
`recordFailure` with one of:

- A Firestore document per Device ID with a rolling counter and
  `FieldValue.increment`, checked and reset transactionally.
- **Firebase App Check** on the callable function, which rejects
  requests that don't come from your genuine app/attested client before
  they ever reach this code.
- A dedicated service (Cloud Armor, a Redis-backed limiter, etc.) in
  front of the function's HTTPS endpoint.

Every rejected resolution (bad token, rate limited, revoked, etc.) also
writes a `resolve_rejected` entry to `deviceAuditLogs` with the internal
reason code — useful for spotting a pattern (many failures against one
Device ID) even before a stronger rate limiter is in place.

## Error messages (brief §46)

The public-facing message is **the same generic string** regardless of
the specific internal reason (`PUBLIC_DENY_MESSAGE` /
`PUBLIC_PAUSED_MESSAGE` in `constants.js`) — a wrong token, a revoked
device, and a nonexistent Device ID all look identical to whoever tapped
the tag. The specific `reason` code (`not_found`, `bad_token`, `revoked`,
etc.) is only ever surfaced in the admin/audit-facing parts of this
module, never in the public response body in a way a script scraping
`/d/{id}` responses could use to enumerate which Device IDs exist versus
which ones merely have the wrong token.

## Public vs. Owner vs. Staff read access (brief §26/§27)

- **Public (unauthenticated):** no direct Firestore read of `accounts`,
  `cards`, `identityProfiles`, `nfcDevices`, or `deviceAuditLogs` at all.
  The only public-facing surface is `resolveNfcDevice`'s narrow return
  shape.
- **Owner (a signed-in customer):** this module intentionally does NOT
  grant a direct Firestore read of `nfcDevices`, even scoped to their own
  `accountId` — see the long comment in `firebase/firestore.rules`
  explaining why (rules control whole-document access, and a device
  document carries `tokenHash`/`adminNote`). `customer.html`'s Local-Mode
  reads are a demo-only shortcut; a real customer-facing device list
  should go through a dedicated callable (e.g. `getMyDevices`) that
  filters fields server-side, the same pattern `resolveNfcDevice` uses.
- **Staff (`admin` custom claim):** full read/write, exactly as this
  module's admin UI uses it.

## What the client can and cannot do (brief §9/§12)

The Device ID and token grant **read access to one public profile
projection**, nothing more. They never grant:

- Edit access to any card/profile content (that still depends entirely
  on your existing Google Authentication + account-ownership checks).
- The ability for a customer to register, authorize, or reassign a
  device themselves — every lifecycle-changing function in
  `deviceService.js`/`deviceAuthorization.js` other than `validateDevice`/
  `resolveNfcDevice` requires staff.

## Sensitive fields, and why the resolver never returns them

`tokenHash`, `adminNote`, `revokedBy`, `assignedBy`, `tokenRotatedBy`,
and the full audit trail are never included in `validateDevice()`'s or
`resolveNfcDevice`'s return value — success or failure. Grep the
`publicView`/`destination` shape in either file: it is a fixed, small
allowlist of fields (`accountId`, `cardId`, `identityProfileId`,
`businessName`, `publicSlug`, `deviceType`), not "the document minus a
blocklist" — an allowlist can't leak a field nobody thought to blocklist
yet.

## Future hardware option (brief §20)

`securityMode` is stored per-device (`STANDARD` | `SECURE_DYNAMIC`) but
`SECURE_DYNAMIC` is **not implemented** in this module — see
`NFC-HARDWARE-NOTES.md`. Storing the field now means a future
NTAG 424 DNA / SUN integration only has to add handling for devices
tagged that way, not migrate every existing device record.
