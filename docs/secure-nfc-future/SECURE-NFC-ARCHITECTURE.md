# SECURE-NFC-ARCHITECTURE.md

## The naming decision (brief §2)

The brief offered several names for the per-device security flag:
`deviceSecurityType`, `securityMode`, `chipSecurity`, `deviceClass`. This
module uses **`deviceSecurityType`** throughout — it's the brief's own
first example, and it reads unambiguously as "which kind of device
authentication does this specific unit use" rather than something that
could be confused with account-level security settings.

Values: `legacy` (NTAG215/216) or `secure` (NTAG 424 DNA or equivalent).

## Dual-mode compatibility (brief §3/§10/§39)

```
                     verifyNfcTap({ deviceId, token, secureParams })
                                      |
                        look up device.deviceSecurityType
                                      |
                    +-----------------+-----------------+
                    |                                     |
              "legacy"                                "secure"
                    |                                     |
         legacyNfcService.verifyLegacyTap        secureNfcService.verifySecureTap
         (Device ID + token + hash --                  (looks up the chip's
          exactly what works today,                 SecureNfcProvider by chipModel,
          unchanged)                                  delegates the crypto check)
                    |                                     |
                    +-----------------+-----------------+
                                      |
                        SAME normalized response shape
                        { success, mode, deviceId, accountId,
                          cardId, identityProfileId, reason }
```

Both paths resolve to the identical destination shape. Nothing above
`nfcSecurityService.js` — the resolver, the admin UI, a future public
card renderer — ever needs to know or care which path actually ran.

## Why the crypto adapter and the chip provider are separate layers

- **`secureNfcProvider.js`/`ntag424Provider.js`** (brief §33): defines
  "what does verifying a tap from THIS chip model look like" —
  URL-parameter naming, which fields matter. A future chip (a different
  vendor's SUN-compatible part, say) implements this same interface and
  registers itself; nothing in `secureNfcService.js` changes.
- **`cryptoAdapter.js`** (brief §24): the actual cryptographic primitives
  (`deriveDeviceKey`, `verifyCmac`, `validateCounter`) that a provider's
  `verifyTap()` calls into. Kept separate so a future upgrade — swapping
  the mock HMAC for a real vetted AES-CMAC library, say — touches ONE
  file, not every provider that uses it.

This is also why no raw key material is ever visible above
`cryptoAdapter.js` (brief §5): `secureNfcService.js` calls
`provider.verifyTap(payload, deviceRecord)` and gets back
`{ ok, reason }` — never a key, never an intermediate crypto value.

## Field model (brief §4)

`nfcDevices/{deviceId}` carries every field regardless of
`deviceSecurityType` — a legacy device simply leaves the secure-only
fields `null`:

| Field | Legacy | Secure |
|---|---|---|
| `deviceId`, `accountId`, `cardId`, `identityProfileId` | yes | yes |
| `deviceType`, `chipModel`, `status` | yes | yes |
| `tokenHash` | yes (SHA-256 of the device token) | `null` |
| `secureUid` | `null` | yes (the chip's UID) |
| `secureKeyVersion` | `null` | yes (see key versioning below) |
| `sunEnabled` | `null`/`false` | `true` |
| `lastVerifiedCounter`, `lastVerifiedAt` | `null` until first tap | yes, updated every successful tap |
| `createdAt`, `updatedAt`, `authorizedAt`, `revokedAt` | yes | yes |

## Key versioning (brief §19/§20)

`secureKeyVersion` starts at `1` for every newly registered secure
device. `rotateSecureKeyVersion()` increments it. Verification always
derives the expected key using the device record's **current**
`secureKeyVersion` — a signature computed under an old version is
rejected once the version has moved on, which is what makes rotation an
actual security action rather than a cosmetic counter. (An earlier draft
of this module let the incoming payload's own claimed key version
override this — see `TESTING.md`'s "Bugs found and fixed" for why that
was wrong and how the automated tests caught it.)

## Multiple devices, one profile, independent everything (brief §11/§12/§40)

`identityProfileId` is just another field on each device record — the
same as the sibling NFC-Device-Authorization module's design. A profile
with a legacy card, a legacy sticker, and two secure keychains has four
`nfcDevices` documents, each independently authorized and independently
revocable. Revoking one only ever updates that one document.

## Replacement (brief §41)

`replaceSecureDevice(oldDeviceId, { deviceId, secureUid, ... })`:
revokes the old device, registers a brand-new one (new Device ID, new
`secureUid`, key version resets to 1 for that new device) on the exact
same `accountId`/`cardId`/`identityProfileId`. No profile is ever
created or deleted by a replacement.

## What this module deliberately does NOT do

- It does not reimplement device issuance/assignment/plan handling —
  that's the sibling NFC-Device-Authorization module's job. This module
  only adds the `deviceSecurityType` dimension and the secure
  verification path on top.
- It does not implement real AES-CMAC or real key management — see
  `SECURITY-NOTES.md`.
- It does not change any existing public URL or existing Device ID
  scheme (brief §38/§43).
