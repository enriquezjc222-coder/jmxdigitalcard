# JMX Digital Card — Identity Architecture Integration

This release integrates the useful parts of the standalone **Identity & Resolver** module into the real JMX Digital Card project without replacing the production NFC resolver, current Card IDs, current profile documents, activation codes, QR URLs, Wallet flows, leads, analytics, or the existing admin/editor.

## Why this integration is different from the standalone module

The real project already has a working `/d/{deviceId}` resolver, `nfcDevices`, `nfcBatches`, customer activation, card ownership, profiles, and device lifecycle controls. Creating a second `devices` collection, a second resolver page, or a second `profiles/{profileId}` tree would duplicate production data and create conflicting sources of truth.

This release therefore keeps the existing production collections and adds only a normalized identity layer around them.

## New normalized collections

- `users/{uid}` — authenticated user identity and account relationship.
- `accounts/{accountId}` — customer/account identity. One account can own one or more existing Card IDs.
- `identityAuditLogs/{logId}` — server-written mapping/detachment history.

## Additive fields on existing records

The following existing documents can receive identity fields. Existing fields are preserved.

- `cards/{cardId}`: `accountId`, `identityProfileId`, `identityMappedAt`
- `profiles/{cardId}`: `accountId`, `identityProfileId`, `cardId`
- `cardOwners/{cardId}`: `accountId`, `identityProfileId`
- `cardAdmin/{cardId}`: `accountId`, `identityProfileId`
- `nfcDevices/{deviceId}`: `accountId`, `identityProfileId`

The existing `profiles` document ID remains the Card ID. `identityProfileId` is a separate stable identity value and does not rename or move the existing document.

## Stable IDs

- Account ID: `JMX-A` + 7 unambiguous cryptographic characters.
- Identity Profile ID: `PRF-` + 8 unambiguous cryptographic characters.
- Existing Card IDs: unchanged.
- Existing Device IDs: unchanged.
- Existing Activation Codes: unchanged.

The pre-existing Device/Card-ID generator in the activation backend was also changed from `Math.random()` to `crypto.randomBytes()` so newly allocated IDs use a cryptographically strong source.

## Automatic synchronization

Cloud Firestore triggers synchronize identity metadata when:

- a `cardOwners/{cardId}` record is created or changed;
- a customer card changes plan/status;
- the existing profile changes;
- an existing NFC device is linked to a Card ID.

Removing a card owner detaches the identity fields from the reusable Card ID and linked NFC device, and removes that Card ID from the account's `cardIds` list. This prevents a recycled Card ID from inheriting the previous customer's Account ID.

## Admin visibility

The existing client detail dialog now displays:

- Account ID
- Identity Profile ID

No new public identity data is shown on the public card page or returned by the public NFC resolver.

## Backfill

The callable Cloud Function `rebuildIdentityRegistry` can be run once by the configured JMX platform administrator after Functions and rules/indexes are deployed. It walks existing `cardOwners` records and creates/synchronizes the normalized identity registry.

Do not run a destructive migration. This backfill is additive.
