# Google Wallet Themes implementation

Added an additive, owner-only Wallet theme system with 18 initial themes and an extensible catalog structure.

## Changed
- `dashboard.js`: adds `googleWalletThemes` to Global/Basic/Premium/Business controls and tri-state per-client overrides.
- `admin.html`, `admin.css`, `admin.js`: adds the responsive owner-only theme selector, live premium preview, Save Theme action, and plan-aware availability.
- `functions/index.js`: validates owner, plan, feature controls, and selected theme server-side; stores only `googleWalletTheme`; applies the compatible `hexBackgroundColor` to the existing Generic Object.

## Safety
- No Card IDs or activation codes are rewritten.
- Existing Wallet object IDs are reused by `createGoogleWalletPass`.
- Existing cards without a theme resolve to `default`.
- No service-account JSON/private key is included.
- No GitHub push or Firebase deploy was performed.

## Publish later
Deploy `saveGoogleWalletTheme` and the updated `createGoogleWalletPass`, then publish the web files.
