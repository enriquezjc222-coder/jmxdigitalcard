/**
 * plan-resolver.js — the ONE place that decides a card's plan.
 * Used by the public card (script.js), the customer editor (admin.js), the platform
 * dashboard (dashboard.js) and feature controls. functions/plan-resolver.js is a
 * CommonJS copy for Cloud Functions, kept identical by docs/qr-integration-tests/unit.test.mjs.
 *
 * Stored data is NEVER rewritten by this module: it only interprets it.
 *
 *   base plan  = cards/{id}.plan, compared case-insensitively
 *                ("basic" | "premium" | "business" | "jmx business")
 *   missing / unrecognised plan → LEGACY_PLAN_FALLBACK ("Premium")
 *       Why Premium: it is what every client-facing surface (public card and customer
 *       editor) has always applied to such cards, so these clients have always SEEN
 *       Premium features. Resolving them as Basic would hide phones, links, gallery…
 *       that are public today. Business-only features stay off (no accidental gift).
 *   effective plan = complimentaryBusiness → "Business",
 *                    else complimentaryPremium → "Premium",
 *                    else base plan   (same precedence as before on every surface)
 */
export const PLANS = Object.freeze(['Basic', 'Premium', 'Business']);
export const LEGACY_PLAN_FALLBACK = 'Premium';
const ALIASES = Object.freeze({ basic: 'Basic', premium: 'Premium', business: 'Business', 'jmx business': 'Business' });

/** Canonical plan name for a stored value, or null when missing / unrecognised. */
export function normalizePlanName(raw) {
  if (typeof raw !== 'string') return null;
  return ALIASES[raw.trim().toLowerCase().replace(/\s+/g, ' ')] || null;
}

/** Base (paid) plan of a card document. */
export function resolveBasePlan(card) {
  const raw = card && typeof card === 'object' ? card.plan : undefined;
  const canonical = normalizePlanName(raw);
  if (canonical) return { plan: canonical, source: canonical === raw ? 'stored' : 'normalized', raw: raw ?? null };
  const missing = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
  return { plan: LEGACY_PLAN_FALLBACK, source: missing ? 'missing' : 'invalid', raw: raw ?? null };
}

/** Effective plan (complimentary tiers applied). */
export function resolveEffectivePlan(card) {
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

export const effectivePlanName = (card) => resolveEffectivePlan(card).plan;
export const basePlanName = (card) => resolveBasePlan(card).plan;
