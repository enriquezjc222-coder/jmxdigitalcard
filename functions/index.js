const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {initializeApp, getApp} = require("firebase-admin/app");
const {getFirestore, Timestamp, FieldValue} = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

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
  const keys = ["description","saveContact","quickActions","phone","phone2","whatsapp","email","website","location","facebook","instagram","linkedin","twitter","tiktok","youtube","services","gallery","video","qr","customQR","qrDownload","finalCTA","businessLinks","catalog","customBusiness","analytics","advancedAnalytics","quickCapture","leads","contactNotes","meetingNotes","followUp","csvExport","vcfDownload","contactMap","aiScanner","autoIntroEmail","appleWallet","googleWallet","brandingRemoval","advancedNetworkingInsights"];
  const businessOnly = new Set(["customQR","qrDownload","advancedAnalytics","quickCapture","leads","contactNotes","meetingNotes","followUp","csvExport","vcfDownload","contactMap","aiScanner","autoIntroEmail","appleWallet","googleWallet","brandingRemoval","advancedNetworkingInsights"]);
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
