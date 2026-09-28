# Inventory audit run-2026-09-24T15-48-22-315Z

Generated 2026-09-24T15:48:22.331Z. READ-ONLY: nothing was changed.

| STATUS | COUNT | SAFE TO DELETE? | REASON |
|---|---|---|---|
| ACTIVE | 13 | NO | Card has an owner, a used activation code or is activated. |
| ASSIGNED_NFC | 1 | NO | An NFC device or batch (reserved / pending / active) points to this card. |
| HAS_REFERENCES | 1 | NO | Referenced by data that must be preserved (history, analytics, identity, wallet, client data or physical tag). |
| IN_STOCK | 1 | NO | Valid inventory: available to sell / activate. |
| IN_STOCK_PROGRAMMED | 1 | NO | Valid inventory: a physical NFC tag already carries this URL. |
| ORPHAN_FRAGMENT | 1 | YES, after validation | Only blank profile/cardAdmin stub documents remain (no card, no inventory, no owner, no references). /c/{id} already shows "not found". |
| ORPHAN_FRAGMENT | 1 | REVIEW REQUIRED | Only blank profile/cardAdmin stub documents remain (no card, no inventory, no owner, no references). /c/{id} already shows "not found". |
| ORPHANED_INVENTORY | 1 | REVIEW REQUIRED | Inventory document without a card document (e.g. left after an NFC return). /c/{id} cannot be activated in this state; it may still correspond to physical stock. |
| SOLD_PENDING_ACTIVATION | 1 | NO | Sold, waiting for the client to activate. |
| UNREACHABLE_ID | 1 | YES, after validation | ID "stock7" is never reached by a public URL (public ID would be "STOCK7"); not programmed; no references. |

Delete candidates: **2** · Review required: **2**

## Integrity counts

- activeClients: 13
- activatedCards: 12
- profiles: 20
- accounts: 13
- identityProfiles: 0
- nfcDevices: 2
- usedActivationCodes: 0
- walletObjects: 0
- inventoryInStock: 1
- inventoryPending: 2
- inventoryNotActivated: 9
- profilesWithClientData: 12

## Cards without a valid plan: 2 (missing 1, unrecognised 1)

- LEG09 (missing) → Premium; dashboard/server feature changes: phone2, website, instagram, linkedin, twitter, tiktok, youtube, services, gallery, video, finalCTA, businessLinks, catalog, customBusiness, analytics; NFC impact: 0; no action needed (public behaviour unchanged)
- LEG10 (invalid "gold") → Premium; dashboard/server feature changes: phone2, website, instagram, linkedin, twitter, tiktok, youtube, services, gallery, video, finalCTA, businessLinks, catalog, customBusiness, analytics; NFC impact: 0; no action needed (public behaviour unchanged)
