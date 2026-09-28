// Pure audit logic (no I/O): inventory classification, plan audit, integrity counts,
// candidate selection and re-validation for the EXECUTE stage.
import { bundlesFromFlatDb, classifyCard, summarize, SAFE } from '../../../js/inventory-classifier.js';
import { resolveEffectivePlan } from '../../../js/plan-resolver.js';
import { defaultFeatureControls, mergeFeatureControls, resolveFeature } from '../../../js/feature-controls.js';

// Same lists as script.js (verified by docs/qr-integration-tests/unit.test.mjs).
export const FEATURE_KEYS = ["description","saveContact","quickActions","phone","phone2","whatsapp","email","website","location","facebook","instagram","linkedin","twitter","tiktok","youtube","services","gallery","video","qr","customQR","qrDownload","businessLogoQr","finalCTA","businessLinks","catalog","customBusiness","analytics","advancedAnalytics","quickCapture","leads","contactNotes","meetingNotes","followUp","csvExport","vcfDownload","contactMap","aiScanner","autoIntroEmail","appleWallet","googleWallet","googleWalletThemes","qrCardThemes","profileThemes","brandingRemoval","advancedNetworkingInsights"];
export const BASIC_FEATURE_DEFAULTS = new Set(["description","saveContact","quickActions","phone","whatsapp","email","location","facebook","qr","profileThemes"]);
export const BUSINESS_ONLY_FEATURES = new Set(["customQR","qrDownload","businessLogoQr","advancedAnalytics","quickCapture","leads","contactNotes","meetingNotes","followUp","csvExport","vcfDownload","contactMap","aiScanner","autoIntroEmail","appleWallet","googleWallet","googleWalletThemes","qrCardThemes","brandingRemoval","advancedNetworkingInsights"]);
const SERVER_GATED = ['aiScanner', 'googleWallet', 'googleWalletThemes'];
const NFC_TYPES = ['card', 'sticker', 'keychain', 'bracelet', 'ring', 'plate', 'tag', 'other'];

/** Stable fingerprint of what a candidate looks like (EXECUTE aborts if it changed). */
export function fingerprint(r) {
  return JSON.stringify({ c: r.category, s: r.safeToDelete, refs: r.references, st: r.status, inv: r.inventoryStatus, p: r.profile });
}

export function runAudit(flatDb, { storageFiles = {}, runId = `run-${Date.now()}` } = {}) {
  const bundles = bundlesFromFlatDb(flatDb, { storageFiles });
  const results = bundles.map(classifyCard);
  const summary = summarize(results, flatDb);
  summary.integrity.profilesWithClientData = results.filter((r) => r.profile === 'client data').length;
  const candidates = results.filter((r) => r.safeToDelete === SAFE.YES).map((r) => ({
    id: r.id, url: r.url, category: r.category, status: r.status, inventoryStatus: r.inventoryStatus,
    references: r.references, reason: r.reasons.join(' '), confidence: r.confidence, recommendedAction: r.recommendedAction,
    documents: ['cards', 'inventory', 'profiles', 'cardAdmin'].map((c) => `${c}/${r.id}`).filter((p) => flatDb[p] !== undefined),
    fingerprint: fingerprint(r),
  }));
  const review = results.filter((r) => r.safeToDelete === SAFE.REVIEW);
  return { runId, generatedAt: new Date().toISOString(), summary, results, candidates, review, planAudit: planAudit(flatDb) };
}

