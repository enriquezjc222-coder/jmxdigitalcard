// Existing-production-like data (fictional people) for the integrated tests.
// Shape follows docs/identity-architecture/DATA-MAP.md and the fields the pages read.
export const ADMIN_UID = 'ADMIN_UID_JMX';
export const LONG_ID = 'JMXLONGCARD-2026-IDENTIFIER-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
const ts = (iso) => ({ __ts: Date.parse(iso) });

function card(id, o) {
  return {
    [`cards/${id}`]: { cardId: id, status: 'activated', plan: 'Basic', accountId: `ACC-${id}`, identityProfileId: `IDP-${id}`, ownerUid: `OWNER_${id}`, requiresActivationCode: true, featureOverrides: {}, nfcStatus: 'programmed', activatedAt: ts('2026-07-01T12:00:00Z'), createdAt: ts('2026-06-20T12:00:00Z'), ...o.card },
    [`profiles/${id}`]: o.profile === null ? undefined : { fullName: o.name, company: o.company || '', position: o.position || 'Owner', phone: '(555) 010-0000', phoneRaw: '5550100000', email: `${id.toLowerCase()}@example.com`, theme: 'gold', qrDarkColor: '#111111', qrLightColor: '#ffffff', mediaStorageVersion: 2, media: {}, visibility: {}, ...o.profile },
    [`cardOwners/${id}`]: { ownerUid: `OWNER_${id}`, cardId: id, ownerEmail: `${id.toLowerCase()}@example.com` },
    [`inventory/${id}`]: { cardId: id, activationCode: `ACT${id.slice(-3)}X`, status: o.card?.status === 'available' ? 'available' : 'claimed', createdAt: ts('2026-06-20T12:00:00Z') },
    [`cardAdmin/${id}`]: { clientName: o.name, physicalType: 'PVC' },
    [`accounts/ACC-${id}`]: { accountId: `ACC-${id}`, cardIds: [id], primaryCardId: id, plan: o.card?.plan || 'Basic', accountStatus: 'active' },
    [`users/OWNER_${id}`]: { uid: `OWNER_${id}`, accountId: `ACC-${id}` },
  };
}

function stock(id, o) {
  return {
    [`cards/${id}`]: { status: o.status || 'available', plan: 'Basic', recordType: 'public_url', inventoryVersion: 2, requiresActivationCode: true, nfcStatus: o.nfcStatus || 'not-programmed', complimentaryPremium: false, complimentaryBusiness: false, createdAt: ts('2026-08-01T12:00:00Z') },
    [`inventory/${id}`]: { activationCode: `ACT${id}`, inventoryVersion: 2, recordType: 'public_url', status: 'available', plan: 'Basic', nfcStatus: o.nfcStatus || 'not-programmed', physicalType: 'PVC' },
    [`profiles/${id}`]: { fullName: '', company: '', email: '', phone: '', media: {}, visibility: {} },
    [`cardAdmin/${id}`]: { physicalType: 'PVC', nfcStatus: o.nfcStatus || 'not-programmed' },
  };
}

