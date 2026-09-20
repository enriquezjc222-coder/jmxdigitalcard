# JMX Digital Card — Unified Data Architecture Integration (September 2026)

## Purpose

This Prueba 8 keeps the Prueba 7 application as the runtime base and adds the useful contracts from both Claude modules without replacing the proven public URL, NFC, activation, wallet, analytics, leads, or local-preview flows.

## Canonical relationship now supported

`users/{uid}` → `accounts/{accountId}` → `identityProfiles/{identityProfileId}` → `cards/{cardId}` → `nfcDevices/{deviceId}`

The existing `profiles/{cardId}` document remains in place for editable/public card content. `identityProfiles` is a lightweight identity registry, not a duplicate of the card profile.

## Live integration changes in this build

1. `ensureIdentityForCard()` now creates/maintains `identityProfiles/{identityProfileId}` in addition to the existing additive mappings.
2. `accounts` documents now use `schemaVersion: 2` when synchronized.
3. Detaching ownership marks the canonical identity profile `detached` and clears its primary card reference instead of silently leaving an apparently active mapping.
4. `getIdentityRecord()` now returns the canonical `identityProfile` document when present.
5. Firestore rules include owner-read/admin-write protection for `identityProfiles`.
6. The original Data Architecture Module is included under `architecture/data-core/` for integration reference and future adapter extraction.
7. The Identity + NFC Data Extension is included under `architecture/identity-nfc-extension/`, including its passing test suite and integration contract.

## Deliberately NOT replaced

- Existing public URL records and routing.
- Existing `profiles/{cardId}` content schema.
- Existing NFC activation codes/batches.
- Existing Cloud Functions for NFC resolver/token authorization.
- Existing device-security future module.
- Existing local-preview controls.
- Existing feature switches, wallet, leads, analytics, QR, or Google Authentication.

## Why this is safer

The canonical identity registry is added alongside the live collections instead of attempting a destructive database migration. Existing cards keep their current Card IDs, account mappings, device IDs, URLs, activation flow, and profile documents.

## Before production deployment

Use the existing admin-only identity rebuild/synchronization flow in a controlled environment, inspect generated `accounts` and `identityProfiles`, and only then deploy rules/functions to production. Production release: LOCAL PREVIEW runtime has been removed. Secure-NFC mock/test modules are not deployed; only the production-compatible schema and backend preparation remain.
