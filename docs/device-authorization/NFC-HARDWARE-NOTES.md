# NFC-HARDWARE-NOTES.md

## Standard chips (brief §19) — what this module assumes today

NTAG213, NTAG215, and NTAG216 (and similar "standard" NFC forum Type 2
tags) store their content — typically a URL — in plain, readable memory.
Any NFC reader/writer app can read that URL off a genuine tag and write
the identical bytes onto a second, blank tag. **This is a property of
the chip, not a bug in this module**, and no amount of clever backend
code changes it: if the URL itself is the only secret, copying the URL
is enough to copy the card.

This module's response is architectural, not physical: authorization
lives server-side, keyed by a Device ID (and optionally a token) that
the resolver checks on every tap. Copying the URL copies the Device ID
(and token, if present) — but doesn't grant the copier any ability to
change that Device ID's authorization state. If the legitimate owner (or
an admin, on their behalf) revokes the original device, the copy stops
working at the exact same moment the original does, because they're
both resolving the same server-side record.

**What standard chips do NOT protect against:** someone who has
physical access to a tag reading its URL. If that's a serious concern
for a given deployment, use a device token (`?t=`) — a URL alone,
without the correct token, does not resolve — or, for the strongest
guarantee, move to SECURE_DYNAMIC hardware below.

## SECURE_DYNAMIC — NTAG 424 DNA / SUN (future option, brief §20)

NXP's NTAG 424 DNA (and the broader "SUN" — Secure Unique NFC — message
authentication pattern some other secure chips implement) generates a
fresh cryptographic signature on every single tap, computed by the
chip's own secure element using a key it never exposes. The URL a phone
reads is different every time, and a URL captured from one tap cannot be
replayed or reused for a second one — copying the tag's memory at one
point in time does not give you a working clone, because the chip itself
(not just the server) is part of proving authenticity.

**This module does not implement SECURE_DYNAMIC validation.** What it
does do is reserve the field: `securityMode` is stored on every device
record (`STANDARD` | `SECURE_DYNAMIC`), defaulting to `STANDARD`, so that
a future integration can:

1. Add SUN-message parsing (the encrypted/CMAC'd parameters NTAG 424
   DNA appends to its URL) to the resolver, gated on
   `device.securityMode === 'SECURE_DYNAMIC'`.
2. Roll it out per-device — existing `STANDARD` devices keep using
   today's Device-ID-plus-optional-token check; only newly issued
   `SECURE_DYNAMIC` hardware needs the new verification path.
3. Never have to touch or re-migrate a single existing device record to
   do it.

## Practical recommendation

- Low-to-medium risk deployments (most small businesses' digital cards):
  `STANDARD` mode with a device token is a reasonable, inexpensive
  default — this is what this module ships working code for today.
- High-value or high-fraud-risk deployments (large enterprise rollouts,
  anything where an attacker has strong incentive to clone a specific
  card): budget for NTAG 424 DNA hardware and treat `SECURE_DYNAMIC`
  support as a real, scheduled follow-up project, not an afterthought —
  it requires both new hardware procurement and new resolver code, and
  should be scoped as its own piece of work.
