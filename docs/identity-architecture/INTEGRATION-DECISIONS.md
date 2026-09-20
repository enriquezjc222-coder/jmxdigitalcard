# Integration Decisions — Claude module vs. production project

## Adopted

- Stable Account identity separate from Card ID.
- Stable internal Profile identity.
- One Account can contain multiple Card IDs.
- Cryptographically generated human-readable IDs.
- Account/user registry.
- Separation of plan, account status and subscription status.
- Identity lifecycle cleanup when ownership is removed.
- Server-side identity audit trail.
- Gradual, non-destructive backfill.

## Adapted to the real project

- Claude's proposed `profiles/{profileId}` collection was not introduced because the production project already uses `profiles/{cardId}`. A new field named `identityProfileId` provides the stable profile identity without moving existing data.
- Claude's proposed `devices` collection was not introduced because production already has `nfcDevices` and a full Device-ID lifecycle.
- Claude's proposed `/d/{deviceId}` resolver was not installed because production already has `/d/** -> device.html` and `resolveNfcDevice`.
- Claude's separate `activationCodes` collection was not introduced because the current NFC batch/device activation system already handles activation codes.

## Removed from the previous Prueba 2 approach

The previous compatibility layer was not used as the new base. This release starts from the original GitHub copy (`prueba 1`) and integrates the identity concepts directly against the production schema, avoiding a second generic data-service demo layer that was not connected to the current admin.
