# LEGACY-COMPATIBILITY.md

## The one guarantee this whole module exists to keep

**No NTAG215/216 device stops working because this module exists.**
`legacyNfcService.js` is verbatim the same Device ID + token + hash
check that already works today — this module adds a router
(`nfcSecurityService.js`) in front of it, not a replacement.

## What changes for a legacy device

Nothing. Literally:

- Its Device ID: unchanged.
- Its token: unchanged.
- Its stored hash: unchanged.
- Its verification logic: unchanged — `legacyNfcService.js` contains no
  new dependency on anything crypto-adapter-related; it imports only
  `tokenMatchesHash()`, the same plain SHA-256 comparison this module's
  sibling NFC-Device-Authorization module already documents.
- Its physical NFC tag: never needs reprogramming.

## What's NEW that a legacy device now also has

One additional field on its `nfcDevices` document:
`deviceSecurityType: "legacy"`. That's the only difference between a
device record from before this module existed and one after — every
other field a legacy device already had keeps meaning exactly what it
meant.

## Why legacy verification doesn't get "upgraded" with mock crypto

Brief §27 is explicit: don't put fake cryptography into the legacy
path. `legacyNfcService.js` does not import anything from
`cryptoAdapter.js`'s CMAC/counter logic, on purpose — mixing them would
imply legacy devices got some kind of security upgrade they didn't
actually get. A legacy device's real security properties (and real
limitations — see `SECURITY-NOTES.md`) are exactly what they were before
this module: Device ID authorization plus an optional token, and nothing
about copying the physical chip's stored URL is prevented.

## Coexistence, concretely

`js/mock/mockDevices.js` seeds exactly this scenario: one
`identityProfileId` with two legacy devices (one active, one revoked)
AND two secure devices (one active, one revoked) all pointing at the
same profile. `tests/run-tests.mjs`'s scenario 9 ("Mixed legacy +
secure, same profile") asserts both an active legacy device and an
active secure device resolve to the identical profile in the same test
run — see `TESTING.md`.

## Migration is optional, forever

Nothing about integrating this module requires converting a single
existing legacy device. A business can keep selling NTAG215/216 stock
indefinitely, start selling NTAG 424 DNA units alongside it whenever
ready, and let the two coexist on the same customer's profile
indefinitely — see `SECURE-NFC-ARCHITECTURE.md`'s field model and
`NTAG424-INTEGRATION-GUIDE.md` for what's involved in issuing a NEW
secure device once real hardware exists.
