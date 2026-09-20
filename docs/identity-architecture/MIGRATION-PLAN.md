# Safe Rollout Plan

1. Keep the currently published site untouched until this ZIP has been reviewed locally.
2. Deploy Cloud Functions first.
3. Deploy Firestore rules and indexes.
4. Sign in as the platform administrator and invoke `rebuildIdentityRegistry` once.
5. Inspect `accounts`, `users`, and a few existing `cards`/`nfcDevices` in Firestore.
6. Confirm recycled/released cards do not retain the previous account identity.
7. Deploy Hosting only after the backend checks pass. Hosting contains no replacement for the existing `/d/** -> device.html` resolver.

## Rollback

The existing production collections remain authoritative. If the identity layer must be disabled, stop deploying/calling the new identity functions. The additive Account/Identity Profile fields can remain without affecting the existing public card route.
