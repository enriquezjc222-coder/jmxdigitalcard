# DEVICE-LIFECYCLE.md

## The states (brief §6)

| Status | Meaning | Occupies an account's device slot? |
|---|---|---|
| `AVAILABLE` | Minted, sitting in inventory, not linked to anyone | No |
| `ASSIGNED` | Linked to an account/card/identityProfile, not yet activated | Yes |
| `ACTIVE` | Activated, currently eligible to resolve | Yes |
| `PAUSED` | Temporarily disabled, reversible | Yes |
| `REVOKED` | Permanently disabled (lost/stolen/fraud) — terminal | No |
| `REPLACED` | Superseded by a newer device on the same profile — terminal | No |

`authorizationStatus` (`AUTHORIZED`/`UNAUTHORIZED`) moves alongside
`status` in every transition below — see `ARCHITECTURE.md` for why it's
still tracked as a separate field.

## Why REVOKED and REPLACED are both terminal but kept separate

The brief's own worked example (§14) describes losing a card as "DEV001
→ REVOKED", and separately lists `REPLACED` as one of the states a
device can be in (§6). We kept them as two distinct terminal states
because they answer different questions for reporting and support:

- **REVOKED**: something went wrong with this specific device (lost,
  stolen, suspected cloned) — set directly via `revokeDevice()`, with no
  replacement device implied. A customer who calls in with "I lost my
  card" gets this, on its own, until/unless they also want a new one.
- **REPLACED**: routine hardware succession — set as a side effect of
  `replaceDevice()`, which ALSO creates the new device in the same call.
  You will never see a `REPLACED` device without a `replacedByDeviceId`
  pointing at a real, currently-live device; you may well see a
  `REVOKED` device with no replacement at all.

In practice, calling `replaceDevice(oldId, {...})` is how you handle
"customer lost their card and wants a new one" as ONE admin action —
the old device ends up `REPLACED` (not bare `REVOKED`) because a
replacement was, in fact, issued in the same flow.

## Transitions

```
                 createDevice()
                       |
                       v
                  AVAILABLE
                       |  assignDevice(accountId, cardId, identityProfileId)
                       |  (blocked if account is already at allowedDeviceCount)
                       v
                  ASSIGNED
                       |  activateDevice()
                       v
   +---------------  ACTIVE  <---------------+
   |                   |                      |
   | pauseDevice()     | revokeDevice()       | reactivateDevice()
   v                   v                      |
 PAUSED -----------> REVOKED               PAUSED
   |
   +-- only way out of PAUSED other than revoke: reactivateDevice()

 ACTIVE -- replaceDevice() --> this device becomes REPLACED
                                a NEW device is created, pre-assigned
                                and ACTIVE on the SAME account/card/
                                identityProfile
```

Token rotation (`rotateDeviceToken()`) is orthogonal to all of the
above — it can be called on any device regardless of status, and never
changes `status`/`authorizationStatus` itself. It only overwrites
`tokenHash`, immediately invalidating whatever token was in use before.

## What never changes across any transition

- `deviceId` — never reassigned, never reused.
- `accountId` / `cardId` / `identityProfileId` — set once at `assignDevice()`
  (or inherited by a replacement device from the device it replaces) and
  never changed by any lifecycle action, including a plan change
  (brief §37).
- The identity profile itself — no lifecycle action on a device ever
  creates, deletes, or reassigns a profile. A profile with three devices
  attached still has exactly one profile after two of them are revoked.

## Device limit enforcement (brief §11/§36)

`assignDevice()` checks `getActiveDeviceCountForAccount(accountId) <
account.allowedDeviceCount` before linking a device — devices counted as
"occupying a slot" are exactly those in `ASSIGNED`, `ACTIVE`, or `PAUSED`
(see the table above). A `REVOKED` or `REPLACED` device frees its slot
immediately, so an account doesn't need its limit raised just because it
churned through a couple of lost cards over time.

Changing the limit itself (`setAllowedDeviceCount()`) is staff-only and
audited (`device_limit_changed`).
