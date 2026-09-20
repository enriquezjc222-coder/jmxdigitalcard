# Identity Data Map

```text
Firebase Auth UID
      |
      v
users/{uid}
      | accountId
      v
accounts/{accountId}
      | cardIds[] / primaryCardId
      +-----------------------------+
      |                             |
      v                             v
cards/{cardId}                 cards/{otherCardId}
      | accountId                    |
      | identityProfileId            |
      v                              v
profiles/{cardId}              profiles/{otherCardId}
      |
      +--> cardOwners/{cardId}
      +--> cardAdmin/{cardId}
      +--> nfcDevices/* where cardId == this Card ID
```

The real Card ID remains the routing/public-card key. The Identity Profile ID is an internal stable identity and does not become a public URL.

## Account state

`accounts/{accountId}` keeps separate axes:

- `plan`: Basic / Premium / Business
- `accountStatus`: active / suspended / archived
- `subscriptionStatus`: active / complimentary / past_due / canceled

Plan changes do not change Account ID, Identity Profile ID, Card ID or Device ID.
