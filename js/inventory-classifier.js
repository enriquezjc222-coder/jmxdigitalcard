/**
 * inventory-classifier.js — pure, read-only classification of card / inventory records.
 * Shared by the platform dashboard (delete / regenerate guard) and the offline audit tool
 * (tools/inventory-audit). It never writes anything.
 *
 * Principle: "not activated" does NOT mean "garbage". Available, in-stock, sold, reserved,
 * programmed (a physical NFC tag carries the URL) or pending cards are VALID inventory.
 * Only records that can never be used and have no reference at all are delete candidates;
 * anything uncertain is REVIEW REQUIRED.
 */
export const PROTECTED_IDS = Object.freeze(['BOSS', 'main']);
export const SAFE = Object.freeze({ YES: 'YES', NO: 'NO', REVIEW: 'REVIEW' });

const CLIENT_FIELDS = ['fullName', 'email', 'phone', 'phoneRaw', 'phone2', 'whatsapp', 'website', 'company', 'position', 'description', 'facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'youtube', 'customBusinessUrl', 'videoUrl', 'catalog', 'profileImage', 'logoImage', 'coverImage'];
const PROGRAMMED = new Set(['programmed', 'delivered', 'encoded', 'verified']);

export function canonicalCardId(v) {
  const raw = String(v ?? 'main').trim();
  if (raw.toLowerCase() === 'main') return 'main';
  return raw.toUpperCase().replace(/[^A-Z0-9_-]/g, '-').slice(0, 64) || 'main';
}
export function publicCardUrl(id) {
  return id === 'main' ? 'https://jmxdigitalcard.com/' : `https://jmxdigitalcard.com/c/${encodeURIComponent(id)}`;
}
/** True when a profile document holds real client data (not a blank inventory profile). */
export function profileHasClientData(profile) {
  if (!profile || typeof profile !== 'object') return false;
  if (CLIENT_FIELDS.some((k) => typeof profile[k] === 'string' && profile[k].trim() !== '')) return true;
  if (profile.media && typeof profile.media === 'object' && Object.keys(profile.media).length) return true;
  if (Array.isArray(profile.galleryImages) && profile.galleryImages.length) return true;
  return ['accountId', 'identityProfileId', 'ownerUid'].some((k) => typeof profile[k] === 'string' && profile[k]);
}

/**
 * @param {object} b bundle for one card id:
 *   { id, card, inventory, profile, admin, owner, claim,
 *     nfcDevices:[], nfcBatches:[], accounts:[], identityProfiles:[],
 *     counts:{ leads, contacts, aiScannerHistory, releases, monthlyStats, dailyStats, media, storageFiles, nfcEvents, identityAuditLogs, aiScannerTotals, ownerActivity },
 *     stats }
 * @returns {{id,url,category,safeToDelete,confidence,reasons:string[],references:string[],blockers:string[],recommendedAction:string,status:string|null,inventoryStatus:string|null,activationCode:string|null,deviceIds:string[],owner:string|null,account:string|null,profile:string}}
 */
export function classifyCard(b) {
  const id = b.id; const card = b.card || null; const inv = b.inventory || null;
  const c = b.counts || {};
  const refs = []; const blockers = [];
  const add = (label, blocking = true) => { refs.push(label); if (blocking) blockers.push(label); };
  const status = card?.status ?? null; const invStatus = inv?.status ?? null;

  if (b.owner) add(`cardOwners/${id} (ownerUid ${b.owner.ownerUid || '?'})`);
  if (b.claim) add(`cardClaims/${id} (activation code used)`);
  for (const d of b.nfcDevices || []) add(`nfcDevices/${d.id} (status ${d.status || d.lifecycleStatus || '?'})`);
  for (const bt of b.nfcBatches || []) add(`nfcBatches/${bt.id} (status ${bt.status || '?'}, code ${bt.activationCodeStatus || '?'})`);
  for (const a of b.accounts || []) add(`accounts/${a.id}`);
  for (const p of b.identityProfiles || []) add(`identityProfiles/${p.id}`);
  if (card?.accountId) add(`cards.accountId ${card.accountId}`);
  if (card?.identityProfileId) add(`cards.identityProfileId ${card.identityProfileId}`);
  if (card?.googleWalletObjectId) add(`Google Wallet object ${card.googleWalletObjectId}`);
  if (card?.activatedAt) add('cards.activatedAt set');
  if (card?.qrBusinessLogo) add('cards.qrBusinessLogo (admin business logo)');
  for (const [k, label] of [['leads', 'leads'], ['contacts', 'contacts'], ['aiScannerHistory', 'aiScannerHistory'], ['aiScannerTotals', 'aiScannerTotals'], ['releases', 'cardHistory releases (previously used card)'], ['monthlyStats', 'monthlyStats'], ['dailyStats', 'dailyStats'], ['media', 'cards/{id}/media docs'], ['storageFiles', 'Storage files under cards/{id}/'], ['nfcEvents', 'nfcDeviceEvents'], ['identityAuditLogs', 'identityAuditLogs'], ['ownerActivity', 'ownerActivity']]) {
    if (c[k] > 0) add(`${label}: ${c[k]}`);
  }
  const views = Number(b.stats?.views || 0) + Object.values(b.stats?.actions || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  if (views > 0) add(`cardStats (${views} views/actions)`);
  if (profileHasClientData(b.profile)) add(`profiles/${id} contains client data`);
  if (typeof b.admin?.clientName === 'string' && b.admin.clientName.trim() && b.admin.clientName !== id) add(`cardAdmin.clientName "${b.admin.clientName.slice(0, 40)}"`);
  // soft references: not blocking by themselves, but a YES becomes REVIEW REQUIRED
  const soft = [];
  if (typeof b.admin?.notes === 'string' && b.admin.notes.trim()) soft.push(`cardAdmin.notes "${b.admin.notes.trim().slice(0, 40)}"`);
  if (b.stats && views === 0) soft.push('cardStats document (0 views)');
  refs.push(...soft);
  const programmed = PROGRAMMED.has(String(card?.nfcStatus || inv?.nfcStatus || b.admin?.nfcStatus || '').toLowerCase());
  if (programmed) add(`physical tag programmed (nfcStatus ${card?.nfcStatus || inv?.nfcStatus || b.admin?.nfcStatus})`);

  const out = (category, safeToDelete0, confidence0, reasons0, recommendedAction0) => {
    const downgrade = safeToDelete0 === SAFE.YES && soft.length > 0;
    const safeToDelete = downgrade ? SAFE.REVIEW : safeToDelete0;
    const confidence = downgrade ? 'low' : confidence0;
    const reasons = downgrade ? [...reasons0, `REVIEW: ${soft.join('; ')}`] : reasons0;
    const recommendedAction = downgrade ? 'review manually' : recommendedAction0;
    return {
    id, url: publicCardUrl(id), category, safeToDelete, confidence, reasons, references: refs, blockers,
    recommendedAction, status, inventoryStatus: invStatus,
    activationCode: inv?.activationCode ? `${String(inv.activationCode).slice(0, 2)}…(${String(inv.activationCode).length})` : null,
    deviceIds: (b.nfcDevices || []).map((d) => d.id), owner: b.owner?.ownerUid || null,
    account: card?.accountId || b.owner?.accountId || null,
    profile: !b.profile ? 'none' : profileHasClientData(b.profile) ? 'client data' : 'blank',
    recordType: card?.recordType || inv?.recordType || null,
  }; };

  if (PROTECTED_IDS.includes(id)) return out('PROTECTED', SAFE.NO, 'high', ['Protected ID (never deleted).'], 'keep');
  const st = String(status || '').toLowerCase();
  if (b.owner || b.claim || ['activated', 'active'].includes(st) || card?.activatedAt) return out(b.owner || ['activated', 'active'].includes(st) ? 'ACTIVE' : 'ASSIGNED', SAFE.NO, 'high', ['Card has an owner, a used activation code or is activated.'], 'keep');
  if (['suspended', 'paused'].includes(st) || ['suspended', 'archived'].includes(String(card?.profileStatus || '').toLowerCase())) return out('SUSPENDED', SAFE.NO, 'high', ['Suspended/archived client card — the client still exists.'], 'keep');
  if (st === 'sold') return out('SOLD_PENDING_ACTIVATION', SAFE.NO, 'high', ['Sold, waiting for the client to activate.'], 'keep');
  if ((b.nfcDevices || []).length || (b.nfcBatches || []).length) return out('ASSIGNED_NFC', SAFE.NO, 'high', ['An NFC device or batch (reserved / pending / active) points to this card.'], 'keep');
  if (blockers.length === 1 && programmed && (st === 'available' || (!st && invStatus === 'available'))) return out('IN_STOCK_PROGRAMMED', SAFE.NO, 'high', ['Valid inventory: a physical NFC tag already carries this URL.'], 'keep');
  if (blockers.length) return out('HAS_REFERENCES', SAFE.NO, 'high', ['Referenced by data that must be preserved (history, analytics, identity, wallet, client data or physical tag).'], 'keep');

  const canonical = canonicalCardId(id) === id;
  if (!card && !inv) {
    // only fragments (blank profile / cardAdmin stub) remain: no public URL can use them
    if (!canonical) return out('UNREACHABLE_FRAGMENT', SAFE.YES, 'high', ['No card and no inventory document; the ID is not a valid public Card ID; no references.'], 'archive, then delete after review');
    return out('ORPHAN_FRAGMENT', SAFE.YES, 'high', ['Only blank profile/cardAdmin stub documents remain (no card, no inventory, no owner, no references). /c/{id} already shows "not found".'], 'archive, then delete after review');
  }
  if (!canonical) {
    // e.g. a lower-case duplicate: /c/abc is served from ABC, so this record can never be reached or activated
    return out('UNREACHABLE_ID', SAFE.YES, 'medium', [`ID "${id}" is never reached by a public URL (public ID would be "${canonicalCardId(id)}"); not programmed; no references.`], 'archive, then delete after review');
  }
  if (!card && inv) return out('ORPHANED_INVENTORY', SAFE.REVIEW, 'low', ['Inventory document without a card document (e.g. left after an NFC return). /c/{id} cannot be activated in this state; it may still correspond to physical stock.'], 'review with the physical stock');
  if (st === 'available' || (!st && invStatus === 'available')) return out('IN_STOCK', SAFE.NO, 'high', ['Valid inventory: available to sell / activate.'], 'keep');
  return out('UNKNOWN_STATE', SAFE.REVIEW, 'low', [`Unrecognised status "${status}" / inventory "${invStatus}".`], 'review');
}

/** Build per-id bundles from a flat document map {"collection/id[/sub/id]": data}. */
export function bundlesFromFlatDb(db, { storageFiles = {} } = {}) {
  const ids = new Set(); const get = (p) => db[p];
  const top = (col) => Object.keys(db).filter((k) => k.startsWith(`${col}/`) && k.split('/').length === 2).map((k) => k.split('/')[1]);
  for (const col of ['cards', 'inventory', 'profiles', 'cardAdmin', 'cardOwners', 'cardClaims']) top(col).forEach((i) => ids.add(i));
  const byField = (col, pred) => top(col).map((i) => ({ id: i, ...get(`${col}/${i}`) })).filter(pred);
  const countUnder = (prefix) => Object.keys(db).filter((k) => k.startsWith(prefix)).length;
  const countWhere = (col, id) => top(col).filter((i) => get(`${col}/${i}`)?.cardId === id).length;
  const devices = byField('nfcDevices', () => true); const batches = byField('nfcBatches', () => true);
  const events = byField('nfcDeviceEvents', () => true); const accounts = byField('accounts', () => true);
  const idps = byField('identityProfiles', () => true); const audits = byField('identityAuditLogs', () => true);
  const bundles = [];
  for (const id of [...ids].sort()) {
    bundles.push({
      id, card: get(`cards/${id}`) || null, inventory: get(`inventory/${id}`) || null, profile: get(`profiles/${id}`) || null,
      admin: get(`cardAdmin/${id}`) || null, owner: get(`cardOwners/${id}`) || null, claim: get(`cardClaims/${id}`) || null,
      stats: get(`cardStats/${id}`) || null,
      nfcDevices: devices.filter((d) => d.cardId === id), nfcBatches: batches.filter((d) => d.cardId === id),
      accounts: accounts.filter((a) => a.primaryCardId === id || (Array.isArray(a.cardIds) && a.cardIds.includes(id))),
      identityProfiles: idps.filter((p) => p.primaryCardId === id),
      counts: {
        leads: countUnder(`leads/${id}/items/`), contacts: countUnder(`contacts/${id}/items/`), aiScannerHistory: countUnder(`aiScannerHistory/${id}/items/`),
        aiScannerTotals: get(`aiScannerTotals/${id}`) ? 1 : 0, releases: countUnder(`cardHistory/${id}/releases/`),
        monthlyStats: countWhere('monthlyStats', id), dailyStats: countWhere('dailyStats', id), media: countUnder(`cards/${id}/media/`),
        storageFiles: Number(storageFiles[id] || 0), nfcEvents: events.filter((e) => e.cardId === id || e.previousCardId === id).length,
        identityAuditLogs: audits.filter((e) => e.cardId === id).length, ownerActivity: get(`ownerActivity/${id}`) ? 1 : 0,
      },
    });
  }
  return bundles;
}

/** Summary table + integrity counts. */
export function summarize(results, db = {}) {
  const byCategory = {};
  for (const r of results) {
    const k = `${r.category}|${r.safeToDelete}`; byCategory[k] ||= { category: r.category, count: 0, safeToDelete: r.safeToDelete, reason: r.reasons[0] };
    byCategory[k].count++;
  }
  const top = (col) => Object.keys(db).filter((k) => k.startsWith(`${col}/`) && k.split('/').length === 2);
  const integrity = {
    activeClients: results.filter((r) => r.category === 'ACTIVE').length,
    activatedCards: top('cards').filter((k) => ['activated', 'active'].includes(String(db[k]?.status || '').toLowerCase())).length,
    profiles: top('profiles').length, accounts: top('accounts').length, identityProfiles: top('identityProfiles').length,
    nfcDevices: top('nfcDevices').length, usedActivationCodes: top('cardClaims').length + top('nfcBatches').filter((k) => db[k]?.activationCodeStatus === 'used').length,
    walletObjects: top('cards').filter((k) => db[k]?.googleWalletObjectId).length,
    inventoryInStock: results.filter((r) => r.category === 'IN_STOCK').length,
    inventoryPending: results.filter((r) => ['SOLD_PENDING_ACTIVATION', 'ASSIGNED_NFC', 'ASSIGNED'].includes(r.category)).length,
    inventoryNotActivated: results.filter((r) => !['ACTIVE', 'SUSPENDED', 'PROTECTED'].includes(r.category)).length,
  };
  return { table: Object.values(byCategory).sort((a, b) => a.category.localeCompare(b.category)), integrity, totals: { records: results.length, yes: results.filter((r) => r.safeToDelete === 'YES').length, review: results.filter((r) => r.safeToDelete === 'REVIEW').length, no: results.filter((r) => r.safeToDelete === 'NO').length } };
}
