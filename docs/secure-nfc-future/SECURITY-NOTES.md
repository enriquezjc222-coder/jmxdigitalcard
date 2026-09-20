# SECURITY-NOTES.md

## MOCK MODE vs. PRODUCTION SECURE MODE (brief §35) — the one thing to never blur

| | MOCK MODE (this ZIP, today) | PRODUCTION SECURE MODE (after `NTAG424-INTEGRATION-GUIDE.md`) |
|---|---|---|
| Signature algorithm | HMAC-SHA256 (`cryptoAdapter.js`) | Real AES-CMAC, per NXP's NTAG 424 DNA spec |
| Key derivation | HMAC over a placeholder string | Real AES-128 key diversification (AN10922) from a real master key |
| Master key | `PLACEHOLDER_MASTER_KEY_DO_NOT_USE_IN_PRODUCTION`, a literal string in source | A real secret, generated once, stored ONLY in a secrets manager |
| PICC data | Plaintext `uid`/`ctr` query params | AES-encrypted `PICC_DATA`, decrypted server-side |
| Proves | The verification FLOW is correct and testable | Real cryptographic security against a real attacker |

**Mock mode proves the architecture works. It proves nothing about
cryptographic security.** Do not deploy `cryptoAdapter.js` as-is. Do not
tell a customer "secure mode is live" until `NTAG424-INTEGRATION-GUIDE.md`
section 4's replacement has actually happened.

## No promises of the impossible (brief §16)

This module never claims:
- "Impossible to clone" — physical security has no absolutes.
- Legacy (NTAG215/216) devices are cryptographically secure — they
  aren't, and `LEGACY-COMPATIBILITY.md`/the admin UI's own informational
  text say so plainly.

What it does claim, and what's actually true of the design:
- A secure-mode device's dynamic signature cannot be reused (replay
  protection via a monotonic counter) — true of the mock's logic today,
  and will remain true once real AES-CMAC replaces the mock, since the
  counter-monotonicity check doesn't depend on which signature algorithm
  verified the message.
- A legacy device's authorization CAN be individually revoked
  server-side, which is real, working protection against continued use
  of a specific lost/stolen physical object — it just doesn't prevent
  the initial act of reading a chip's stored URL.

## Where real secrets must live (brief §5/§34)

Never in: any `.js` file in this ZIP, any HTML file, `localStorage`,
`sessionStorage`, a public Firestore document, browser memory of any
kind, a Cloud Function's plaintext environment variable, or source
control. Only in: a secrets manager (Google Secret Manager, AWS Secrets
Manager, HashiCorp Vault) that your backend calls at the moment it needs
to derive a key — never persisting the derived key beyond that single
verification.

`PLACEHOLDER_MASTER_KEY_DO_NOT_USE_IN_PRODUCTION` appears in
`js/adapters/cryptoAdapter.js` and `functions/index.js`. Both locations
say so in their own header comments. It protects nothing — there is no
real secret in this ZIP, anywhere.

## Firestore rules — what a client can never do (brief §22)

`firebase/firestore.rules`'s `securityFieldsUnchangedOrStaff()` blocks
any non-staff write that touches: `deviceSecurityType`, `chipModel`,
`secureKeyVersion`, `sunEnabled`, `lastVerifiedCounter`,
`lastVerifiedAt`, `secureUid`, `status`, `tokenHash`. This is enforced as
an explicit field allowlist on top of the role check, not just the role
check alone — a client cannot self-authorize, cannot flip itself into
secure mode, cannot forge a counter value by writing it directly instead
of going through verification.

## Error codes never leak more than they should (brief §29/§30)

Every rejection returns one of the `REASON` codes in `js/constants.js`
(`DEVICE_NOT_FOUND`, `DEVICE_REVOKED`, `INVALID_TOKEN`,
`INVALID_SIGNATURE`, `REPLAY_DETECTED`, `COUNTER_INVALID`,
`SECURE_MODE_REQUIRED`, `MALFORMED_PAYLOAD`) — useful for admin tooling
and logs, but `PUBLIC_DENY_MESSAGE` is what an actual tap-resolution
public surface should show a tapper: one generic message, regardless of
which specific reason fired, so a script probing `/d/{id}` responses
can't use the message text to distinguish "wrong signature" from
"revoked" from "doesn't exist."

## Rate limiting / abuse — not addressed in this module by design

This module intentionally does not duplicate the sibling
NFC-Device-Authorization module's rate-limiting discussion — that
module's SECURITY.md already documents a best-effort limiter and its
real limitations (in-memory state doesn't survive Cloud Function cold
starts). The same caveats and the same recommended fixes (a Firestore
counter, Firebase App Check) apply here once `resolveNfcTap` is a real,
deployed, publicly-reachable function.
