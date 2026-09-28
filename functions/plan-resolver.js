"use strict";
/**
 * plan-resolver.js (Cloud Functions copy) — MUST stay identical in behaviour to
 * ../js/plan-resolver.js (the browser module). Parity is enforced by
 * docs/qr-integration-tests/unit.test.mjs. See that file for the rationale of
 * LEGACY_PLAN_FALLBACK = "Premium" (what clients have always seen publicly).
 */
const PLANS = Object.freeze(['Basic', 'Premium', 'Business']);
const LEGACY_PLAN_FALLBACK = 'Premium';
const ALIASES = Object.freeze({ basic: 'Basic', premium: 'Premium', business: 'Business', 'jmx business': 'Business' });

/** Canonical plan name for a stored value, or null when missing / unrecognised. */
function normalizePlanName(raw) {
  if (typeof raw !== 'string') return null;
  return ALIASES[raw.trim().toLowerCase().replace(/\s+/g, ' ')] || null;
}

/** Base (paid) plan of a card document. */
function resolveBasePlan(card) {
  const raw = card && typeof card === 'object' ? card.plan : undefined;
  const canonical = normalizePlanName(raw);
  if (canonical) return { plan: canonical, source: canonical === raw ? 'stored' : 'normalized', raw: raw ?? null };
  const missing = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
  return { plan: LEGACY_PLAN_FALLBACK, source: missing ? 'missing' : 'invalid', raw: raw ?? null };
}

/** Effective plan (complimentary tiers applied). */
function resolveEffectivePlan(card) {
  const base = resolveBasePlan(card);
  const complimentary = card?.complimentaryBusiness === true ? 'Business' : card?.complimentaryPremium === true ? 'Premium' : null;
  return {
    plan: complimentary || base.plan,
    basePlan: base.plan,
    baseSource: base.source,
    rawPlan: base.raw,
    complimentary,
    legacyFallback: base.source === 'missing' || base.source === 'invalid',
  };
}

const effectivePlanName = (card) => resolveEffectivePlan(card).plan;
const basePlanName = (card) => resolveBasePlan(card).plan;

module.exports = { PLANS, LEGACY_PLAN_FALLBACK, normalizePlanName, resolveBasePlan, resolveEffectivePlan, effectivePlanName, basePlanName };
