# ARCHITECTURE.md

## The problem this module solves

A physical NFC tag's content (its URL) can, on standard chips, be read and
copied to another physical tag. Without a server-side authorization layer,
a copied URL would open the same profile from an unauthorized physical
object. This module adds that layer: every physical unit gets its own
**Device ID**, is individually authorized, and can be individually
revoked — without ever promising the copying itself is impossible (see
`NFC-HARDWARE-NOTES.md`).

## The chain

```
Account (identity/ownership)
   │
   ├── Card (existing JMX Digital Card, unchanged)
   ├── Identity Profile (the digital profile the card renders)
   │
   └── nfcDevices (1..N per account, independently authorized)
          │
          ▼
     /d/{deviceId}?t={token}
          │
          ▼
   resolveNfcDevice()  ── server-side, authoritative
          │
    ┌─────┴─────┐
   valid       invalid
    │             │
    ▼             ▼
 public       "This NFC device
 profile       is not authorized."
```

`accountId`, `cardId`, and `identityProfileId` are carried directly on
each device document (denormalized on purpose — see "Why denormalized"
below) so that resolving a tap never needs more than a handful of direct,
by-ID lookups (brief §48 — no full collection scans, ever).

## Why denormalized (accountId/cardId/identityProfileId on every device)

An alternative design would store only `identityProfileId` on the device
and look up the account/card through it. We chose to store all three
directly on `nfcDevices` because:

1. **Fewer round trips at tap time.** The resolver already needs to
   verify account/card/profile status independently (brief §7 lists them
   as separate AND conditions) — having their IDs on the device means
   three direct `.doc(id).get()` calls, not a chain of dependent lookups.
2. **Independent revocation stays independent.** Nothing about a
   device's own record depends on walking through other documents to
   find out who it belongs to — useful for audit queries
   (`deviceAuditLogs` by `accountId`) and for admin search.
3. The tradeoff is the usual one for denormalization: if a card were ever
   moved to a different identity profile independently of its devices,
   every device would need updating too. Given how rarely that happens
   compared to how often a tap happens, this is the right tradeoff here.

## Why authorizationStatus is separate from status

`status` answers "where is this device in its lifecycle" (`AVAILABLE` →
`ASSIGNED` → `ACTIVE` → `PAUSED`/`REVOKED`/`REPLACED`). `authorizationStatus`
answers a narrower question: "is this device currently allowed to
resolve, right now." In today's code the two move together — every
lifecycle transition sets both — but keeping them as two fields means:

- The resolver's core rule (brief §7) can be read and audited as an
  explicit `AND`, not inferred from a single overloaded status value.
- A future addition (e.g. an automated fraud-detection routine flipping
  authorization off pending human review, without wanting to also claim
  the device is "PAUSED" for inventory-reporting purposes) has somewhere
  to write to without overloading `status`.

## Two device tokens? No — one Device ID, one optional Device Token

- **Device ID** (`DEV-XXXXXXXXXXXX`) identifies *which* physical unit.
  It is not secret — it's printed on/encoded into the tag and appears in
  the resolved URL.
- **Device Token** is an optional, high-entropy secondary secret (brief
  §17). If a device has one set (`tokenHash` present), the resolver
  requires it to match; devices created without a token skip that check.
  Storing only `hashToken(rawToken)` (SHA-256) means a Firestore data
  leak alone doesn't hand out working tokens — see `SECURITY.md`.

## File map

| File | Role |
|---|---|
| `services/constants.js` | Every enum/collection name — the shared vocabulary |
| `services/ids.js` | Device ID + token generation, validation, hashing |
| `services/kvStorage.js` | Dual-environment (browser/Node) key-value shim |
| `services/localStore.js` | Local Mode's generic per-collection store |
| `services/backend.js` | The ONE file that knows both Local and Firestore exist |
| `services/firebaseConfig.example.js` | Placeholder config + Local/Firebase toggle |
| `services/auditService.js` | Writes/reads `deviceAuditLogs` |
| `services/deviceService.js` | Device lifecycle API + `validateDevice()` (the algorithm) |
| `services/authService.js` | Demo session/sign-in |
| `functions/deviceAuthorization.js` | The SAME algorithm, authoritative, server-side |
| `functions/index.js` | Firebase Functions entry point |
| `js/app.js` | UI kit (toasts/modal) + admin.html boot/shell |
| `js/admin-ui.js` | Admin screen content (devices, audit log, settings) |
| `js/resolver-app.js` | resolver.html's `/d/{deviceId}` demo |
| `js/customer-app.js` | customer.html's minimal device list |
| `js/demo.js` | Fictional seed data (1 account, 1 card, 1 profile, 4 devices) |

This is a small, intentional extension beyond the brief's suggested file
list (`services/constants.js`, `ids.js`, `kvStorage.js`, `localStore.js`,
`backend.js`, `firebaseConfig.example.js`, `auditService.js`, plus
`js/admin-ui.js`, `resolver-app.js`, `customer-app.js`) — factored out so
`deviceService.js` and `app.js` don't balloon into unmaintainable single
files, exactly as the brief's own §41 note ("Puedes mejorar esta
estructura") invites.