export function buildFixtures() {
  const db = {
    'platform/config': { adminUid: ADMIN_UID, adminEmail: 'owner@jmxdigitalcard.com' },
    // Stored controls from BEFORE this change: no businessLogoQr key yet (existing production data).
    'platform/publicSettings': { featureControls: { enabled: true, global: {}, Basic: { customQR: false, qrDownload: false }, Premium: { customQR: false }, Business: { customQR: true, qrDownload: true } }, business: {} },
    ...card('JMXB01', { name: 'Brenda Basic', company: 'Basic Plumbing', card: { plan: 'Basic' } }),
    ...card('JMXB06', { name: 'Bruno Basic Override', company: 'Override Co', card: { plan: 'Basic', featureOverrides: { customQR: true } }, profile: { qrDarkColor: '#D9889E' } }),
    ...card('JMXP02', { name: 'Paula Premium', company: 'Premium Realty', card: { plan: 'Premium', featureOverrides: { customQR: true } }, profile: { qrDarkColor: '#D9889E', qrCardTheme: 'rose_gold' } }),
    ...card('JMXP07', { name: 'Pedro Premium', company: 'Premium Default', card: { plan: 'Premium' }, profile: { qrDarkColor: '#C2410C' } }),
    ...card('JMXZ03', { name: 'Zoe Business', company: 'ABC Remodeling', card: { plan: 'Business' }, profile: { qrDarkColor: '#C2410C', qrCardTheme: 'orange_titanium' } }),
    ...card('JMXZ04', { name: 'Zack Business', company: 'Blue Builders', card: { plan: 'Business' }, profile: { qrDarkColor: '#1D4ED8' } }),
    ...card('JMXC05', { name: 'Carla Complimentary', company: 'Gift Business', card: { plan: 'Basic', complimentaryBusiness: true }, profile: { qrDarkColor: '#000000' } }),
    ...card('JMXZ08', { name: 'Unreadable Colours', company: 'Low Contrast LLC', card: { plan: 'Business' }, profile: { qrDarkColor: '#FAFAFA', qrLightColor: '#FFFFFF' } }),
    ...card(LONG_ID, { name: 'Long Identifier', company: 'Long URL Co', card: { plan: 'Business' }, profile: { qrDarkColor: '#6D28D9' } }),
    // "New client": card just activated by the current flows, no profile document yet.
    ...card('NEW777', { name: 'New Client', card: { plan: 'Premium', activatedAt: ts('2026-09-22T12:00:00Z') }, profile: null }),
    // Inventory card not yet claimed: /c/ must keep showing the activation screen.
    ...card('AVAIL9', { name: 'Unclaimed', card: { status: 'available', plan: 'Basic', ownerUid: null } }),
    // ---- inventory-audit fixtures (fictional) ------------------------------------------
    ...stock('STOCK01', {}),                                                     // valid unused stock
    ...stock('STOCK02', { nfcStatus: 'programmed' }),                            // physical tag carries the URL
    ...stock('SOLD03', { status: 'sold' }),                                      // sold, pending activation
    ...stock('RESV04', {}),                                                      // reserved by an NFC batch (below)
    'nfcBatches/BATCH-RESV': { batchId: 'BATCH-RESV', cardId: 'RESV04', status: 'pending', activationCodeStatus: 'unused', quantity: 1 },
    ...stock('REL05', {}),                                                       // released for reuse (has history)
    'cardHistory/REL05/releases/1760000000000': { cardId: 'REL05', previousStatus: 'activated' },
    'profiles/ORPH06': { identityUpdatedAt: ts('2026-09-01T00:00:00Z') },         // stub left by the detach trigger
    'cardAdmin/ORPH06': { identityUpdatedAt: ts('2026-09-01T00:00:00Z') },
    ...stock('stock7', {}),                                                      // lower-case duplicate: never reachable (/c/stock7 → STOCK7)
    'inventory/INV08': { activationCode: 'ACTINV08', status: 'available', recordType: 'nfc_id', plan: 'Basic' }, // inventory without card
    ...card('LEG09', { name: 'Lena Legacy', company: 'Legacy Plan Co', card: { plan: undefined }, profile: { website: 'https://legacy.example', instagram: 'legacyco' } }), // activated, NO plan field
    ...card('LEG10', { name: 'Gil Gold', company: 'Unrecognised Plan', card: { plan: 'gold' } }),     // activated, unrecognised plan
    'profiles/ORPH12': {}, 'cardAdmin/ORPH12': { notes: 'box 3 — check' },        // fragment with admin notes → review
    'nfcDevices/NFC-TEST-0001': { deviceId: 'NFC-TEST-0001', cardId: 'JMXB01', deviceType: 'card', status: 'active', material: 'PVC', batchId: 'BATCH-1' },
    'nfcDevicePublic/NFC-TEST-0001': { deviceId: 'NFC-TEST-0001', status: 'active' },
    'nfcDevices/NFC-TEST-0002': { deviceId: 'NFC-TEST-0002', cardId: 'JMXZ03', deviceType: 'card', status: 'active', material: 'Metal', batchId: 'BATCH-1' },
  };
  for (const k of Object.keys(db)) if (db[k] === undefined) delete db[k];
  for (const v of Object.values(db)) if (v && typeof v === 'object') for (const f of Object.keys(v)) if (v[f] === undefined) delete v[f];
  return db;
}
