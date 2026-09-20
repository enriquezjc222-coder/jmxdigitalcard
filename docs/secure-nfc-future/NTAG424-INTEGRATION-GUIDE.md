# NTAG424-INTEGRATION-GUIDE.md

What actually changes the day real NTAG 424 DNA hardware arrives, and
what stays exactly as this ZIP already has it.

## 1. What NTAG 424 DNA's real output looks like (and how it differs from this mock)

This module's mock uses a simplified URL shape for demonstrability:

```
/d/{deviceId}?uid={secureUid}&ctr={counter}&sig={signature}&kv={keyVersion}
```

**Real NTAG 424 DNA, configured for SDM (Secure Dynamic Messaging),
produces something structurally different.** The chip appends its
dynamic data as part of the URL in one of two forms, both defined in
NXP's NTAG 424 DNA datasheet and AN12196 application note:

- **`PICC_DATA`** (or `SDMENCFileData`): an AES-encrypted block
  containing the chip's real UID and its read counter. The backend must
  **decrypt** this using the correct per-device key before it even has a
  UID/counter to look at — there is no plaintext `uid=`/`ctr=` pair to
  read directly.
- **`SDMMAC` (or `CMAC`)**: an AES-CMAC computed over (a defined subset
  of) the URL, using a second derived key, which the backend verifies
  AFTER decrypting the PICC data.

So real integration needs a decrypt step this mock skips entirely (the
mock's `uid`/`ctr` are already plaintext) plus a real AES-CMAC
verification (this mock's HMAC-SHA256 stand-in). Budget for both.

## 2. What you must physically program into the chip

Using NXP's official configuration tooling (TagWriter, or your own tool
built against NXP's documented APDU commands), each NTAG 424 DNA unit
needs:

- **SDM enabled** on the relevant file, with the URL template configured
  to emit `PICC_DATA` and `SDMMAC` in the positions your backend expects.
- **Diversified keys** written to the chip — derived from your master
  key and that specific chip's real UID, using NXP's documented key
  diversification method (see AN10922). The chip's own key material
  never leaves the chip once written; your backend re-derives the SAME
  key on demand from the master key + UID to verify.
- A **key version** matching whatever `secureKeyVersion` you register
  for that device in `nfcDevices`.

## 3. What goes in the URL vs. what the backend receives

| In the URL (what the chip emits) | What the backend does with it |
|---|---|
| `PICC_DATA` (encrypted UID + counter) | Decrypt using the device's derived key to recover the real UID + counter |
| `SDMMAC` | Recompute the expected CMAC using the derived key and compare |
| (nothing else secret) | Device ID (`/d/{deviceId}` path) is the only plaintext identifier — exactly like this mock |

## 4. How the backend verifies it (replacing the mock)

Replace exactly two functions in `js/adapters/cryptoAdapter.js` (and
their server-side mirrors in `functions/index.js`):

- `deriveDeviceKey(secureUid, keyVersion)` — call a real AES-128 key
  diversification implementation (NIST-vetted, or a maintained library
  implementing NXP's AN10922 method) against your REAL master key,
  which must live in a secrets manager (Google Secret Manager, HashiCorp
  Vault, etc.) — never in source control, never in a Cloud Function's
  plain environment variables, never in any file this ZIP ships.
- `verifyCmac()` — decrypt `PICC_DATA` (AES-128-CBC per the datasheet),
  then verify `SDMMAC` with a real AES-CMAC implementation, using a
  vetted crypto library — do not hand-roll AES or CMAC.

`validateCounter()` needs no change — monotonic-counter replay
protection is the same logic regardless of which crypto verified the
signature.

## 5. What must NEVER touch the browser (brief §5)

The master key. The per-device diversified keys. Any intermediate value
derived from either. `cryptoAdapter.js`'s real implementation belongs
EITHER in a Cloud Function (calling out to Secret Manager) or in a
dedicated backend service — never bundled into any file served to a
browser. If you're tempted to "just derive the key client-side to save a
round trip," don't; that defeats the entire point of secure hardware.

## 6. Where the pieces plug in

- `js/adapters/ntag424Provider.js` (`parseTapPayload`) — update to parse
  the real `PICC_DATA`/`SDMMAC` URL parameters (whatever names your SDM
  configuration uses) instead of this mock's plaintext `uid`/`ctr`/`sig`.
- `js/adapters/cryptoAdapter.js` — replace as described in §4 above.
- Everything else (`secureNfcService.js`, `nfcSecurityService.js`,
  `nfcResolver.js`, the admin UI, the Firestore schema, the rules) needs
  **no changes** — this is the entire point of the provider/adapter
  separation (brief §33), see `SECURE-NFC-ARCHITECTURE.md`.

## 7. Rollout

You do not need to convert any existing device. Register new secure
devices going forward with `registerSecureDevice()` (or the
`registerSecureDevice` Cloud Function once deployed), keep selling
NTAG215/216 in parallel for as long as you want, and let
`deviceSecurityType` do the routing — see `LEGACY-COMPATIBILITY.md`.