/** Cards whose plan is missing or unrecognised, with evidence and exact permission impact. */
export function planAudit(flatDb) {
  const controls = mergeFeatureControls(flatDb['platform/publicSettings']?.featureControls || {}, defaultFeatureControls(FEATURE_KEYS, { basicDefaults: BASIC_FEATURE_DEFAULTS, businessOnly: BUSINESS_ONLY_FEATURES }));
  const nfcCfg = flatDb['platform/nfcDeviceSettings'] || {};
  const devicesByCard = {};
  for (const [k, d] of Object.entries(flatDb)) if (k.startsWith('nfcDevices/') && d?.cardId) (devicesByCard[d.cardId] ||= []).push({ id: k.split('/')[1], type: d.deviceType || 'card', status: d.status || d.lifecycleStatus || null });
  const rows = [];
  for (const [k, card] of Object.entries(flatDb)) {
    if (!k.startsWith('cards/') || k.split('/').length !== 2) continue;
    const id = k.split('/')[1]; const r = resolveEffectivePlan(card);
    if (!r.legacyFallback) continue;
    const overrides = card.featureOverrides || {};
    // before: dashboard + Cloud Functions resolved these cards as Basic; public card + editor as Premium
    const oldServer = card.complimentaryBusiness === true ? 'Business' : card.complimentaryPremium === true ? 'Premium' : 'Basic';
    const diff = FEATURE_KEYS.filter((key) => resolveFeature({ controls, plan: oldServer, overrides, key, basicDefaults: BASIC_FEATURE_DEFAULTS }) !== resolveFeature({ controls, plan: r.plan, overrides, key, basicDefaults: BASIC_FEATURE_DEFAULTS }));
    const devices = devicesByCard[id] || [];
    const nfcImpact = devices.filter((d) => (nfcCfg[oldServer]?.[d.type] === false) !== (nfcCfg[r.plan]?.[d.type] === false)).map((d) => ({ ...d, before: nfcCfg[oldServer]?.[d.type] !== false, after: nfcCfg[r.plan]?.[d.type] !== false }));
    rows.push({
      id, status: card.status || null, rawPlan: r.rawPlan, source: r.baseSource, complimentary: r.complimentary,
      hints: { inventoryPlan: flatDb[`inventory/${id}`]?.plan ?? null, cardAdminPlan: flatDb[`cardAdmin/${id}`]?.plan ?? null, complimentaryBasePlan: card.complimentaryBasePlan ?? null, accountPlan: Object.entries(flatDb).find(([p, a]) => p.startsWith('accounts/') && (a?.primaryCardId === id || (Array.isArray(a?.cardIds) && a.cardIds.includes(id))))?.[1]?.plan ?? null },
      before: { publicCard: r.complimentary || 'Premium', editor: r.complimentary || 'Premium', dashboard: oldServer, cloudFunctions: oldServer },
      after: { everywhere: r.plan },
      dashboardAndServerFeatureChanges: diff,
      serverGatedChanges: diff.filter((x) => SERVER_GATED.includes(x)),
      nfcImpact,
      recommendation: nfcImpact.length ? 'SET PLAN EXPLICITLY BEFORE deploying Cloud Functions (an NFC device would change behaviour)' : diff.some((x) => SERVER_GATED.includes(x)) ? 'review: server-gated feature changes' : 'no action needed (public behaviour unchanged)',
    });
  }
  return { count: rows.length, missing: rows.filter((x) => x.source === 'missing').length, invalid: rows.filter((x) => x.source === 'invalid').length, nfcTypes: NFC_TYPES, rows };
}

/**
 * EXECUTE stage re-validation: returns the list of candidates that are STILL identical and
 * still YES in a FRESH audit; throws (abort everything) if any candidate changed.
 */
export function revalidate(previousCandidates, freshAudit) {
  const fresh = new Map(freshAudit.results.map((r) => [r.id, r]));
  const problems = [];
  for (const c of previousCandidates) {
    const now = fresh.get(c.id);
    if (!now) { problems.push(`${c.id}: no longer exists`); continue; }
    if (now.safeToDelete !== SAFE.YES) problems.push(`${c.id}: now ${now.safeToDelete} (${now.category})`);
    else if (fingerprint(now) !== c.fingerprint) problems.push(`${c.id}: references or state changed since the dry run`);
  }
  if (problems.length) { const e = new Error(`ABORTED — nothing was written:\n  ${problems.join('\n  ')}`); e.problems = problems; throw e; }
  return previousCandidates;
}

/** Integrity: no active count may go down after an EXECUTE step. */
export const PROTECTED_COUNTS = ['activeClients', 'activatedCards', 'profilesWithClientData', 'accounts', 'identityProfiles', 'nfcDevices', 'usedActivationCodes', 'walletObjects', 'inventoryInStock', 'inventoryPending'];
export function compareIntegrity(before, after) {
  return PROTECTED_COUNTS.filter((k) => (after[k] ?? 0) < (before[k] ?? 0)).map((k) => `${k}: ${before[k]} → ${after[k]}`);
}

export function markdownReport(audit) {
  const t = audit.summary.table.map((r) => `| ${r.category} | ${r.count} | ${r.safeToDelete === 'YES' ? 'YES, after validation' : r.safeToDelete === 'REVIEW' ? 'REVIEW REQUIRED' : 'NO'} | ${r.reason} |`).join('\n');
  const i = audit.summary.integrity;
  return `# Inventory audit ${audit.runId}\n\nGenerated ${audit.generatedAt}. READ-ONLY: nothing was changed.\n\n| STATUS | COUNT | SAFE TO DELETE? | REASON |\n|---|---|---|---|\n${t}\n\nDelete candidates: **${audit.candidates.length}** · Review required: **${audit.review.length}**\n\n## Integrity counts\n\n${Object.entries(i).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n## Cards without a valid plan: ${audit.planAudit.count} (missing ${audit.planAudit.missing}, unrecognised ${audit.planAudit.invalid})\n\n${audit.planAudit.rows.map((r) => `- ${r.id} (${r.source}${r.rawPlan ? ` "${r.rawPlan}"` : ''}) → ${r.after.everywhere}; dashboard/server feature changes: ${r.dashboardAndServerFeatureChanges.join(', ') || 'none'}; NFC impact: ${r.nfcImpact.length}; ${r.recommendation}`).join('\n')}\n`;
}
