# JMX Digital Card — Google Wallet 36 Themes

Version 6.4 extends the existing Google Wallet Themes module additively.

- Preserved all 18 original theme IDs and behavior.
- Added 18 Premium Collection themes for 36 total catalog entries.
- New themes are configured in the same `WALLET_THEMES` catalog and recognized server-side by `saveGoogleWalletTheme` / `createGoogleWalletPass`.
- Existing `googleWalletTheme` values remain backward-compatible.
- The owner UI groups available entries as Classic Themes and Premium Themes without creating a second Wallet module.
- Premium preview effects use CSS; Google Wallet receives the compatible base `hexBackgroundColor`.
- Existing Save Theme, Google Wallet feature controls, client overrides, owner validation, object reuse, Card IDs, activation codes, and existing cards were not replaced.
- New premium entries are currently tagged for Business availability, consistent with the existing Business-only Google Wallet feature architecture; plan arrays can be changed later without rebuilding the UI.

## New themes
Platinum Prism; Obsidian Chrome; Midnight Spectrum; Ultraviolet Titanium; Emerald Amethyst; Sapphire Violet; Crimson Solar; Ruby Chrome; Champagne Metal; Rose Platinum; Molten Copper; Titanium Ice; Graphite Laser; Opal Shift; Arctic Hologram; Black Neon Flux; Scarlet Noir; Cosmic Pearl.

## Files changed
- `admin.js`
- `admin.css`
- `functions/index.js`

## File added
- `GOOGLE-WALLET-36-THEMES-IMPLEMENTATION-AUG2026.md`

No deployment or Git push was performed. No secrets were added.
