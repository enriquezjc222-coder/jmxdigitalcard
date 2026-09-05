# JMX Digital Card — Google Wallet final integration

This package finalizes the existing Google Wallet implementation without rebuilding card IDs, activation codes, public URLs, inventory, or existing cards.

## Changes
- `admin.js`: Google Wallet owner access now honors an explicit per-client override; the Add to Google Wallet section remains owner-only and is hidden from administrator editor sessions.
- `dashboard.js`: the existing Google Wallet plan/global feature remains intact; each client now has a dedicated tri-state `INHERIT / ON / OFF` Google Wallet override. Explicit ON/OFF can override the plan/global setting for that client.
- `dashboard.css`: styling for the tri-state client control.
- `functions/index.js`: server-side Wallet authorization uses the same tri-state rule and now requires the authenticated card owner (administrator access alone is not sufficient).

## Visibility and security
- Public `card.html` was not given a Google Wallet button.
- The existing owner-only Google Wallet section remains in `admin.html`, which is the private card editor reached after owner login.
- `createGoogleWalletPass` still validates permissions server-side and uses `GOOGLE_WALLET_SERVICE_ACCOUNT` from Secret Manager.

## Publishing
No Firebase deploy or GitHub push was performed while preparing this ZIP. Because `functions/index.js` changed, `createGoogleWalletPass` must be redeployed after review. Frontend changes must also be published to the website.
