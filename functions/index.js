const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {initializeApp, getApp} = require("firebase-admin/app");
const {defineSecret} = require("firebase-functions/params");
const {GoogleAuth} = require("google-auth-library");
const jwt = require("jsonwebtoken");
const {getFirestore, Timestamp, FieldValue} = require("firebase-admin/firestore");
const {getStorage} = require("firebase-admin/storage");

initializeApp();
const db = getFirestore();
const GOOGLE_WALLET_SERVICE_ACCOUNT = defineSecret("GOOGLE_WALLET_SERVICE_ACCOUNT");
const WALLET_ISSUER_ID = "3388000000023177664";
const WALLET_CLASS_ID = `${WALLET_ISSUER_ID}.jmx_digital_card`;
const WALLET_ORIGIN = "https://jmxdigitalcard.com";
const WALLET_IMAGE_URL = `${WALLET_ORIGIN}/google-wallet-jmx.jpg`;

const BASIC_FEATURE_DEFAULTS = new Set(["description","saveContact","quickActions","phone","whatsapp","email","location","facebook","qr"]);
const DEFAULT_SCANNER_CONFIG = {
  externalServicesAllowed: false,
  ocrProvider: "googleVision",
  aiParsingProvider: "basic",
  limits: {
    Basic: {mode: "disabled", count: 0},
    Premium: {mode: "disabled", count: 0},
    Business: {mode: "disabled", count: 0}
  }
};
const MONTH_RE = /^\d{4}-\d{2}$/;

