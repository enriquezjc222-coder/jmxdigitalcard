# QR Card Themes implementation

Added additive QR Card Themes support using the existing 36 Google Wallet visual definitions.

- Profile Editor: Themes dropdown in QR & Networking Settings, 36-theme selector, live preview, Save Changes persistence via `qrCardTheme`.
- Public profile: existing QR remains; themed QR card appears below it when allowed.
- Feature Control Center: `qrCardThemes` added to Global / Basic / Premium / Business controls.
- Client detail: independent INHERIT / ON / OFF override.
- No Card IDs, activation codes, URLs, owners, inventory records, or existing cards are changed by this source update.
- Google Wallet `googleWalletTheme` remains independent from `qrCardTheme`.
