/**
 * feature-controls.js — the ONE feature-permission resolver used by the public card
 * (script.js), the customer editor (admin.js) and the platform dashboard (dashboard.js).
 *
 * Data (unchanged, no migration):
 *   platform/publicSettings.featureControls = { enabled, global:{key:bool}, Basic:{…}, Premium:{…}, Business:{…} }
 *   cards/{cardId}.featureOverrides         = { key: true | false }   (absent key = INHERIT)
 *
 * Precedence (most general → most specific):
 *   1. GLOBAL   global[key] === false            → OFF for every card (kill switch; nothing overrides it)
 *   2. OVERRIDE featureOverrides[key] true/false → ENABLED / DISABLED for this card
 *               (absent → INHERIT: fall through to the plan)
 *   3. PLAN     plan bucket (Basic / Premium / Business) — missing keys default to ON
 *      Legacy mode (enabled === false): Business = all, Premium = all except
 *      quickCapture/leads/advancedAnalytics, Basic = BASIC defaults.
 *
 * Switching a feature OFF never deletes the card's saved settings (colours, logos, links…);
 * they are simply not rendered, and come back unchanged when the feature is switched ON.
 *
 * Kept byte-for-byte equivalent to the previous per-page resolvers (see
 * docs/qr-integration-tests/unit.test.mjs) and to functions/index.js featureAllows().
 */
export const OVERRIDE = Object.freeze({ INHERIT: 'inherit', ENABLED: 'enabled', DISABLED: 'disabled' });
export const LEGACY_PREMIUM_EXCLUDED = Object.freeze(['quickCapture', 'leads', 'advancedAnalytics']);

/** Default controls for a list of feature keys. */
export function defaultFeatureControls(keys, { basicDefaults, businessOnly }) {
  const global = {}; const Basic = {}; const Premium = {}; const Business = {};
  for (const k of keys) { global[k] = true; Basic[k] = basicDefaults.has(k); Premium[k] = !businessOnly.has(k); Business[k] = true; }
  return { enabled: true, global, Basic, Premium, Business };
}

/** Stored controls merged over the defaults (new keys get their default; stored values win). */
export function mergeFeatureControls(raw, defaults) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: r.enabled !== false,
    global: { ...defaults.global, ...(r.global || {}) },
    Basic: { ...defaults.Basic, ...(r.Basic || {}) },
    Premium: { ...defaults.Premium, ...(r.Premium || {}) },
    Business: { ...defaults.Business, ...(r.Business || {}) },
  };
}

/** INHERIT / ENABLED / DISABLED for one card override value. */
export function overrideState(overrides, key) {
  const v = overrides && typeof overrides === 'object' ? overrides[key] : undefined;
  return v === true ? OVERRIDE.ENABLED : v === false ? OVERRIDE.DISABLED : OVERRIDE.INHERIT;
}

/** Plan layer only (no global, no override). `plan` is compared case-insensitively. */
export function planAllowsFeature(controls, plan, key, basicDefaults) {
  const p = String(plan || '').toLowerCase();
  if (controls.enabled === false) {
    if (p === 'business') return true;
    if (p === 'premium') return !LEGACY_PREMIUM_EXCLUDED.includes(key);
    return basicDefaults.has(key);
  }
  const bucket = p === 'basic' ? controls.Basic : p === 'business' ? controls.Business : controls.Premium;
  return bucket?.[key] !== false;
}

/** Full resolution: GLOBAL → OVERRIDE → PLAN. */
export function resolveFeature({ controls, plan, overrides, key, basicDefaults }) {
  if (controls.global?.[key] === false) return false;
  const o = overrideState(overrides, key);
  if (o === OVERRIDE.ENABLED) return true;
  if (o === OVERRIDE.DISABLED) return false;
  return planAllowsFeature(controls, plan, key, basicDefaults);
}

/** What the card would get with its override set to INHERIT (GLOBAL → PLAN). */
export function inheritedFeature({ controls, plan, key, basicDefaults }) {
  if (controls.global?.[key] === false) return false;
  return planAllowsFeature(controls, plan, key, basicDefaults);
}
