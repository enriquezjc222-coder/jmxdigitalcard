/**
 * qr-config.js — JMX card QR settings (single source for every QR of every card).
 *
 * logoScaleTarget: 0.22 = MAXIMUM target width of the JMX emblem relative to the
 * TOTAL rendered QR width (quiet zone included). It is a target, not a promise:
 * qr-engine.js shrinks the emblem automatically whenever 22% would touch a
 * protected pattern or exceed the per-block error budget, and card-qr.js shrinks
 * it further (or removes it) if the rendered QR does not decode back to the
 * exact target URL. Readability always wins.
 */
const assetUrl = (file) => {
  try { return new URL(`./assets/${file}`, import.meta.url).href; } catch { return `/js/jmx-qr/assets/${file}`; }
};

const state = {
  qr: {
    errorCorrection: 'H',          // always H
    quietZone: 4,                  // ISO minimum, never less
    logoScaleTarget: 0.22,         // of the TOTAL QR width (see above)
    logoScale: 0.22,               // engine-level default (symbol-relative; card-qr converts the target)
    maxLogoScale: 0.30,            // hard ceiling (symbol-relative)
    minLogoScale: 0.09,            // below this the emblem is dropped instead
    logoErrorBudget: 0.4,          // conservative share; preserves blur margin on 128 px Business Logo QRs
    minVersionWithLogo: 6,         // tiny symbols have too little redundancy for a centre logo
  },
  defaults: {
    foregroundColor: '#000000',
    backgroundColor: '#FFFFFF',
  },
  assets: {
    jmxLogoUrl: assetUrl('jmx-qr-center-logo.png'),
    jmxLogoMaskUrl: assetUrl('jmx-qr-center-logo-mask.png'),
  },
};

export function getQrModuleConfig() { return state; }
export function configureCardQr(overrides = {}) {
  for (const [k, v] of Object.entries(overrides)) state[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? { ...state[k], ...v } : v;
  return state;
}
