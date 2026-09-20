# JMX Secure NFC — Future Architecture Module

A forward-compatible layer that prepares **JMX Digital Card** to support
cryptographic NFC chips — specifically NTAG 424 DNA — **without breaking
or replacing** today's NTAG215/NTAG216 devices. This module does not
touch your existing project. It is a standalone architecture + working
mock you review, then integrate manually — see
`NTAG424-INTEGRATION-GUIDE.md`.

## The one-sentence version

Every device already carries a `deviceSecurityType`: `legacy` (today's
NTAG215/216, Device ID + token + hash — unchanged) or `secure` (NTAG 424
DNA, adding a dynamic counter + cryptographic signature) — and one
central function, `verifyNfcTap()`, reads that flag and routes to the
right verification path, so a `/d/{deviceId}` route never needs its own
if/else for chip type.

## Running it

Static site, no build step:

```bash
python3 -m http.server 8080
# open http://localhost:8080/index.html
```

- **Device Registry** (`admin.html`) — every device, legacy or secure,
  with its verification status and basic actions (revoke, rotate key
  version).
- **Test Harness** (`secure-nfc-test.html`) — buttons that run a real
  valid tap, an invalid signature, a replay attack, a revoked device,
  and legacy taps, all through the exact same code a production
  `/d/{deviceId}` route would call.

Run the automated tests (no browser required):

```bash
node tests/run-tests.mjs
```

## Mock Mode -- read this before anything else

**Nothing in this ZIP has real NTAG 424 DNA hardware to talk to.**
Every cryptographic function (`js/adapters/cryptoAdapter.js`) is a MOCK:
it uses HMAC-SHA256 as a stand-in for the chip's real AES-CMAC, and a
placeholder string stands in for a real master key. This demonstrates
the verification FLOW -- key derivation, signature check, replay
protection via a monotonic counter -- completely and testably, without
demonstrating that the flow is cryptographically equivalent to real
NTAG 424 DNA security. See `SECURITY-NOTES.md` for exactly what "mock"
does and doesn't mean here, and `NTAG424-INTEGRATION-GUIDE.md` for what
changes when real hardware arrives.

The legacy path's token hashing (SHA-256) is NOT mock -- that part is a
real, standard primitive with nothing chip-specific to fake.

## What's inside

| File | Role |
|---|---|
| `js/constants.js` | Shared vocabulary: `deviceSecurityType`, statuses, error codes |
| `js/adapters/cryptoAdapter.js` | MOCK crypto (HMAC stand-in for AES-CMAC) + real SHA-256 token hashing |
| `js/adapters/secureNfcProvider.js` | The interface any secure chip adapter implements |
| `js/adapters/ntag424Provider.js` | The concrete NTAG 424 DNA adapter |
| `js/services/legacyNfcService.js` | Unchanged NTAG215/216 verification |
| `js/services/secureNfcService.js` | Secure-mode lifecycle + verification |
| `js/services/nfcSecurityService.js` | `verifyNfcTap()` -- the central decision engine |
| `js/resolver/nfcResolver.js` | Parses a `/d/{deviceId}` request and calls the engine |
| `js/mock/mockDevices.js` | Fictional demo data (2 legacy + 2 secure devices, one profile) |
| `js/mock/mockSecureTap.js` | Builds real (mock) valid/invalid/replay tap payloads for testing |
| `js/app.js`, `js/test-harness.js` | The two demo UIs |
| `functions/index.js` | Reference Cloud Functions (same mock crypto, server-side) |
| `firebase/firestore.rules` | Proposal -- clients can never touch security-critical fields |
| `tests/run-tests.mjs` | Automated tests covering every brief §43 scenario |

## Documentation

- `SECURE-NFC-ARCHITECTURE.md` -- the dual-mode design and why.
- `NTAG424-INTEGRATION-GUIDE.md` -- what changes when you buy real hardware.
- `LEGACY-COMPATIBILITY.md` -- exactly what does and doesn't change for NTAG215/216.
- `SECURITY-NOTES.md` -- the mock/production boundary, key handling, what's NOT guaranteed.
- `TESTING.md` -- what was tested and how.