function normalizePlan(card = {}) {
  if (card.complimentaryBusiness === true) return "Business";
  if (card.complimentaryPremium === true) return "Premium";
  return ["Basic", "Premium", "Business"].includes(card.plan) ? card.plan : "Basic";
}
function safeString(value, max = 500) { return String(value ?? "").trim().slice(0, max); }
function norm(value) { return safeString(value, 300).toLowerCase().replace(/\s+/g, " "); }
function currentMonth() { return new Date().toISOString().slice(0, 7); }
function sanitizeCardId(value) {
  const raw = safeString(value, 64);
  if (raw.toLowerCase() === "main") return "main";
  return raw.toUpperCase().replace(/[^A-Z0-9_-]/g, "-").slice(0, 64) || "main";
}
function defaultFeatureControls() {
  const keys = ["description","saveContact","quickActions","phone","phone2","whatsapp","email","website","location","facebook","instagram","linkedin","twitter","tiktok","youtube","services","gallery","video","qr","customQR","qrDownload","finalCTA","businessLinks","catalog","customBusiness","analytics","advancedAnalytics","quickCapture","leads","contactNotes","meetingNotes","followUp","csvExport","vcfDownload","contactMap","aiScanner","autoIntroEmail","appleWallet","googleWallet","googleWalletThemes","qrCardThemes","brandingRemoval","advancedNetworkingInsights"];
  const businessOnly = new Set(["customQR","qrDownload","advancedAnalytics","quickCapture","leads","contactNotes","meetingNotes","followUp","csvExport","vcfDownload","contactMap","aiScanner","autoIntroEmail","appleWallet","googleWallet","googleWalletThemes","qrCardThemes","brandingRemoval","advancedNetworkingInsights"]);
  const global = {}, Basic = {}, Premium = {}, Business = {};
  keys.forEach((k) => { global[k] = true; Basic[k] = BASIC_FEATURE_DEFAULTS.has(k); Premium[k] = !businessOnly.has(k); Business[k] = true; });
  return {enabled: true, global, Basic, Premium, Business};
}
function mergeFeatureControls(raw = {}) {
  const d = defaultFeatureControls();
  return {enabled: raw.enabled !== false, global: {...d.global, ...(raw.global || {})}, Basic: {...d.Basic, ...(raw.Basic || {})}, Premium: {...d.Premium, ...(raw.Premium || {})}, Business: {...d.Business, ...(raw.Business || {})}};
}
function featureAllows(card, publicSettings, key) {
  const controls = mergeFeatureControls(publicSettings?.featureControls || {});
  const plan = normalizePlan(card);
  // GLOBAL -> PLAN -> CLIENT. A per-client value may restrict access but never
  // bypass a platform-level or plan-level OFF setting.
  if (controls.enabled === false) {
    const baseAllowed = plan === "Business" || (plan === "Premium" && !new Set(["quickCapture","leads","advancedAnalytics"]).has(key)) || BASIC_FEATURE_DEFAULTS.has(key);
    return baseAllowed && card?.featureOverrides?.[key] !== false;
  }
  if (controls.global?.[key] === false) return false;
  const bucket = plan === "Basic" ? controls.Basic : plan === "Business" ? controls.Business : controls.Premium;
  return bucket?.[key] !== false && card?.featureOverrides?.[key] !== false;
}
async function isPlatformAdmin(uid) {
  const cfg = await db.doc("platform/config").get();
  return cfg.exists && cfg.data().adminUid === uid;
}
async function cardOwnerMatches(cardId, uid) {
  const owner = await db.doc(`cardOwners/${cardId}`).get();
  return owner.exists && owner.data().ownerUid === uid;
}
async function authorizeCard(request, cardId, {allowAdmin = true} = {}) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in to use AI Card Scanner.");
  const [cardSnap, settingsSnap, scannerSnap] = await Promise.all([
    db.doc(`cards/${cardId}`).get(),
    db.doc("platform/publicSettings").get(),
    db.doc("platform/aiScanner").get()
  ]);
  if (!cardSnap.exists) throw new HttpsError("not-found", "Card not found.");
  const admin = allowAdmin && await isPlatformAdmin(request.auth.uid);
  const owner = await cardOwnerMatches(cardId, request.auth.uid);
  if (!admin && !owner) throw new HttpsError("permission-denied", "This account cannot scan for this card.");
  const card = cardSnap.data();
  const publicSettings = settingsSnap.exists ? settingsSnap.data() : {};
  if (!featureAllows(card, publicSettings, "aiScanner") && !admin) throw new HttpsError("permission-denied", "AI Card Scanner is disabled for this card.");
  const scannerConfig = {...DEFAULT_SCANNER_CONFIG, ...(scannerSnap.exists ? scannerSnap.data() : {})};
  scannerConfig.limits = {...DEFAULT_SCANNER_CONFIG.limits, ...(scannerConfig.limits || {})};
  return {card, publicSettings, scannerConfig, admin, owner, plan: normalizePlan(card)};
}
function resolvedLimit(card, config, plan) {
  const custom = card?.aiScannerMonthlyLimit;
  if (custom && typeof custom === "object" && ["number","unlimited","disabled"].includes(custom.mode)) return custom;
  const planLimit = config?.limits?.[plan];
  if (planLimit && typeof planLimit === "object") return planLimit;
  return {mode: "disabled", count: 0};
}
async function reserveScannerRequest(cardId, uid, plan, limit, testMode) {
  if (testMode) return {month: currentMonth(), countBefore: 0};
  const month = currentMonth();
  const cardRef = db.doc(`aiScannerUsage/${month}/cards/${cardId}`);
  const monthRef = db.doc(`aiScannerUsage/${month}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(cardRef);
    const data = snap.exists ? snap.data() : {};
    const now = Timestamp.now();
    const last = data.lastRequestAt?.toMillis?.() || 0;
    if (Date.now() - last < 4000) throw new HttpsError("resource-exhausted", "Please wait a few seconds before scanning another card.");
    const scans = Number(data.totalScans || 0);
    if (limit?.mode === "number" && Number(limit.count || 0) > 0 && scans >= Number(limit.count)) {
      throw new HttpsError("resource-exhausted", "Monthly AI Card Scanner limit reached.");
    }
    tx.set(cardRef, {cardId, plan, ownerUid: uid, totalScans: FieldValue.increment(1), ocrRequests: FieldValue.increment(1), lastRequestAt: now, updatedAt: now}, {merge: true});
    tx.set(monthRef, {month, totalScans: FieldValue.increment(1), ocrRequests: FieldValue.increment(1), planScans: {[plan]: FieldValue.increment(1)}, updatedAt: now}, {merge: true});
    tx.set(db.doc(`aiScannerTotals/${cardId}`), {cardId, plan, ownerUid: uid, totalScans: FieldValue.increment(1), ocrRequests: FieldValue.increment(1), lastRequestAt: now, updatedAt: now}, {merge: true});
    return {month, countBefore: scans};
  });
}
async function finalizeScannerUsage(cardId, month, result, testMode) {
  if (testMode) return;
  const success = result === "success";
  const fields = success ? {successfulScans: FieldValue.increment(1)} : {failedScans: FieldValue.increment(1)};
  await Promise.all([
    db.doc(`aiScannerUsage/${month}/cards/${cardId}`).set({...fields, updatedAt: Timestamp.now()}, {merge: true}),
    db.doc(`aiScannerUsage/${month}`).set({...fields, updatedAt: Timestamp.now()}, {merge: true}),
    db.doc(`aiScannerTotals/${cardId}`).set({...fields, updatedAt: Timestamp.now()}, {merge: true})
  ]);
}
async function googleVisionText(base64) {
  const token = await getApp().options.credential.getAccessToken();
  const response = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: {"Authorization": `Bearer ${token.access_token}`, "Content-Type": "application/json", "x-goog-user-project": process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "jmx-digital-card"},
    body: JSON.stringify({requests: [{image: {content: base64}, features: [{type: "DOCUMENT_TEXT_DETECTION", maxResults: 1}]}]})
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.responses?.[0]?.error) {
    const message = json?.responses?.[0]?.error?.message || json?.error?.message || `Vision OCR failed (${response.status}).`;
    throw new Error(message);
  }
  return safeString(json?.responses?.[0]?.fullTextAnnotation?.text || json?.responses?.[0]?.textAnnotations?.[0]?.description || "", 12000);
}
function uniqueMatches(text, regex) { return [...new Set((text.match(regex) || []).map((x) => x.trim()))]; }
function parseBusinessCardText(text) {
  const raw = safeString(text, 12000);
  const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 80);
  const emails = uniqueMatches(raw, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  const urls = uniqueMatches(raw, /(?:https?:\/\/|www\.)[^\s<>]+/gi).map((u) => u.replace(/[),.;]+$/, ""));
  const phones = uniqueMatches(raw, /(?:\+?1[\s.\-()]*)?(?:\(?\d{3}\)?[\s.\-]*)\d{3}[\s.\-]*\d{4}/g);
  const social = {linkedin: "", facebook: "", instagram: ""};
  urls.forEach((u) => {const l = u.toLowerCase(); if (l.includes("linkedin.com")) social.linkedin = u; else if (l.includes("facebook.com")) social.facebook = u; else if (l.includes("instagram.com")) social.instagram = u;});
  const website = urls.find((u) => !/linkedin|facebook|instagram/i.test(u)) || "";
  const companyLine = lines.find((l) => /\b(LLC|INC\.?|CORP\.?|CORPORATION|COMPANY|CO\.?|GROUP|CONSTRUCTION|REMODELING|SERVICES|SOLUTIONS|ENTERPRISES|ASSOCIATES)\b/i.test(l) && !/@/.test(l)) || "";
  const titleLine = lines.find((l) => /\b(owner|president|vice president|vp|director|manager|sales|engineer|designer|consultant|specialist|supervisor|founder|ceo|cfo|coo|agent|realtor|attorney|doctor|contractor|developer)\b/i.test(l) && l !== companyLine) || "";
  const addressLine = lines.find((l) => /\b\d{1,6}\s+.+\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|pkwy|parkway|hwy|highway)\b/i.test(l)) || "";
  const excluded = new Set([companyLine, titleLine, addressLine, ...emails, ...urls, ...phones]);
  const nameLine = lines.find((l) => !excluded.has(l) && !/@|www\.|https?:|\d{3}[\s).\-]/i.test(l) && /^[A-Za-zÀ-ÿ' .-]{3,80}$/.test(l) && l.split(/\s+/).length >= 2 && l.split(/\s+/).length <= 5) || "";
  const nameParts = nameLine.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
  const lower = raw.toLowerCase();
  const whatsapp = lower.includes("whatsapp") ? (phones[0] || "") : "";
  return {
    firstName, lastName, fullName: nameLine, company: companyLine, jobTitle: titleLine,
    mobilePhone: phones[0] || "", officePhone: phones[1] || "", additionalPhone: phones[2] || "",
    email: emails[0] || "", website, address: addressLine, city: "", state: "", zipCode: "",
    whatsapp, linkedin: social.linkedin, facebook: social.facebook, instagram: social.instagram, notes: "", rawText: raw
  };
}
async function findDuplicates(cardId, contact) {
  const matches = [];
  const email = safeString(contact.email, 160);
  const phone = safeString(contact.mobilePhone || contact.officePhone, 40);
  const seen = new Set();
  async function addQuery(base, field, value, type) {
    if (!value) return;
    const snap = await base.where(field, "==", value).limit(5).get();
    snap.docs.forEach((d) => {const key = `${type}:${d.id}`; if (!seen.has(key)) {seen.add(key); const v = d.data(); matches.push({type, id: d.id, name: v.name || v.fullName || "", company: v.company || "", email: v.email || "", phone: v.phone || v.mobilePhone || ""});}});
  }
  const contacts = db.collection(`contacts/${cardId}/items`);
  const leads = db.collection(`leads/${cardId}/items`);
  await Promise.all([addQuery(contacts, "email", email, "contact"), addQuery(leads, "email", email, "lead"), addQuery(contacts, "phone", phone, "contact"), addQuery(leads, "phone", phone, "lead")]);
  if (!matches.length && contact.fullName && contact.company) {
    const [cs, ls] = await Promise.all([contacts.limit(150).get(), leads.limit(150).get()]);
    [...cs.docs.map(d => ({d, type: "contact"})), ...ls.docs.map(d => ({d, type: "lead"}))].forEach(({d, type}) => {
      const v = d.data(); if (norm(v.name || v.fullName) === norm(contact.fullName) && norm(v.company) === norm(contact.company)) {
        const key = `${type}:${d.id}`; if (!seen.has(key)) {seen.add(key); matches.push({type, id: d.id, name: v.name || v.fullName || "", company: v.company || "", email: v.email || "", phone: v.phone || v.mobilePhone || ""});}
      }
    });
  }
  return matches.slice(0, 8);
}
function cleanContact(data = {}) {
  return {
    firstName: safeString(data.firstName, 80), lastName: safeString(data.lastName, 100), fullName: safeString(data.fullName, 140), company: safeString(data.company, 140), jobTitle: safeString(data.jobTitle, 120),
    mobilePhone: safeString(data.mobilePhone, 40), officePhone: safeString(data.officePhone, 40), additionalPhone: safeString(data.additionalPhone, 40), email: safeString(data.email, 180), website: safeString(data.website, 300),
    address: safeString(data.address, 250), city: safeString(data.city, 100), state: safeString(data.state, 80), zipCode: safeString(data.zipCode, 20), whatsapp: safeString(data.whatsapp, 40), linkedin: safeString(data.linkedin, 300), facebook: safeString(data.facebook, 300), instagram: safeString(data.instagram, 300), notes: safeString(data.notes, 1000),
    category: safeString(data.category, 40) || "Networking", whereMet: safeString(data.whereMet, 100), dateMet: safeString(data.dateMet, 20)
  };
}

exports.cleanupExpiredBusinessLeads = onSchedule({schedule: "every 60 minutes", timeZone: "America/Chicago"}, async () => {
  const expired = await db.collectionGroup("items").where("expiresAt", "<=", Timestamp.now()).limit(400).get();
  if (expired.empty) return;
  const batch = db.batch();
  expired.docs.forEach((snap) => {
    const parts = snap.ref.path.split("/");
    if (parts.length === 4 && parts[0] === "leads" && parts[2] === "items") batch.delete(snap.ref);
  });
  await batch.commit();
});

exports.purgeGalleryMedia = onCall({timeoutSeconds: 540, memory: "512MiB"}, async (request) => {
  if (!request.auth?.uid || !(await isPlatformAdmin(request.auth.uid))) throw new HttpsError("permission-denied", "JMX administrator access required.");
  const scope = safeString(request.data?.scope, 20);
  if (!["Global", "Basic", "Premium", "Business"].includes(scope)) throw new HttpsError("invalid-argument", "Invalid Gallery purge scope.");
  const dryRun = request.data?.dryRun !== false;
  if (!dryRun && request.data?.confirmation !== "PURGE_GALLERY_MEDIA") throw new HttpsError("failed-precondition", "Explicit Gallery purge confirmation is required.");

  const cardsSnap = await db.collection("cards").get();
  const targets = cardsSnap.docs.filter((cardSnap) => scope === "Global" || normalizePlan(cardSnap.data()) === scope);
  const bucket = getStorage().bucket();
  let cardsAffected = 0, storageObjects = 0, storageObjectsDeleted = 0, legacyMediaDocs = 0;

  for (const cardSnap of targets) {
    const cardId = cardSnap.id;
    const profileRef = db.doc(`profiles/${cardId}`);
    const profileSnap = await profileRef.get();
    const profileData = profileSnap.exists ? profileSnap.data() : {};
    const cardData = cardSnap.data() || {};
    const manifests = [profileData.media, cardData.media].filter((m) => m && typeof m === "object");
    const paths = new Set();
    manifests.forEach((manifest) => Object.entries(manifest).forEach(([key, entry]) => {
      if (key.startsWith("gallery-") && entry?.storagePath) paths.add(String(entry.storagePath));
    }));
    const legacySnap = await db.collection(`cards/${cardId}/media`).get();
    const legacyGalleryDocs = legacySnap.docs.filter((d) => d.id.startsWith("gallery-"));
    const hasGalleryRefs = manifests.some((manifest) => Object.keys(manifest).some((key) => key.startsWith("gallery-"))) || legacyGalleryDocs.length > 0 || paths.size > 0;
    if (!hasGalleryRefs) continue;
    cardsAffected += 1; storageObjects += paths.size; legacyMediaDocs += legacyGalleryDocs.length;
    if (dryRun) continue;

    for (const path of paths) {
      try { await bucket.file(path).delete({ignoreNotFound: true}); storageObjectsDeleted += 1; }
      catch (error) { console.warn("Gallery Storage delete failed", {cardId, path, message: error?.message || String(error)}); throw new HttpsError("internal", `Gallery deletion stopped for ${cardId}.`); }
    }

    const cleanManifest = (manifest) => Object.fromEntries(Object.entries((manifest && typeof manifest === "object") ? manifest : {}).filter(([key]) => !key.startsWith("gallery-")));
    const batch = db.batch();
    if (profileSnap.exists) batch.set(profileRef, {media: cleanManifest(profileData.media), galleryImages: FieldValue.delete(), updatedAt: Timestamp.now()}, {merge: true});
    if (cardData.media && typeof cardData.media === "object") batch.set(cardSnap.ref, {media: cleanManifest(cardData.media), galleryImages: FieldValue.delete(), updatedAt: Timestamp.now()}, {merge: true});
    legacyGalleryDocs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  return {ok: true, dryRun, scope, cardsAffected, storageObjects, storageObjectsDeleted, legacyMediaDocs};
});

exports.aiScannerHealth = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const admin = await isPlatformAdmin(request.auth.uid);
  if (!admin) throw new HttpsError("permission-denied", "Administrator access required.");
  const snap = await db.doc("platform/aiScanner").get();
  const config = {...DEFAULT_SCANNER_CONFIG, ...(snap.exists ? snap.data() : {})};
  return {
    externalServicesAllowed: config.externalServicesAllowed === true,
    ocr: {provider: config.ocrProvider || "googleVision", status: config.lastOcrSuccessAt ? "Connected" : "Ready to test", lastSuccessAt: config.lastOcrSuccessAt?.toDate?.()?.toISOString?.() || null},
    aiParsing: {provider: config.aiParsingProvider || "basic", status: config.aiParsingProvider && config.aiParsingProvider !== "basic" ? "Integration Required" : "Not Configured (basic fallback active)"}
  };
});

exports.saveAiScannerAdminConfig = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in first.");
  if (!(await isPlatformAdmin(request.auth.uid))) throw new HttpsError("permission-denied", "Administrator access required.");

  const data = request.data || {};
  const normalizeLimit = (raw) => {
    const mode = ["disabled", "unlimited", "number"].includes(raw?.mode) ? raw.mode : "disabled";
    const count = mode === "number" ? Math.max(1, Math.min(100000, Number(raw?.count || 1))) : 0;
    return {mode, count};
  };
  const config = {
    externalServicesAllowed: data.externalServicesAllowed === true,
    ocrProvider: data.ocrProvider === "googleVision" ? "googleVision" : "googleVision",
    aiParsingProvider: data.aiParsingProvider === "basic" ? "basic" : "basic",
    limits: {
      Basic: normalizeLimit(data.limits?.Basic),
      Premium: normalizeLimit(data.limits?.Premium),
      Business: normalizeLimit(data.limits?.Business)
    },
    updatedAt: Timestamp.now(),
    updatedBy: request.auth.uid
  };

  await db.doc("platform/aiScanner").set(config, {merge: true});
  const saved = await db.doc("platform/aiScanner").get();
  const savedConfig = {...DEFAULT_SCANNER_CONFIG, ...(saved.exists ? saved.data() : {})};
  savedConfig.limits = {...DEFAULT_SCANNER_CONFIG.limits, ...(savedConfig.limits || {})};
  return {saved: true, config: savedConfig};
});

exports.aiScannerClientStatus = onCall(async (request) => {
  const cardId = sanitizeCardId(request.data?.cardId);
  const authz = await authorizeCard(request, cardId);
  const limit = resolvedLimit(authz.card, authz.scannerConfig, authz.plan);
  const month = currentMonth();
  const [usage, totals] = await Promise.all([db.doc(`aiScannerUsage/${month}/cards/${cardId}`).get(), db.doc(`aiScannerTotals/${cardId}`).get()]);
  const count = usage.exists ? Number(usage.data().totalScans || 0) : 0;
  const limitReached = limit?.mode === "number" && Number(limit.count || 0) > 0 && count >= Number(limit.count);
  return {allowed: true, externalServicesAllowed: authz.scannerConfig.externalServicesAllowed === true, ocrProvider: authz.scannerConfig.ocrProvider || "googleVision", aiParsingProvider: authz.scannerConfig.aiParsingProvider || "basic", plan: authz.plan, month, scansThisMonth: count, monthUsage: usage.exists ? usage.data() : {}, allTime: totals.exists ? totals.data() : {}, limit, limitReached};
});

exports.getAiScannerAdminSummary = onCall(async (request) => {
  if (!request.auth?.uid || !(await isPlatformAdmin(request.auth.uid))) throw new HttpsError("permission-denied", "Administrator access required.");
  const month = MONTH_RE.test(safeString(request.data?.month, 7)) ? request.data.month : currentMonth();
  const [usageSnap, cfgSnap] = await Promise.all([db.doc(`aiScannerUsage/${month}`).get(), db.doc("platform/aiScanner").get()]);
  return {month, usage: usageSnap.exists ? usageSnap.data() : {}, config: {...DEFAULT_SCANNER_CONFIG, ...(cfgSnap.exists ? cfgSnap.data() : {})}};
});

exports.scanBusinessCard = onCall({timeoutSeconds: 60, memory: "512MiB"}, async (request) => {
  const cardId = sanitizeCardId(request.data?.cardId);
  const testMode = request.data?.testMode === true;
  const authz = await authorizeCard(request, cardId);
  if (testMode && !authz.admin) throw new HttpsError("permission-denied", "Only JMX administration can run Test Mode.");
  if (authz.scannerConfig.externalServicesAllowed !== true) throw new HttpsError("failed-precondition", "AI services are temporarily unavailable (Kill Switch OFF).");
  if ((authz.scannerConfig.ocrProvider || "googleVision") !== "googleVision") throw new HttpsError("failed-precondition", "OCR provider is not configured.");
  const base64 = safeString(request.data?.imageBase64, 9_000_000).replace(/^data:image\/[^;]+;base64,/, "");
  if (!base64 || base64.length < 100) throw new HttpsError("invalid-argument", "Choose a readable business card image.");
  if (base64.length > 8_000_000) throw new HttpsError("invalid-argument", "Image is too large. Please use a smaller photo.");
  const limit = resolvedLimit(authz.card, authz.scannerConfig, authz.plan);
  let reservation;
  try {
    reservation = await reserveScannerRequest(cardId, request.auth.uid, authz.plan, limit, testMode);
    const text = await googleVisionText(base64);
    if (!text) throw new Error("No readable text was detected.");
    const contact = parseBusinessCardText(text);
    const duplicates = await findDuplicates(cardId, contact);
    await finalizeScannerUsage(cardId, reservation.month, "success", testMode);
    if (!testMode && duplicates.length) {
      await Promise.all([
        db.doc(`aiScannerUsage/${reservation.month}/cards/${cardId}`).set({duplicatesDetected: FieldValue.increment(1), updatedAt: Timestamp.now()}, {merge: true}),
        db.doc(`aiScannerUsage/${reservation.month}`).set({duplicatesDetected: FieldValue.increment(1), updatedAt: Timestamp.now()}, {merge: true}),
        db.doc(`aiScannerTotals/${cardId}`).set({duplicatesDetected: FieldValue.increment(1), updatedAt: Timestamp.now()}, {merge: true})
      ]);
    }
    if (!testMode) {
      const historyRef = db.collection(`aiScannerHistory/${cardId}/items`).doc();
      await historyRef.set({cardId, ownerUid: request.auth.uid, name: contact.fullName || "", company: contact.company || "", source: "AI Card Scanner", status: "scanned", duplicateCount: duplicates.length, createdAt: Timestamp.now()});
    }
    await db.doc("platform/aiScanner").set({lastOcrSuccessAt: Timestamp.now(), lastSuccessfulCardId: cardId, updatedAt: Timestamp.now()}, {merge: true});
    return {contact, duplicates, provider: {ocr: "googleVision", aiParsing: "basicFallback"}, testMode};
  } catch (error) {
    if (reservation) await finalizeScannerUsage(cardId, reservation.month, "failed", testMode).catch(() => {});
    console.error("AI scanner failed", {cardId, message: error?.message});
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "We couldn't fully read this card. Review the image or try another photo.");
  }
});

exports.saveAiScannerRecord = onCall(async (request) => {
  const cardId = sanitizeCardId(request.data?.cardId);
  const authz = await authorizeCard(request, cardId);
  const target = request.data?.target === "contact" ? "contact" : "lead";
  const contact = cleanContact(request.data?.contact || {});
  if (!contact.fullName && !contact.email && !contact.mobilePhone) throw new HttpsError("invalid-argument", "Add at least a name, email, or phone before saving.");
  const action = ["new", "update"].includes(request.data?.duplicateAction) ? request.data.duplicateAction : "new";
  const existingType = request.data?.existingType === "lead" ? "lead" : "contact";
  const existingId = safeString(request.data?.existingId, 120).replace(/[^A-Za-z0-9_-]/g, "");
  const now = Timestamp.now();
  let ref;
  if (action === "update" && existingId) {
    ref = db.doc(`${existingType === "lead" ? "leads" : "contacts"}/${cardId}/items/${existingId}`);
  } else {
    ref = db.collection(`${target === "lead" ? "leads" : "contacts"}/${cardId}/items`).doc();
  }
  if (target === "lead" || existingType === "lead") {
    const expiresAt = Timestamp.fromMillis(Date.now() + 30 * 86400000);
    await ref.set({cardId, ownerUid: request.auth.uid, name: contact.fullName || `${contact.firstName} ${contact.lastName}`.trim(), phone: contact.mobilePhone || contact.officePhone, email: contact.email, company: contact.company, message: "", status: "New", notes: contact.notes, meetingNotes: "", followUpDate: null, expiresAt, source: "AI Card Scanner", category: contact.category, whereMet: contact.whereMet, dateMet: contact.dateMet, scannerData: contact, updatedAt: now, ...(action === "new" ? {createdAt: now} : {})}, {merge: true});
  } else {
    await ref.set({cardId, ownerUid: request.auth.uid, ...contact, name: contact.fullName || `${contact.firstName} ${contact.lastName}`.trim(), phone: contact.mobilePhone || contact.officePhone, source: "AI Card Scanner", updatedAt: now, ...(action === "new" ? {createdAt: now} : {})}, {merge: true});
  }
  const month = currentMonth();
  const usageFields = target === "lead" ? {leadsCreated: FieldValue.increment(1)} : {contactsCreated: FieldValue.increment(1)};
  await Promise.all([
    db.doc(`aiScannerUsage/${month}/cards/${cardId}`).set({...usageFields, updatedAt: now}, {merge: true}),
    db.doc(`aiScannerUsage/${month}`).set({...usageFields, updatedAt: now}, {merge: true}),
    db.doc(`aiScannerTotals/${cardId}`).set({...usageFields, updatedAt: now}, {merge: true})
  ]).catch(() => {});
  await db.collection(`aiScannerHistory/${cardId}/items`).add({cardId, ownerUid: request.auth.uid, name: contact.fullName || "", company: contact.company || "", source: "AI Card Scanner", status: target === "lead" ? "saved_as_lead" : "saved_as_contact", recordId: ref.id, createdAt: now});
  return {ok: true, id: ref.id, target};
});


const WALLET_THEMES = Object.freeze({
  wallet_black:{name:"Black",hex:"#111111",plans:["Basic","Premium","Business"]}, wallet_white:{name:"White",hex:"#f8fafc",plans:["Basic","Premium","Business"]}, wallet_gray:{name:"Gray",hex:"#6b7280",plans:["Basic","Premium","Business"]}, wallet_silver:{name:"Silver",hex:"#c0c0c0",plans:["Basic","Premium","Business"]}, wallet_gold:{name:"Gold",hex:"#b8860b",plans:["Basic","Premium","Business"]}, wallet_orange:{name:"Orange",hex:"#f97316",plans:["Basic","Premium","Business"]}, wallet_red:{name:"Red",hex:"#dc2626",plans:["Basic","Premium","Business"]}, wallet_burgundy:{name:"Burgundy",hex:"#800020",plans:["Basic","Premium","Business"]}, wallet_blue:{name:"Blue",hex:"#2563eb",plans:["Basic","Premium","Business"]}, wallet_navy:{name:"Navy Blue",hex:"#172554",plans:["Basic","Premium","Business"]}, wallet_electric_blue:{name:"Electric Blue",hex:"#0284c7",plans:["Basic","Premium","Business"]}, wallet_cyan:{name:"Cyan",hex:"#06b6d4",plans:["Basic","Premium","Business"]}, wallet_green:{name:"Green",hex:"#16a34a",plans:["Basic","Premium","Business"]}, wallet_emerald:{name:"Emerald",hex:"#059669",plans:["Basic","Premium","Business"]}, wallet_teal:{name:"Teal",hex:"#0f766e",plans:["Basic","Premium","Business"]}, wallet_purple:{name:"Purple",hex:"#7c3aed",plans:["Basic","Premium","Business"]}, wallet_pink:{name:"Pink",hex:"#db2777",plans:["Basic","Premium","Business"]}, wallet_brown:{name:"Brown",hex:"#92400e",plans:["Basic","Premium","Business"]},
  default:{name:"JMX Classic",hex:"#1f2937",plans:["Basic","Premium","Business"]}, silver_uv:{name:"Silver UV",hex:"#64748b",plans:["Basic","Premium","Business"]}, black_gold:{name:"Black Gold",hex:"#171717",plans:["Premium","Business"]}, black_matte:{name:"Black Matte Glow",hex:"#111827",plans:["Basic","Premium","Business"]}, electric_blue:{name:"Electric Blue",hex:"#075985",plans:["Basic","Premium","Business"]}, deep_navy:{name:"Deep Navy",hex:"#172554",plans:["Premium","Business"]}, emerald:{name:"Emerald",hex:"#065f46",plans:["Basic","Premium","Business"]}, teal:{name:"Teal Aurora",hex:"#115e59",plans:["Premium","Business"]}, purple:{name:"Royal Purple",hex:"#581c87",plans:["Basic","Premium","Business"]}, violet:{name:"Violet Beam",hex:"#5b21b6",plans:["Premium","Business"]}, aurora:{name:"Aurora",hex:"#0f766e",plans:["Business"]}, red_matte:{name:"Red Matte Glow",hex:"#991b1b",plans:["Basic","Premium","Business"]}, red_gold:{name:"Red Gold",hex:"#9f1239",plans:["Premium","Business"]}, rose_gold:{name:"Rose Gold",hex:"#9f5f67",plans:["Premium","Business"]}, copper:{name:"Copper",hex:"#9a3412",plans:["Business"]}, carbon_red:{name:"Carbon Red",hex:"#27272a",plans:["Business"]}, gold:{name:"Liquid Gold",hex:"#854d0e",plans:["Premium","Business"]}, cyan:{name:"Electric Cyan",hex:"#0e7490",plans:["Business"]},
  platinum_prism:{name:"Platinum Prism",hex:"#6b7280",plans:["Business"]}, obsidian_chrome:{name:"Obsidian Chrome",hex:"#18181b",plans:["Business"]}, midnight_spectrum:{name:"Midnight Spectrum",hex:"#111827",plans:["Business"]}, ultraviolet_titanium:{name:"Ultraviolet Titanium",hex:"#4c1d95",plans:["Business"]}, emerald_amethyst:{name:"Emerald Amethyst",hex:"#065f46",plans:["Business"]}, sapphire_violet:{name:"Sapphire Violet",hex:"#1e3a8a",plans:["Business"]}, crimson_solar:{name:"Crimson Solar",hex:"#991b1b",plans:["Business"]}, ruby_chrome:{name:"Ruby Chrome",hex:"#9f1239",plans:["Business"]}, champagne_metal:{name:"Champagne Metal",hex:"#a16207",plans:["Business"]}, rose_platinum:{name:"Rose Platinum",hex:"#9d6b75",plans:["Business"]}, molten_copper:{name:"Molten Copper",hex:"#9a3412",plans:["Business"]}, titanium_ice:{name:"Titanium Ice",hex:"#475569",plans:["Business"]}, graphite_laser:{name:"Graphite Laser",hex:"#27272a",plans:["Business"]}, opal_shift:{name:"Opal Shift",hex:"#94a3b8",plans:["Business"]}, arctic_hologram:{name:"Arctic Hologram",hex:"#0891b2",plans:["Business"]}, black_neon_flux:{name:"Black Neon Flux",hex:"#09090b",plans:["Business"]}, scarlet_noir:{name:"Scarlet Noir",hex:"#7f1d1d",plans:["Business"]}, cosmic_pearl:{name:"Cosmic Pearl",hex:"#6366f1",plans:["Business"]},
  neon_titanium:{name:"Neon Titanium",hex:"#334155",plans:["Business"]}, golden_prism:{name:"Golden Prism",hex:"#a16207",plans:["Business"]}, emerald_circuit:{name:"Emerald Circuit",hex:"#047857",plans:["Business"]}, sapphire_chrome:{name:"Sapphire Chrome",hex:"#1d4ed8",plans:["Business"]}, crimson_geometry:{name:"Crimson Geometry",hex:"#b91c1c",plans:["Business"]}, arctic_aurora:{name:"Arctic Aurora",hex:"#0e7490",plans:["Business"]}, violet_matrix:{name:"Violet Matrix",hex:"#6d28d9",plans:["Business"]}, copper_horizon:{name:"Copper Horizon",hex:"#b45309",plans:["Business"]}, midnight_crystal:{name:"Midnight Crystal",hex:"#1e293b",plans:["Business"]}, solar_carbon:{name:"Solar Carbon",hex:"#292524",plans:["Business"]}, electric_quartz:{name:"Electric Quartz",hex:"#0891b2",plans:["Business"]}, rose_hologram:{name:"Rose Hologram",hex:"#be185d",plans:["Business"]}, ocean_prism:{name:"Ocean Prism",hex:"#0369a1",plans:["Business"]}, obsidian_gold:{name:"Obsidian Gold",hex:"#171717",plans:["Business"]}, titanium_wave:{name:"Titanium Wave",hex:"#64748b",plans:["Business"]}, emerald_geometry:{name:"Emerald Geometry",hex:"#059669",plans:["Business"]}, scarlet_chrome:{name:"Scarlet Chrome",hex:"#be123c",plans:["Business"]}, cosmic_silver:{name:"Cosmic Silver",hex:"#64748b",plans:["Business"]}
});
function resolvedWalletTheme(card={}) { const id=safeString(card.googleWalletTheme||"default",40); return {id:WALLET_THEMES[id]?id:"default", ...(WALLET_THEMES[id]||WALLET_THEMES.default)}; }

function walletObjectSuffix(cardId) {
  return `jmx_${sanitizeCardId(cardId).toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`.slice(0, 120);
}
function walletPublicUrl(cardId) {
  return cardId === "main" ? `${WALLET_ORIGIN}/` : `${WALLET_ORIGIN}/c/${encodeURIComponent(cardId)}`;
}
function walletLocalized(value) { return {defaultValue: {language: "en-US", value: safeString(value, 60) || "JMX Digital Card"}}; }
function walletServiceAccount() {
  let credentials;
  try { credentials = JSON.parse(GOOGLE_WALLET_SERVICE_ACCOUNT.value()); }
  catch (_) { throw new HttpsError("failed-precondition", "Google Wallet credentials are not configured."); }
  if (!credentials?.client_email || !credentials?.private_key) throw new HttpsError("failed-precondition", "Google Wallet credentials are incomplete.");
  return credentials;
}
async function authorizeWallet(request, cardId) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in to add this card to Google Wallet.");
  const [cardSnap, profileSnap, settingsSnap] = await Promise.all([db.doc(`cards/${cardId}`).get(), db.doc(`profiles/${cardId}`).get(), db.doc("platform/publicSettings").get()]);
  if (!cardSnap.exists) throw new HttpsError("not-found", "Card not found.");
  const card = cardSnap.data();
  const owner = await cardOwnerMatches(cardId, request.auth.uid);
  if (!owner) throw new HttpsError("permission-denied", "Only the authenticated owner of this card can add it to Google Wallet.");
  const publicSettings = settingsSnap.exists ? settingsSnap.data() : {};
  if (!featureAllows(card, publicSettings, "googleWallet")) throw new HttpsError("permission-denied", "Google Wallet is disabled for this card.");
  if (["available", "sold"].includes(String(card.status || "").toLowerCase())) throw new HttpsError("failed-precondition", "This card must be activated before it can be added to Google Wallet.");
  return {card, profile: profileSnap.exists ? profileSnap.data() : card};
}
function buildWalletObject(cardId, card, profile) {
  const publicUrl = walletPublicUrl(cardId);
  const objectId = `${WALLET_ISSUER_ID}.${walletObjectSuffix(cardId)}`;
  const name = safeString(profile?.fullName || card?.clientName || "JMX Digital Card", 60);
  const company = safeString(profile?.company || "JMX Digital Card", 60);
  const position = safeString(profile?.position || "Digital Business Card", 60);
  const walletTheme = resolvedWalletTheme(card);
  return {id: objectId, classId: WALLET_CLASS_ID, state: "ACTIVE", hexBackgroundColor: walletTheme.hex, cardTitle: walletLocalized(company), header: walletLocalized(name), subheader: walletLocalized(position), barcode: {type: "QR_CODE", value: publicUrl, alternateText: cardId}, logo: {sourceUri: {uri: WALLET_IMAGE_URL}, contentDescription: walletLocalized("JMX Digital Card")}, linksModuleData: {uris: [{uri: publicUrl, description: "Open JMX Digital Card", id: "jmxDigitalCard"}]}, textModulesData: [{id: "company", header: "Company", body: company}, {id: "card", header: "Digital Card", body: cardId}]};
}
async function upsertWalletObject(credentials, object) {
  const auth = new GoogleAuth({credentials, scopes: ["https://www.googleapis.com/auth/wallet_object.issuer"]});
  const client = await auth.getClient();
  const resource = encodeURIComponent(object.id), base = "https://walletobjects.googleapis.com/walletobjects/v1/genericObject";
  try { await client.request({url: `${base}/${resource}`, method: "GET"}); await client.request({url: `${base}/${resource}`, method: "PUT", data: object}); return "updated"; }
  catch (error) { if (error?.response?.status !== 404) throw error; await client.request({url: base, method: "POST", data: object}); return "created"; }
}
exports.saveGoogleWalletTheme = onCall({secrets: [GOOGLE_WALLET_SERVICE_ACCOUNT], timeoutSeconds: 30}, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in to customize Google Wallet.");
  const cardId=sanitizeCardId(request.data?.cardId), themeId=safeString(request.data?.themeId,40);
  const [cardSnap,profileSnap,settingsSnap]=await Promise.all([db.doc(`cards/${cardId}`).get(),db.doc(`profiles/${cardId}`).get(),db.doc("platform/publicSettings").get()]);
  if(!cardSnap.exists) throw new HttpsError("not-found","Card not found.");
  if(!await cardOwnerMatches(cardId,request.auth.uid)) throw new HttpsError("permission-denied","Only the authenticated owner can customize this Wallet pass.");
  const card=cardSnap.data(), profile=profileSnap.exists?profileSnap.data():card, settings=settingsSnap.exists?settingsSnap.data():{};
  if(!featureAllows(card,settings,"googleWallet")||!featureAllows(card,settings,"googleWalletThemes")) throw new HttpsError("permission-denied","Google Wallet color customization is disabled for this card.");
  const theme=WALLET_THEMES[themeId]; if(!theme||!theme.plans.includes(normalizePlan(card))) throw new HttpsError("permission-denied","This Wallet color is not available for this plan.");
  const now=Timestamp.now(), updatedCard={...card,googleWalletTheme:themeId};
  await db.doc(`cards/${cardId}`).set({googleWalletTheme:themeId,googleWalletThemeUpdatedAt:now},{merge:true});
  let walletUpdated=false;
  if(card.googleWalletObjectId||card.googleWalletStatus==="active"){
    try{
      const credentials=walletServiceAccount(),object=buildWalletObject(cardId,updatedCard,profile),action=await upsertWalletObject(credentials,object);
      await db.doc(`cards/${cardId}`).set({googleWalletObjectId:object.id,googleWalletStatus:"active",googleWalletUpdatedAt:now},{merge:true});
      walletUpdated=action==="updated"||action==="created";
    }catch(error){
      console.error("Google Wallet color saved but live pass update failed",{cardId,themeId,status:error?.response?.status,message:error?.message});
      return {ok:true,themeId,themeName:theme.name,walletUpdated:false,walletUpdateError:true};
    }
  }
  return {ok:true,themeId,themeName:theme.name,walletUpdated};
});

exports.createGoogleWalletPass = onCall({secrets: [GOOGLE_WALLET_SERVICE_ACCOUNT], timeoutSeconds: 30}, async (request) => {
  const cardId = sanitizeCardId(request.data?.cardId), authz = await authorizeWallet(request, cardId), credentials = walletServiceAccount();
  const object = buildWalletObject(cardId, authz.card, authz.profile);
  try {
    const action = await upsertWalletObject(credentials, object), now = Timestamp.now();
    await db.doc(`cards/${cardId}`).set({googleWalletObjectId: object.id, googleWalletStatus: "active", googleWalletUpdatedAt: now, ...(action === "created" ? {googleWalletCreatedAt: now} : {})}, {merge: true});
    const claims = {iss: credentials.client_email, aud: "google", typ: "savetowallet", iat: Math.floor(Date.now()/1000), origins: [WALLET_ORIGIN], payload: {genericObjects: [{id: object.id, classId: WALLET_CLASS_ID}]}};
    const token = jwt.sign(claims, credentials.private_key, {algorithm: "RS256"});
    console.info("Google Wallet pass ready", {cardId, objectId: object.id, classId: WALLET_CLASS_ID, action});
    return {ok: true, objectId: object.id, action, saveUrl: `https://pay.google.com/gp/v/save/${token}`};
  } catch (error) {
    console.error("Google Wallet API error", {cardId, objectId: object.id, classId: WALLET_CLASS_ID, status: error?.response?.status, code: error?.code, message: error?.message});
    if (error instanceof HttpsError) throw error;
    const status = error?.response?.status;
    if (status === 401 || status === 403) throw new HttpsError("permission-denied", "Google Wallet service account is not authorized for this issuer.");
    if (status === 404) throw new HttpsError("failed-precondition", "Google Wallet class was not found. Verify the configured Class ID.");
    throw new HttpsError("internal", "Google Wallet could not create or update this pass.");
  }
});

// ===== Official JMX NFC Device-ID backend — Sep 2026 =====
function nfcDeviceType(value){const v=safeString(value,30).toLowerCase();return ["card","sticker","keychain","bracelet","ring","plate","tag","other"].includes(v)?v:"other"}
async function nfcAdminUid(){const s=await db.doc("platform/config").get();return s.exists?s.data().adminUid||"":""}
async function assertNfcAdmin(request){if(!request.auth?.uid)throw new HttpsError("unauthenticated","Administrator sign-in required.");if(request.auth.uid!==await nfcAdminUid())throw new HttpsError("permission-denied","JMX administrator access required.")}
async function nfcControlAllows(card,deviceType){
  const cfgSnap=await db.doc("platform/nfcDeviceSettings").get(),cfg=cfgSnap.exists?cfgSnap.data():{};
  if(cfg.enabled===false)return false;
  if(cfg.global?.[deviceType]===false)return false;
  const plan=normalizePlan(card),bucket=cfg[plan]||{};if(bucket[deviceType]===false)return false;
  if(card?.nfcDevicesEnabled===false)return false;
  if(card?.nfcDeviceControls?.[deviceType]===false)return false;
  return true;
}
exports.resolveNfcDevice=onCall({timeoutSeconds:15},async request=>{
  const deviceId=safeString(request.data?.deviceId,80).toUpperCase().replace(/[^A-Z0-9_-]/g,"");if(!deviceId)throw new HttpsError("invalid-argument","Device ID is required.");
  const deviceSnap=await db.doc(`nfcDevices/${deviceId}`).get();if(!deviceSnap.exists)throw new HttpsError("not-found","This NFC device is not registered with JMX Digital Card.");const device=deviceSnap.data();
  if(device.enabled===false||device.status!=="active")throw new HttpsError("failed-precondition",device.status==="pending"?"This NFC device is waiting for activation.":"This NFC device is currently disabled.");
  if(!device.cardId)throw new HttpsError("failed-precondition","This NFC device is not assigned to a profile.");
  const [batchSnap,cardSnap]=await Promise.all([db.doc(`nfcBatches/${device.batchId}`).get(),db.doc(`cards/${device.cardId}`).get()]);if(!cardSnap.exists)throw new HttpsError("not-found","The linked JMX profile no longer exists.");const card=cardSnap.data();
  const profileStatus=safeString(card.profileStatus||"",30).toLowerCase();
  if(["suspended","archived","cancelled","canceled"].includes(profileStatus)||card.status==="suspended")throw new HttpsError("failed-precondition","This JMX profile is currently unavailable.");
  if(batchSnap.exists&&(batchSnap.data().enabled===false||["archived","disabled"].includes(safeString(batchSnap.data().status||"",30).toLowerCase())))throw new HttpsError("failed-precondition","This NFC batch is disabled.");if(!await nfcControlAllows(card,nfcDeviceType(device.deviceType)))throw new HttpsError("permission-denied","This NFC device type is disabled for this profile or plan.");
  return {ok:true,deviceId,cardId:device.cardId,deviceType:nfcDeviceType(device.deviceType)};
});
exports.recordNfcTap=onCall({timeoutSeconds:15},async request=>{
  const deviceId=safeString(request.data?.deviceId,80).toUpperCase().replace(/[^A-Z0-9_-]/g,"");if(!deviceId)return {ok:false};const ref=db.doc(`nfcDevices/${deviceId}`);
  try{const pre=await ref.get();if(!pre.exists)return {ok:false};const pd=pre.data();if(pd.enabled===false||pd.status!=="active"||!pd.cardId)return {ok:false};const [cardSnap,batchSnap]=await Promise.all([db.doc(`cards/${pd.cardId}`).get(),pd.batchId?db.doc(`nfcBatches/${pd.batchId}`).get():Promise.resolve(null)]);if(!cardSnap.exists)return {ok:false};const cardData=cardSnap.data(),profileStatus=safeString(cardData.profileStatus||"",30).toLowerCase();if(["suspended","archived","cancelled","canceled"].includes(profileStatus)||cardData.status==="suspended"||batchSnap?.exists&&batchSnap.data().enabled===false||!await nfcControlAllows(cardData,nfcDeviceType(pd.deviceType)))return {ok:false};await db.runTransaction(async tx=>{const s=await tx.get(ref);if(!s.exists)return;const d=s.data();if(d.enabled===false||d.status!=="active")return;const now=Timestamp.now();tx.set(ref,{tapCount:Number(d.tapCount||0)+1,firstTapAt:d.firstTapAt||now,lastTapAt:now,updatedAt:now},{merge:true});if(d.batchId)tx.set(db.doc(`nfcBatches/${d.batchId}`),{tapCount:FieldValue.increment(1),lastTapAt:now,updatedAt:now},{merge:true})});return {ok:true}}catch(e){console.warn("recordNfcTap skipped",deviceId,e?.message);return {ok:false}}
});
exports.activateNfcBatch=onCall({timeoutSeconds:60},async request=>{
  if(!request.auth?.uid)throw new HttpsError("unauthenticated","Sign in before activating this NFC batch.");const activationCode=safeString(request.data?.activationCode,80).toUpperCase();if(!activationCode)throw new HttpsError("invalid-argument","Batch Activation Code is required.");
  const q=await db.collection("nfcBatches").where("activationCode","==",activationCode).limit(2).get();if(q.empty)throw new HttpsError("not-found","Batch Activation Code is invalid.");if(q.size!==1)throw new HttpsError("failed-precondition","Activation code collision detected. Contact JMX support.");const batchDoc=q.docs[0],batch=batchDoc.data();if(batch.activationCodeStatus==="revoked"||batch.activationCodeStatus==="expired")throw new HttpsError("failed-precondition","This activation code is no longer valid.");if(batch.activationCodeStatus==="used")throw new HttpsError("already-exists","This batch has already been activated.");if(!batch.cardId)throw new HttpsError("failed-precondition","JMX must assign this batch to a customer profile before activation.");
  const owner=await db.doc(`cardOwners/${batch.cardId}`).get();if(!owner.exists||owner.data().ownerUid!==request.auth.uid)throw new HttpsError("permission-denied","This signed-in account is not the owner of the profile assigned to this batch.");
  const devices=await db.collection("nfcDevices").where("batchId","==",batchDoc.id).get();if(devices.empty)throw new HttpsError("failed-precondition","This batch contains no devices.");const now=Timestamp.now(),terminal=new Set(["lost","stolen","replaced","retired","archived"]);for(let i=0;i<devices.docs.length;i+=200){const wb=db.batch();devices.docs.slice(i,i+200).forEach(d=>{const data=d.data(),life=safeString(data.lifecycleStatus||data.status||"",30).toLowerCase(),keep=terminal.has(life),status=keep?life:"active",enabled=!keep;wb.set(d.ref,{cardId:batch.cardId,status,lifecycleStatus:status,enabled,deviceEnabled:enabled,activatedAt:keep?(data.activatedAt||null):now,updatedAt:now},{merge:true});wb.set(db.doc(`nfcDevicePublic/${d.id}`),{cardId:batch.cardId,batchId:batchDoc.id,deviceType:nfcDeviceType(data.deviceType),status,enabled,updatedAt:now},{merge:true})});await wb.commit()}
  await batchDoc.ref.set({status:"active",enabled:true,activationCodeStatus:"used",activatedAt:now,activatedByUid:request.auth.uid,updatedAt:now},{merge:true});
  await db.collection("nfcDeviceEvents").add({event:"Batch Activated",batchId:batchDoc.id,cardId:batch.cardId,ownerUid:request.auth.uid,deviceCount:devices.size,createdAt:now});
  return {ok:true,batchId:batchDoc.id,cardId:batch.cardId,deviceCount:devices.size};
});
exports.setNfcDeviceSettings=onCall({timeoutSeconds:30},async request=>{await assertNfcAdmin(request);const raw=request.data?.settings||{},types=["card","sticker","keychain","bracelet","ring","plate","tag","other"],cleanBucket=b=>Object.fromEntries(types.map(t=>[t,b?.[t]!==false]));const settings={enabled:raw.enabled!==false,global:cleanBucket(raw.global),Basic:cleanBucket(raw.Basic),Premium:cleanBucket(raw.Premium),Business:cleanBucket(raw.Business),updatedAt:Timestamp.now()};await db.doc("platform/nfcDeviceSettings").set(settings,{merge:true});return {ok:true,settings}});
exports.getNfcDeviceSettings=onCall({timeoutSeconds:15},async request=>{await assertNfcAdmin(request);const s=await db.doc("platform/nfcDeviceSettings").get();return {ok:true,settings:s.exists?s.data():{}}});
