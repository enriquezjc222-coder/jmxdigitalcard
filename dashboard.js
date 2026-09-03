import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, serverTimestamp, writeBatch, query, where, deleteField } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { getStorage, ref as storageRef, deleteObject } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyDf12K0m93K4cWSotDcSg2fIS-s3uaLW_Y",
  authDomain: "jmx-digital-card.firebaseapp.com",
  projectId: "jmx-digital-card",
  storageBucket: "jmx-digital-card.firebasestorage.app",
  messagingSenderId: "411133047344",
  appId: "1:411133047344:web:07c250e162cde4d63cb3f5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);
const $ = (id) => document.getElementById(id);
const SAFE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let user = null;
let cards = [];
const PROTECTED_CARD_IDS = new Set(["BOSS"]);
const FEATURE_DEFS = [
  ["description","Description"],["saveContact","Save Contact"],["quickActions","Quick Actions"],["phone","Primary Phone"],["phone2","Second Phone"],["whatsapp","WhatsApp"],["email","Email"],["website","Website"],["location","Location"],["facebook","Facebook"],["instagram","Instagram"],["linkedin","LinkedIn"],["twitter","X / Twitter"],["tiktok","TikTok"],["youtube","YouTube"],["services","Services"],["gallery","Gallery"],["video","Featured Video"],["qr","QR Code"],["customQR","Custom QR"],["qrDownload","QR Download"],["finalCTA","Final CTA"],["businessLinks","Business Links"],["catalog","Catalog / PDF"],["customBusiness","Custom Business Link"],["analytics","Analytics"],["advancedAnalytics","Advanced Analytics"],["quickCapture","Quick Capture"],["leads","Leads / My Contacts"],["contactNotes","Contact Notes"],["meetingNotes","Meeting Notes"],["followUp","Follow-Up"],["csvExport","CSV Export"],["vcfDownload","VCF Download"],["contactMap","Contact Map"],["aiScanner","AI Business Card Scanner"],["autoIntroEmail","Auto-Intro Email"],["appleWallet","Apple Wallet"],["googleWallet","Google Wallet"],["googleWalletThemes","Google Wallet Themes"],["qrCardThemes","QR Card Themes"],["profileThemes","Profile Theme Colors"],["brandingRemoval","Branding Removal"],["advancedNetworkingInsights","Advanced Networking Insights"]
];
const BASIC_FEATURE_DEFAULTS = new Set(["description","saveContact","quickActions","phone","whatsapp","email","location","facebook","qr","profileThemes"]);
const EXTERNAL_PENDING_FEATURES = new Set(["contactMap","autoIntroEmail","appleWallet","advancedNetworkingInsights"]);
let clientDialogDraft = null;
let clientDialogOriginal = null;
function cloneFeatureOverrides(card){return {...((card?.featureOverrides&&typeof card.featureOverrides==="object")?card.featureOverrides:{})}}
function createClientDialogDraft(card){return {basePlan:basePlan(card),complimentaryPremium:card?.complimentaryPremium===true,complimentaryBusiness:card?.complimentaryBusiness===true,featureOverrides:cloneFeatureOverrides(card),aiScannerMonthlyLimit:(card?.aiScannerMonthlyLimit&&typeof card.aiScannerMonthlyLimit==="object")?{...card.aiScannerMonthlyLimit}:{mode:"disabled",count:0}}}
function dialogCardFromDraft(card,draft=clientDialogDraft){return draft?{...card,plan:draft.basePlan,complimentaryPremium:draft.complimentaryPremium,complimentaryBusiness:draft.complimentaryBusiness,featureOverrides:draft.featureOverrides,aiScannerMonthlyLimit:draft.aiScannerMonthlyLimit}:card}
function normalizeDialogDraft(draft){
  if(!draft)return draft;
  if(draft.basePlan==="Business"){draft.complimentaryPremium=false;draft.complimentaryBusiness=false;}
  else if(draft.basePlan==="Premium"){draft.complimentaryPremium=false;}
  if(draft.complimentaryBusiness)draft.complimentaryPremium=false;
  return draft;
}
function dialogDraftChanged(){
  if(!clientDialogDraft||!clientDialogOriginal)return false;
  const stable=x=>JSON.stringify({basePlan:x.basePlan,complimentaryPremium:x.complimentaryPremium===true,complimentaryBusiness:x.complimentaryBusiness===true,featureOverrides:x.featureOverrides||{},aiScannerMonthlyLimit:x.aiScannerMonthlyLimit||{mode:"disabled",count:0}});
  return stable(clientDialogDraft)!==stable(clientDialogOriginal);
}
function setDialogSaveState(message=""){
  const b=document.querySelector('[data-dialog-action="saveClientChanges"]');
  if(b)b.disabled=!dialogDraftChanged();
  const st=$("clientDetailSaveStatus");if(st)st.textContent=message|| (dialogDraftChanged()?"Unsaved changes":"All changes saved");
}
function defaultFeatureControls(){
  const global={},Basic={},Premium={},Business={};
  const businessOnly=new Set(["customQR","qrDownload","advancedAnalytics","quickCapture","leads","contactNotes","meetingNotes","followUp","csvExport","vcfDownload","contactMap","aiScanner","autoIntroEmail","appleWallet","googleWallet","googleWalletThemes","qrCardThemes","brandingRemoval","advancedNetworkingInsights"]);
  FEATURE_DEFS.forEach(([key])=>{global[key]=true;Basic[key]=BASIC_FEATURE_DEFAULTS.has(key);Premium[key]=!businessOnly.has(key);Business[key]=true});
  return {enabled:true,global,Basic,Premium,Business};
}
function basePlan(card){
  return ["Basic","Premium","Business"].includes(card?.plan) ? card.plan : "Basic";
}
function effectivePlan(card){
  if(card?.complimentaryBusiness===true) return "Business";
  if(card?.complimentaryPremium===true) return "Premium";
  return basePlan(card);
}
function complimentaryTier(card){
  if(card?.complimentaryBusiness===true) return "Business";
  if(card?.complimentaryPremium===true) return "Premium";
  return null;
}
function businessCountsAsActive(card){return effectivePlan(card)==="Business" && ["activated","suspended"].includes(card?.status) && card?.subscription?.status!=="canceled";}
let featureControls = defaultFeatureControls();
function platformAllowsForCard(card,key){
  // Hierarchy is always GLOBAL -> PLAN -> CLIENT. A client override may restrict a
  // feature, but it can never bypass a Global or Plan OFF setting.
  if(featureControls.enabled===false){const plan=effectivePlan(card);if(plan==="Business")return true;if(plan==="Premium")return !new Set(["quickCapture","leads","advancedAnalytics"]).has(key);return BASIC_FEATURE_DEFAULTS.has(key)}
  if(featureControls.global?.[key]===false)return false;
  const plan=effectivePlan(card),bucket=plan==="Basic"?featureControls.Basic:plan==="Business"?featureControls.Business:featureControls.Premium;
  return bucket?.[key]!==false;
}
function clientAllowsFeature(card,key){
  if(featureControls.global?.[key]===false)return false;
  const override=card?.featureOverrides?.[key];
  if(override===true)return true;
  if(override===false)return false;
  return platformAllowsForCard(card,key);
}


function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[c]);
}
function randomCode(length = 4) {
  const numbers = new Uint32Array(length);
  crypto.getRandomValues(numbers);
  return Array.from(numbers, (n) => SAFE[n % SAFE.length]).join("");
}
function activationCode() { return randomCode(6); }
function cleanCode(value) { return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); }
function setLoginStatus(message, type = "") {
  const el = $("loginStatus");
  if (!el) return;
  el.textContent = message;
  el.className = "status " + type;
}
function setDialogStatus(message, type = "") {
  const el = $("dialogStatus");
  if (!el) return;
  el.textContent = message;
  el.className = "status " + type;
}
function friendlyUrl(id) {
  if (["localhost", "127.0.0.1"].includes(location.hostname) || location.hostname.endsWith("github.io")) {
    return new URL(`card.html?card=${encodeURIComponent(id)}`, location.href).href;
  }
  return `${location.origin}/c/${encodeURIComponent(id)}`;
}
function editorUrl(id) { return new URL(`admin.html?card=${encodeURIComponent(id)}`, location.href).href; }

async function isAdmin(currentUser) {
  if (!currentUser) return false;
  const cfg = await getDoc(doc(db, "platform", "config"));
  if (cfg.exists()) return cfg.data().adminUid === currentUser.uid;
  const main = await getDoc(doc(db, "cards", "main"));
  if (main.exists() && main.data().ownerUid === currentUser.uid) {
    await setDoc(doc(db, "platform", "config"), {
      adminUid: currentUser.uid,
      adminEmail: currentUser.email || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    return true;
  }
  return false;
}

async function signIn() {
  try {
    await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPassword").value);
  } catch (error) {
    console.error(error);
    setLoginStatus("Sign in failed. Check email and password.", "error");
  }
}
async function signInWithGoogle(){
  setLoginStatus("Opening Google sign-in...");
  const provider=new GoogleAuthProvider(); provider.setCustomParameters({prompt:"select_account"});
  try{await signInWithPopup(auth,provider)}catch(error){console.error(error);const code=String(error?.code||"");setLoginStatus(code.includes("popup-closed")?"Google sign-in was canceled.":code.includes("unauthorized-domain")?"This domain is not authorized for Google sign-in.":"Google sign-in failed. Try again.","error")}
}

async function migrateLegacyMain() {
  const cardSnap = await getDoc(doc(db, "cards", "main"));
  if (!cardSnap.exists()) return;
  const data = cardSnap.data();
  if (!data.fullName) return;
  const profileSnap = await getDoc(doc(db, "profiles", "main"));
  if (!profileSnap.exists()) {
    const profile = { ...data };
    ["ownerUid", "status", "createdAt", "updatedAt"].forEach((k) => delete profile[k]);
    await setDoc(doc(db, "profiles", "main"), profile);
  }
}

async function loadCards() {
  await migrateLegacyMain();
  const [cardCollectionSnap, inventoryCollectionSnap] = await Promise.all([
    getDocs(collection(db, "cards")),
    getDocs(collection(db, "inventory"))
  ]);

  const cardDocs = new Map();
  for (const d of cardCollectionSnap.docs) {
    if (d.id === "main" && d.data().fullName && !d.data().inventoryVersion) continue;
    cardDocs.set(d.id, d.data());
  }

  const inventoryDocs = new Map(inventoryCollectionSnap.docs.map((d) => [d.id, d.data()]));
  const allIds = new Set([...cardDocs.keys(), ...inventoryDocs.keys()]);
  const result = [];

  for (const id of allIds) {
    const cardData = cardDocs.get(id);
    const inventoryData = inventoryDocs.get(id) || {};
    const [adminSnap, ownerSnap, profileSnap, statsSnap] = await Promise.all([
      getDoc(doc(db, "cardAdmin", id)),
      getDoc(doc(db, "cardOwners", id)),
      getDoc(doc(db, "profiles", id)),
      getDoc(doc(db, "cardStats", id))
    ]);
    const admin = adminSnap.exists() ? adminSnap.data() : {};

    // If an inventory document exists without a matching cards document, keep it visible
    // as recoverable unclaimed inventory instead of silently hiding its permanent URL.
    const base = cardData || {
      inventoryVersion: inventoryData.inventoryVersion || 2,
      status: inventoryData.status || "available",
      plan: inventoryData.plan || "Basic",
      nfcStatus: inventoryData.nfcStatus || admin.nfcStatus || "not-programmed",
      requiresActivationCode: inventoryData.requiresActivationCode !== false,
      complimentaryPremium: false,
      subscription: { status: "none", source: "manual" },
      createdAt: inventoryData.createdAt || admin.createdAt || null,
      updatedAt: inventoryData.updatedAt || admin.updatedAt || null,
      recoveredInventory: true
    };

    result.push({
      id,
      ...base,
      admin,
      owner: ownerSnap.exists() ? ownerSnap.data() : null,
      profile: profileSnap.exists() ? profileSnap.data() : null,
      inventory: inventoryData,
      stats: statsSnap.exists() ? statsSnap.data() : {}
    });
  }

  cards = result.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  render();
}

function badgeClass(status) {
  if (["activated", "active"].includes(status)) return "active";
  if (status === "suspended") return "paused";
  if (status === "sold") return "sold";
  return "available";
}

function sumActions(actions = {}) {
  return Object.values(actions || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function prettyActionName(name = "") {
  const labels = {
    phone: "Phone",
    text: "Text",
    email: "Email",
    website: "Website",
    whatsapp: "WhatsApp",
    facebook: "Facebook",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    twitter: "X / Twitter",
    tiktok: "TikTok",
    youtube: "YouTube",
    catalog: "Catalog",
    customLink: "Custom link",
    saveContact: "Save Contact",
    share: "Share",
    cta: "CTA",
    quickCapture: "Quick Capture",
    leadReceived: "Leads Received",
    qrVisit: "QR Visits",
    qrDownload: "QR Download"
  };
  return labels[name] || name.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
}

function actionBreakdown(actions = {}) {
  const entries = Object.entries(actions || {}).filter(([, value]) => Number(value || 0) > 0).sort((a,b)=>Number(b[1])-Number(a[1]));
  if (!entries.length) return '<div class="analytics-empty">No tracked actions yet.</div>';
  return entries.map(([name, value]) => `<div class="analytics-action-row"><span>${esc(prettyActionName(name))}</span><strong>${Number(value || 0).toLocaleString()}</strong></div>`).join("");
}

function cardSearchText(card) {
  const admin = card.admin || {};
  const owner = card.owner || {};
  const profile = card.profile || {};
  const inventory = card.inventory || {};
  const dateValues = [card.createdAt, card.updatedAt, card.soldAt, admin.createdAt, admin.updatedAt, inventory.createdAt, inventory.updatedAt]
    .flatMap((value) => {
      if (!value) return [];
      const date = value?.toDate ? value.toDate() : value instanceof Date ? value : null;
      if (!date) return [String(value)];
      return [date.toLocaleDateString(), date.toLocaleString(), date.toISOString().slice(0, 10)];
    });
  return [
    card.id, card.profileId, card.admin?.profileId, friendlyUrl(card.id), card.plan, effectivePlan(card), card.status, card.profileStatus,
    card.subscription?.status, card.subscription?.source, card.activationStatus,
    admin.clientName, admin.notes, admin.phone, admin.email, admin.company,
    inventory.notes, inventory.physicalType, inventory.nfcStatus,
    owner.ownerEmail, owner.email, owner.phone,
    profile.fullName, profile.firstName, profile.lastName, profile.company,
    profile.email, profile.phone, profile.phone2, profile.website,
    ...dateValues
  ].filter(Boolean).join(" ").toLowerCase();
}

function panelSearchValue(id) { return ($(id)?.value || "").trim().toLowerCase(); }
function matchesPanelSearch(card, id) { const q = panelSearchValue(id); return !q || cardSearchText(card).includes(q); }
function categoryForCard(card) {
  if ((card.status || "available") === "available") return "Available";
  if (card.status === "sold") return "Sold / Awaiting Activation";
  const plan = effectivePlan(card);
  return plan === "Business" ? "JMX Business Clients" : `${plan} Clients`;
}

function renderMasterSearchResults(query) {
  const box = $("masterSearchResults");
  if (!box) return;
  if (!query) { box.hidden = true; box.innerHTML = ""; return; }
  const statusFilter = $("statusFilter").value;
  const planFilter = $("planFilter")?.value || "all";
  const matches = cards.filter(card => cardSearchText(card).includes(query) && (statusFilter === "all" || card.status === statusFilter) && (planFilter === "all" || effectivePlan(card) === planFilter));
  box.hidden = false;
  box.innerHTML = `<div class="master-search-results-head"><strong>${matches.length} result${matches.length===1?"":"s"}</strong><span class="subtitle small">Searches all five inventory/client categories</span></div><div class="master-search-result-list">${matches.length ? matches.map(card => {
    const name = card.profile?.fullName || card.admin?.clientName || card.owner?.ownerEmail || card.inventory?.notes || card.admin?.notes || card.id;
    return `<button class="master-search-result" type="button" data-master-result="${esc(card.id)}"><span><strong>${esc(name)}</strong><small>${esc(card.id)} · ${esc(friendlyUrl(card.id))} · ${esc(effectivePlan(card))} · ${esc(card.status || "available")}</small></span><span class="master-search-category">${esc(categoryForCard(card))}</span></button>`;
  }).join("") : '<div class="inventory-pool-empty compact">No matching card or client was found.</div>'}</div>`;
  box.querySelectorAll("[data-master-result]").forEach(button => button.addEventListener("click", () => {
    const card = cards.find(c => c.id === button.dataset.masterResult);
    if (!card) return;
    if (["available","sold"].includes(card.status || "available")) openInventoryDialog(card.id); else openClientDialog(card.id);
  }));
}

function render() {
  const search = $("searchCards").value.trim().toLowerCase();
  const filter = $("statusFilter").value;
  const planFilter = $("planFilter")?.value || "all";
  const list = cards.filter((card) => {
    return (!search || cardSearchText(card).includes(search)) && (filter === "all" || card.status === filter) && (planFilter === "all" || effectivePlan(card) === planFilter);
  });

  $("totalCards").textContent = cards.length;
  $("availableCards").textContent = cards.filter((c) => c.status === "available").length;
  $("activatedCards").textContent = cards.filter((c) => c.status === "activated").length;
  $("suspendedCards").textContent = cards.filter((c) => c.status === "suspended").length;
  const clientStatuses = new Set(["activated", "suspended"]);
  const unclaimedStatuses = new Set(["available", "sold"]);
  $("basicCards").textContent = cards.filter(c=>clientStatuses.has(c.status) && effectivePlan(c)==="Basic").length;
  $("premiumCards").textContent = cards.filter(c=>clientStatuses.has(c.status) && effectivePlan(c)==="Premium").length;
  $("businessCards").textContent = cards.filter(businessCountsAsActive).length;
  $("compCards").textContent = cards.filter(c=>c.complimentaryPremium===true).length;
  $("compBusinessCards").textContent = cards.filter(c=>c.complimentaryBusiness===true).length;
  $("businessAvailableCards").textContent = cards.filter(c=>effectivePlan(c)==="Business" && c.status==="available").length;
  $("businessSoldCards").textContent = cards.filter(c=>effectivePlan(c)==="Business" && c.status==="sold").length;
  $("inactiveCards").textContent = cards.filter(c=>unclaimedStatuses.has(c.status) || !c.status).length;

  const inventoryRowMarkup = (card) => {
    const admin = card.admin || {};
    const inventory = card.inventory || {};
    const effective = effectivePlan(card);
    const note = admin.notes || inventory.notes || "Add private note";
    const created = card.createdAt?.toDate ? card.createdAt.toDate().toLocaleDateString() : "—";
    const returnButton = card.status === "sold" ? `<button class="inventory-return-button" type="button" data-return-available="${esc(card.id)}" title="Return this unactivated card to Available"><i class="fa-solid fa-rotate-left"></i> Available</button>` : "";
    return `<div class="inventory-list-row-wrap">
      <button class="inventory-list-row" type="button" data-inventory-id="${esc(card.id)}">
        <span class="inventory-list-main"><strong>${esc(card.id)}</strong><small>${esc(friendlyUrl(card.id))}</small></span>
        <span class="inventory-list-note" title="${esc(note)}">${esc(note)}</span>
        <span class="inventory-list-plan">${esc(effective)}</span>
        <span class="inventory-list-date"><small>Created</small><strong>${esc(created)}</strong></span>
        <span class="badge ${badgeClass(card.status)}">${esc(card.status || "available")}</span><i class="fa-solid fa-chevron-right"></i>
      </button>${returnButton}
      <button class="inventory-note-edit" type="button" data-edit-note="${esc(card.id)}" title="Edit internal note" aria-label="Edit internal note for ${esc(card.id)}"><i class="fa-solid fa-pen"></i></button>
    </div>`;
  };

  const clientRowMarkup = (card) => {
    const admin = card.admin || {}, owner = card.owner || {}, profile = card.profile || {}, stats = card.stats || {};
    const effective = effectivePlan(card), displayName = profile.fullName || admin.clientName || owner.ownerEmail || card.id, gift = complimentaryTier(card);
    return `<div class="client-list-row-wrap"><button class="client-list-row" type="button" data-client-id="${esc(card.id)}"><span class="client-list-main"><strong>${esc(displayName)}</strong><small>${esc(card.id)} · ${esc(owner.ownerEmail || "No owner email")}</small></span><span class="client-list-plan">${esc(effective)}${gift ? `<small class="gift-inline-label"><i class="fa-solid fa-gift"></i> Gift</small>` : ""}</span><span class="client-list-stat"><strong>${Number(stats.views || 0).toLocaleString()}</strong><small>historical views</small></span><span class="client-list-stat"><strong>${sumActions(stats.actions || {}).toLocaleString()}</strong><small>tracked actions</small></span><span class="badge ${badgeClass(card.status)}">${esc(card.status || "activated")}</span><i class="fa-solid fa-chevron-right"></i></button><button class="client-manage-button" type="button" data-manage-client="${esc(card.id)}"><i class="fa-solid fa-user-gear"></i> Manage</button></div>`;
  };

  const inventoryList = list.filter(c => unclaimedStatuses.has(c.status) || !c.status);
  const basicList = list.filter(c => clientStatuses.has(c.status) && effectivePlan(c)==="Basic").filter(c=>matchesPanelSearch(c,"basicPanelSearch"));
  const premiumList = list.filter(c => clientStatuses.has(c.status) && effectivePlan(c)==="Premium").filter(c=>matchesPanelSearch(c,"premiumPanelSearch"));
  const businessList = list.filter(c => clientStatuses.has(c.status) && effectivePlan(c)==="Business").filter(c=>matchesPanelSearch(c,"businessPanelSearch"));
  const availableInventory = inventoryList.filter(c => (c.status || "available") === "available").filter(c=>matchesPanelSearch(c,"availablePanelSearch"));
  const soldInventory = inventoryList.filter(c => c.status === "sold").filter(c=>matchesPanelSearch(c,"soldPanelSearch"));

  $("inventoryAvailableList").innerHTML = availableInventory.map(inventoryRowMarkup).join("");
  $("inventorySoldList").innerHTML = soldInventory.map(inventoryRowMarkup).join("");
  $("inventoryAvailableCount").textContent = availableInventory.length;
  $("inventorySoldCount").textContent = soldInventory.length;
  $("inventoryPoolCount").textContent = inventoryList.length;
  $("inventoryAvailableEmpty").hidden = availableInventory.length > 0;
  $("inventorySoldEmpty").hidden = soldInventory.length > 0;
  $("inventoryPoolEmpty").hidden = inventoryList.length > 0;
  $("basicCardsGrid").innerHTML=basicList.map(clientRowMarkup).join("");
  $("premiumCardsGrid").innerHTML=premiumList.map(clientRowMarkup).join("");
  $("businessCardsGrid").innerHTML=businessList.map(clientRowMarkup).join("");
  $("basicColumnCount").textContent=basicList.length; $("premiumColumnCount").textContent=premiumList.length; $("businessColumnCount").textContent=businessList.length;
  $("emptyState").hidden = list.length > 0;
  renderMasterSearchResults(search);
  document.querySelectorAll(".inventory-list-row").forEach(row => row.addEventListener("click", () => openInventoryDialog(row.dataset.inventoryId)));
  document.querySelectorAll(".inventory-note-edit").forEach(button => button.addEventListener("click", async event => { event.stopPropagation(); await editInventoryNote(button.dataset.editNote); }));
  document.querySelectorAll("[data-return-available]").forEach(button => button.addEventListener("click", async event => { event.stopPropagation(); await returnSoldToAvailable(button.dataset.returnAvailable); }));
  document.querySelectorAll(".client-list-row").forEach(row => row.addEventListener("click", () => openClientDialog(row.dataset.clientId)));
  document.querySelectorAll(".client-manage-button").forEach(button => button.addEventListener("click", () => openClientDialog(button.dataset.manageClient)));
}

async function editInventoryNote(id) {
  const card = cards.find((c) => c.id === id);
  if (!card) return;
  const admin = card.admin || {};
  const inventory = card.inventory || {};
  const current = admin.notes || inventory.notes || "";
  const next = prompt("Edit private internal note for " + id + ":", current);
  if (next === null) return;
  const note = next.trim();
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "cardAdmin", id), { notes: note, updatedAt: serverTimestamp() }, { merge: true });
    batch.set(doc(db, "inventory", id), { notes: note, updatedAt: serverTimestamp() }, { merge: true });
    await batch.commit();
    const wasOpen = $("clientDetailDialog")?.open && $("clientDetailDialog").dataset.cardId === id;
    if (wasOpen) $("clientDetailDialog").close();
    await loadCards();
    if (wasOpen) await openInventoryDialog(id);
  } catch (error) {
    console.error("Update inventory note failed", error);
    alert("Could not update the internal note. Please try again.");
  }
}

async function openInventoryDialog(id) {
  const card = cards.find((c) => c.id === id);
  if (!card) return;
  const admin = card.admin || {};
  const inventory = card.inventory || {};
  const effective = effectivePlan(card);
  const note = admin.notes || inventory.notes || "—";
  const created = card.createdAt?.toDate ? card.createdAt.toDate().toLocaleDateString() : "—";
  const dialog = $("clientDetailDialog");
  dialog.dataset.cardId = id;
  dialog.dataset.detailType = "inventory";
  $("clientDetailTitle").textContent = id;
  $("clientDetailSubtitle").textContent = `${effective} · ${card.status || "available"} · unclaimed inventory`;
  $("clientDetailBody").innerHTML = `
    <div class="client-detail-grid inventory-detail-grid">
      <section class="detail-panel">
        <h3>NFC Inventory</h3>
        <div class="detail-list">
          <div><span>Card code</span><strong>${esc(id)}</strong></div>
          <div><span>Status</span><strong>${esc(card.status || "available")}</strong></div>
          <div class="detail-wide"><span>Permanent URL</span><strong class="break-anywhere">${esc(friendlyUrl(id))}</strong></div>
          <div><span>Plan</span><strong>${esc(effective)}</strong></div><div><span>Subscription</span><strong>${esc(card.subscription?.status || "none")}</strong></div><div><span>Source</span><strong>${esc(card.complimentaryBusiness?"complimentary business":card.complimentaryPremium?"complimentary premium":(card.subscription?.source||"manual"))}</strong></div>
          <div><span>Physical</span><strong>${esc(admin.physicalType || inventory.physicalType || "PVC")}</strong></div>
          <div><span>NFC state</span><strong>${esc(card.nfcStatus || admin.nfcStatus || inventory.nfcStatus || "not-programmed")}</strong></div>
          <div><span>Created</span><strong>${esc(created)}</strong></div>
          <div><span>Owner</span><strong>Not activated</strong></div>
          <div><span>Activation code</span><strong>${card.requiresActivationCode !== false ? esc(inventory.activationCode || "—") : "No code required"}</strong></div>
          <div class="detail-wide inventory-note-detail"><span>Internal note</span><strong>${esc(note)}</strong><button class="inline-edit-note" type="button" data-dialog-action="note"><i class="fa-solid fa-pen"></i> Edit note</button></div>
        </div>
      </section>
      <section class="detail-panel">
        <h3>Inventory Controls</h3>
        <p class="subtitle small">Use these controls to program, sell, or maintain this permanent NFC URL. The URL stays the same unless you regenerate the card code.</p>
        <div class="inventory-control-summary">
          <div><span>Availability</span><strong>${esc(card.status || "available")}</strong></div>
          <div><span>Private activation</span><strong>${card.requiresActivationCode !== false ? "Required" : "Not required"}</strong></div>
        </div>
      </section>
    </div>`;
  $("clientDetailActions").innerHTML = `
    <button class="secondary-button" data-dialog-action="open"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open URL</button>
    <button class="secondary-button" data-dialog-action="copy"><i class="fa-solid fa-copy"></i> Copy NFC URL</button>
    <button class="secondary-button" data-dialog-action="code"><i class="fa-solid fa-key"></i> Copy Activation</button>
    <button class="secondary-button" data-dialog-action="plan"><i class="fa-solid fa-layer-group"></i> Change Plan</button>
    ${effective === "Business" ? `<button class="secondary-button" data-dialog-action="compBusiness"><i class="fa-solid fa-gift"></i> ${card.complimentaryBusiness===true?"Remove Complimentary Business":"Complimentary Business"}</button>` : ""}
    <button class="secondary-button" data-dialog-action="note"><i class="fa-solid fa-pen"></i> Edit Internal Note</button>
    ${card.status === "available" ? '<button class="secondary-button" data-dialog-action="sold"><i class="fa-solid fa-tag"></i> Mark Sold</button>' : ""}
    ${card.status === "sold" ? '<button class="secondary-button" data-dialog-action="returnAvailable"><i class="fa-solid fa-rotate-left"></i> Return to Available</button>' : ""}
    ${card.status === "available" && !PROTECTED_CARD_IDS.has(id) ? '<button class="secondary-button" data-dialog-action="regenerate"><i class="fa-solid fa-arrows-rotate"></i> Regenerate</button><button class="danger-button" data-dialog-action="delete"><i class="fa-solid fa-trash"></i> Delete</button>' : ""}
  `;
  if (!dialog.open) dialog.showModal();
}


async function openClientDialog(id, preserveDraft=false) {
  const card = cards.find((c) => c.id === id);
  if (!card) return;
  if(!preserveDraft || !clientDialogDraft || $("clientDetailDialog")?.dataset.cardId!==id){
    clientDialogDraft=normalizeDialogDraft(createClientDialogDraft(card));
    clientDialogOriginal=JSON.parse(JSON.stringify(clientDialogDraft));
  }
  const viewCard=dialogCardFromDraft(card);
  const claimSnap = await getDoc(doc(db, "cardClaims", id));
  const profile = card.profile || {};
  const claim = claimSnap.exists() ? claimSnap.data() : {};
  const admin = card.admin || {};
  const owner = card.owner || {};
  const stats = card.stats || {};
  const effective = effectivePlan(viewCard);
  const totalActions = stats.actions || {};
  const linkedNfcCards=(typeof nfcDevices!=="undefined"?nfcDevices:[]).filter(d=>d.cardId===id&&d.deviceType==="card");
  const dialog = $("clientDetailDialog");
  dialog.dataset.cardId = id;
  dialog.dataset.detailType = "client";
  $("clientDetailTitle").textContent = profile.fullName || admin.clientName || owner.ownerEmail || id;
  $("clientDetailSubtitle").textContent = `${id} · ${effective} · ${card.status || "activated"}`;
  $("clientDetailBody").innerHTML = `
    <div class="client-detail-grid">
      <section class="detail-panel">
        <h3>Client & Card</h3>
        <div class="detail-list">
          <div><span>Card code</span><strong>${esc(id)}</strong></div>
          <div><span>Permanent URL</span><strong class="break-anywhere">${esc(friendlyUrl(id))}</strong></div>
          <div><span>Plan</span><strong>${esc(effective)}</strong></div><div><span>Subscription</span><strong>${esc(card.subscription?.status || "none")}</strong></div><div><span>Source</span><strong>${esc(viewCard.complimentaryBusiness?"complimentary business":viewCard.complimentaryPremium?"complimentary premium":(card.subscription?.source||"manual"))}</strong></div>
          <div><span>Status</span><strong>${esc(card.status || "activated")}</strong></div>
          <div><span>Owner email</span><strong>${esc(owner.ownerEmail || claim.ownerEmail || "—")}</strong></div>
          <div><span>Name</span><strong>${esc(profile.fullName || admin.clientName || "—")}</strong></div>
          <div><span>Company</span><strong>${esc(profile.company || "—")}</strong></div>
          <div><span>Phone</span><strong>${esc(profile.phone || "—")}</strong></div>
          <div><span>Email</span><strong>${esc(profile.email || "—")}</strong></div>
          <div><span>NFC state</span><strong>${esc(card.nfcStatus || admin.nfcStatus || "not-programmed")}</strong></div>
          <div><span>Physical</span><strong>${esc(admin.physicalType || "PVC")}</strong></div>
          <div><span>Activated</span><strong>${card.activatedAt?.toDate ? card.activatedAt.toDate().toLocaleDateString() : "—"}</strong></div>
        </div>
      </section>
      <section class="detail-panel access-control-panel">
        <h3>Plan & Complimentary Access</h3>
        <p class="subtitle small">Changes below are staged until you press Save Changes. Complimentary access never erases the client's base plan or profile data.</p>
        <div class="access-status-grid">
          <div><span>Base plan</span><strong>${esc(basePlan(viewCard))}</strong></div>
          <div><span>Current access</span><strong>${esc(effective)}</strong></div>
        </div>
        <div class="plan-choice-row" role="group" aria-label="Change base plan">
          ${["Basic","Premium","Business"].map(plan=>`<button type="button" class="plan-choice-button ${basePlan(viewCard)===plan?"active":""}" data-draft-base-plan="${plan}">${plan==="Business"?"JMX Business":plan}</button>`).join("")}
        </div>
        <div class="gift-switch-stack">
          <label class="gift-switch-row ${basePlan(viewCard)==="Business"?"disabled":""}">
            <span><strong><i class="fa-solid fa-gift"></i> Complimentary Premium</strong><small>Free access until you turn it off and save.</small></span>
            <input type="checkbox" data-gift-tier="Premium" ${viewCard.complimentaryPremium===true?"checked":""} ${["Premium","Business"].includes(basePlan(viewCard))?"disabled":""}><i class="gift-switch-ui"></i>
          </label>
          <label class="gift-switch-row ${basePlan(viewCard)==="Business"?"disabled":""}">
            <span><strong><i class="fa-solid fa-gift"></i> Complimentary JMX Business</strong><small>Free Business access until you turn it off and save.</small></span>
            <input type="checkbox" data-gift-tier="Business" ${viewCard.complimentaryBusiness===true?"checked":""} ${basePlan(viewCard)==="Business"?"disabled":""}><i class="gift-switch-ui"></i>
          </label>
        </div>
      </section>
      <section class="detail-panel client-feature-control-panel">
        <h3>Client Feature Overrides</h3>
        <p class="subtitle small">ON grants the feature to this client even when the plan normally does not include it. Global OFF remains the platform safety gate. OFF hides it only for this client. Press Save Changes to apply.</p>
        <div class="feature-switch-list client-feature-switches">
          ${FEATURE_DEFS.map(([key,label])=>{
            const pending=EXTERNAL_PENDING_FEATURES.has(key);
            if(["googleWallet","googleWalletThemes","qrCardThemes"].includes(key)){
              const raw=viewCard.featureOverrides?.[key];
              const inherited=(()=>{const copy={...viewCard,featureOverrides:{...(viewCard.featureOverrides||{})}};delete copy.featureOverrides[key];return platformAllowsForCard(copy,key)})();
              const value=raw===true?"on":raw===false?"off":"inherit";
              return `<label class="feature-switch-row wallet-override-row"><span><strong>${esc(label)}</strong><small>${key==="googleWallet"?"Owner-only Wallet access":key==="googleWalletThemes"?"Owner-only Wallet theme customization":"Owner QR card theme customization"}. Inherit currently resolves to ${inherited?"ON":"OFF"}; explicit ON/OFF overrides Global and Plan for this client.</small></span><select class="client-feature-select" data-client-feature-select="${esc(key)}" aria-label="${esc(label)} override"><option value="inherit" ${value==="inherit"?"selected":""}>INHERIT</option><option value="on" ${value==="on"?"selected":""}>ON</option><option value="off" ${value==="off"?"selected":""}>OFF</option></select></label>`;
            }
            const inherited=platformAllowsForCard(viewCard,key),raw=viewCard.featureOverrides?.[key],clientOn=raw===true?true:raw===false?false:inherited,globalOn=featureControls.global?.[key]!==false;
            return `<label class="feature-switch-row ${globalOn?"":"master-off"} ${pending?"integration-pending":""}"><span><strong>${esc(label)}</strong><small>${pending?"External integration pending — setting can be stored for this client":(raw===true?"CLIENT OVERRIDE ON":raw===false?"CLIENT OVERRIDE OFF":`Inherited from ${effectivePlan(viewCard)}: ${inherited?"ON":"OFF"}`)}</small></span><input type="checkbox" data-client-feature="${esc(key)}" ${clientOn?"checked":""} ${globalOn&&!pending?"":"disabled"}><i class="switch-ui" aria-hidden="true"></i></label>`
          }).join("")}
        </div>
      </section>
      <section class="detail-panel ai-client-limit-panel">
        <h3>AI Scanner Monthly Limit</h3>
        <p class="subtitle small">Optional client-specific override. Disabled means no client-specific cap is enforced; plan/global permissions still apply.</p>
        <div class="ai-limit-inline">
          <select data-ai-client-limit-mode>
            <option value="disabled" ${viewCard.aiScannerMonthlyLimit?.mode!=="number"&&viewCard.aiScannerMonthlyLimit?.mode!=="unlimited"?"selected":""}>Limit disabled</option>
            <option value="unlimited" ${viewCard.aiScannerMonthlyLimit?.mode==="unlimited"?"selected":""}>Unlimited</option>
            <option value="number" ${viewCard.aiScannerMonthlyLimit?.mode==="number"?"selected":""}>Custom monthly limit</option>
          </select>
          <input data-ai-client-limit-count type="number" min="1" max="100000" value="${Number(viewCard.aiScannerMonthlyLimit?.count||50)}" ${viewCard.aiScannerMonthlyLimit?.mode==="number"?"":"disabled"}>
        </div>
      </section>
      ${linkedNfcCards.length?`<section class="detail-panel nfc-client-linked-panel"><h3>NFC Card</h3><div class="detail-list">${linkedNfcCards.map(d=>`<div><span>Physical card</span><strong>${esc(d.material||"NFC Card")} · ${esc((d.status||"linked").toUpperCase())}</strong></div>`).join("")}</div><div class="dialog-actions">${linkedNfcCards.map(d=>`<button type="button" class="secondary-button" data-open-linked-nfc="${esc(d.deviceId)}">View Card</button>`).join("")}</div><details><summary>Advanced Details</summary>${linkedNfcCards.map(d=>`<p class="break-anywhere"><strong>Internal ID:</strong> ${esc(d.deviceId)}<br><strong>Batch:</strong> ${esc(d.batchId||"—")}</p>`).join("")}</details></section>`:""}
      <section class="detail-panel analytics-panel">
        <h3>Analytics</h3>
        <p class="subtitle small">Profile-view history is preserved and frozen after August 25, 2026. New analytics prioritize real customer actions to reduce Firestore operations.</p>
        <div class="analytics-summary">
          <article><span>Historical profile views</span><strong>${Number(stats.views || 0).toLocaleString()}</strong></article>
          <article><span>Tracked actions</span><strong>${sumActions(totalActions).toLocaleString()}</strong></article>
          <article><span>Transition date</span><strong>Aug 26, 2026</strong></article>
        </div>
        <div class="analytics-columns">
          <div><h4>Action breakdown</h4>${actionBreakdown(totalActions)}</div>
        </div>
      </section>
    </div>`;
  $("clientDetailActions").innerHTML = `
    <div class="client-save-cluster"><button class="primary-button" data-dialog-action="saveClientChanges" ${dialogDraftChanged()?"":"disabled"}><i class="fa-solid fa-floppy-disk"></i> Save Changes</button><span id="clientDetailSaveStatus" class="client-save-status" aria-live="polite">${dialogDraftChanged()?"Unsaved changes":"All changes saved"}</span></div>
    <button class="secondary-button" data-dialog-action="copy"><i class="fa-solid fa-copy"></i> Copy / Recover URL</button>
    <button class="secondary-button" data-dialog-action="open"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open Profile</button>
    <button class="secondary-button" data-dialog-action="edit"><i class="fa-solid fa-pen"></i> Edit Profile</button>
    ${card.status === "activated" ? '<button class="secondary-button" data-dialog-action="suspend">Suspend</button>' : ''}
    ${card.status === "suspended" ? '<button class="secondary-button" data-dialog-action="reactivate">Reactivate</button>' : ''}
    ${linkedNfcCards.length?'<button class="secondary-button" data-nfc-client-action="return">Return NFC Card to Inventory</button><button class="danger-button" data-nfc-client-action="delete">Delete NFC Client/Card</button>':(PROTECTED_CARD_IDS.has(id) ? '<span class="protected-note"><i class="fa-solid fa-lock"></i> Protected card: release/delete disabled</span>' : '<button class="danger-button" data-dialog-action="release"><i class="fa-solid fa-rotate-left"></i> Release / Reset for Reuse</button>')}
  `;
  if (!dialog.open) dialog.showModal();
  setDialogSaveState();
}

async function saveClientDialogChanges(id){
  const card=cards.find(c=>c.id===id);if(!card||!clientDialogDraft||!clientDialogOriginal)return;
  normalizeDialogDraft(clientDialogDraft);
  if(!dialogDraftChanged()){setDialogSaveState("No changes to save");return;}
  const saveButton=document.querySelector('[data-dialog-action="saveClientChanges"]');if(saveButton)saveButton.disabled=true;
  setDialogSaveState("Saving…");
  const originalHadGift=card.complimentaryPremium===true||card.complimentaryBusiness===true;
  const baseStatus=originalHadGift?(card.preGiftSubscriptionStatus||"none"):(card.subscription?.status||"none");
  const baseSource=originalHadGift?(card.preGiftSubscriptionSource||"manual"):(card.subscription?.source||"manual");
  const tier=clientDialogDraft.complimentaryBusiness?"Business":clientDialogDraft.complimentaryPremium?"Premium":null;
  const payload={plan:clientDialogDraft.basePlan,featureOverrides:{...clientDialogDraft.featureOverrides},aiScannerMonthlyLimit:{...(clientDialogDraft.aiScannerMonthlyLimit||{mode:"disabled",count:0})},complimentaryPremium:tier==="Premium",complimentaryBusiness:tier==="Business",updatedAt:serverTimestamp()};
  if(tier){
    payload.complimentaryBasePlan=clientDialogDraft.basePlan;payload.preGiftSubscriptionStatus=baseStatus;payload.preGiftSubscriptionSource=baseSource;
    payload.subscription={...(card.subscription||{}),status:"active",source:"complimentary",complimentaryTier:tier};
  }else{
    payload.complimentaryBasePlan=deleteField();payload.preGiftSubscriptionStatus=deleteField();payload.preGiftSubscriptionSource=deleteField();
    payload.subscription={...(card.subscription||{}),status:baseStatus,source:baseSource,complimentaryTier:deleteField()};
  }
  try{
    const batch=writeBatch(db);batch.set(doc(db,"cards",id),payload,{merge:true});
    if(clientDialogDraft.basePlan!==basePlan(card))batch.set(doc(db,"inventory",id),{plan:clientDialogDraft.basePlan,updatedAt:serverTimestamp()},{merge:true});
    await batch.commit();await loadCards();
    clientDialogDraft=null;clientDialogOriginal=null;
    if($("clientDetailDialog").open)await openClientDialog(id,false);
    setDialogSaveState("Changes saved");
  }catch(error){console.error("Client changes save failed",error);setDialogSaveState("Save failed — changes are still pending");if(saveButton)saveButton.disabled=false;}
}

async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return true; }
  } catch {}
  const area = document.createElement("textarea");
  area.value = value; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
  document.body.appendChild(area); area.select();
  const ok = document.execCommand("copy"); area.remove(); return ok;
}

async function performCardAction(id, action, button = null) {
  const card = cards.find((c) => c.id === id);
  if (!card) return;
  if (action === "open") window.open(friendlyUrl(id), "_blank");
  if (action === "edit") location.href = editorUrl(id);
  if (action === "copy") {
    await copyText(friendlyUrl(id));
    if (button) {
      const old = button.innerHTML;
      button.textContent = "Copied";
      setTimeout(() => button.innerHTML = old, 1000);
    }
  }
  if (action === "code") {
    const code = card.inventory?.activationCode || "";
    if (!code) return alert("This card has no activation code.");
    await copyText(code);
    if (button) {
      const old = button.innerHTML;
      button.textContent = "Copied";
      setTimeout(() => button.innerHTML = old, 1000);
    }
  }
  if (action === "plan") await changePlan(id, card);
  if (action === "setBasePlan") await setBasePlan(id, card, button?.dataset.planValue);
  if (action === "note") await editInventoryNote(id);
  if (action === "comp") await toggleComplimentary(id, card);
  if (action === "compBusiness") await toggleComplimentaryBusiness(id, card);
  if (action === "sold") await updateStatus(id, "sold");
  if (action === "returnAvailable") await returnSoldToAvailable(id);
  if (action === "suspend") await updateStatus(id, "suspended");
  if (action === "reactivate") await updateStatus(id, "activated");
  if (action === "regenerate") await regenerate(id);
  if (action === "delete") await removeAvailable(id);
  if (action === "release") await releaseForReuse(id);
}

async function handleAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  await performCardAction(event.currentTarget.dataset.id, button.dataset.action, button);
}

async function deleteRefsInChunks(refs, chunkSize = 400) {
  for (let i = 0; i < refs.length; i += chunkSize) {
    const batch = writeBatch(db);
    refs.slice(i, i + chunkSize).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

async function deleteProfileStorageMedia(profileData){
  const manifest=(profileData?.media&&typeof profileData.media==="object")?profileData.media:{};
  await Promise.all(Object.values(manifest).map(async entry=>{if(!entry?.storagePath)return;try{await deleteObject(storageRef(storage,entry.storagePath))}catch(e){if(!String(e?.code||"").includes("object-not-found"))console.warn("Storage cleanup skipped",e)}}));
}

async function releaseForReuse(id) {
  const card = cards.find((c) => c.id === id);
  if (!card || !["activated", "suspended"].includes(card.status)) return;
  if (PROTECTED_CARD_IDS.has(id)) return alert(`${id} is protected and cannot be released or reset.`);
  const first = confirm(`Release ${id} from its current client?\n\nThe permanent NFC URL will be kept, the current client will be unlinked, and the card will return to Available inventory.`);
  if (!first) return;
  const second = confirm(`Final confirmation for ${id}: archive the current profile/analytics, clear client data, generate a new activation code, and reset this URL for reuse?`);
  if (!second) return;

  const [profileSnap, ownerSnap, claimSnap, adminSnap, mediaSnap, monthSnaps, daySnaps] = await Promise.all([
    getDoc(doc(db, "profiles", id)),
    getDoc(doc(db, "cardOwners", id)),
    getDoc(doc(db, "cardClaims", id)),
    getDoc(doc(db, "cardAdmin", id)),
    getDocs(collection(db, "cards", id, "media")),
    getDocs(query(collection(db, "monthlyStats"), where("cardId", "==", id))),
    getDocs(query(collection(db, "dailyStats"), where("cardId", "==", id)))
  ]);

  const releaseId = `${Date.now()}`;
  const batch = writeBatch(db);
  batch.set(doc(db, "cardHistory", id, "releases", releaseId), {
    cardId: id,
    releasedAt: serverTimestamp(),
    releasedBy: user?.uid || "",
    previousStatus: card.status || "",
    previousPlan: card.plan || "Basic",
    previousOwner: ownerSnap.exists() ? ownerSnap.data() : null,
    previousClaim: claimSnap.exists() ? claimSnap.data() : null,
    previousProfile: profileSnap.exists() ? profileSnap.data() : null,
    previousAdmin: adminSnap.exists() ? adminSnap.data() : null,
    previousStats: card.stats || {},
    analyticsTransitionDate: "2026-08-26"
  });

  batch.set(doc(db, "cards", id), {
    status: "available",
    complimentaryPremium: false,
    subscription: { status: "none", source: "manual" },
    nfcStatus: "not-programmed",
    activatedAt: deleteField(),
    soldAt: deleteField(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  batch.set(doc(db, "profiles", id), blankProfile(), { merge: false });
  batch.set(doc(db, "inventory", id), {
    activationCode: activationCode(),
    inventoryVersion: 2,
    status: "available",
    plan: card.plan || "Basic",
    physicalType: adminSnap.exists() ? (adminSnap.data().physicalType || "PVC") : "PVC",
    nfcStatus: "not-programmed",
    notes: `Released for reuse ${new Date().toLocaleDateString()}`,
    requiresActivationCode: true,
    updatedAt: serverTimestamp()
  }, { merge: true });
  batch.set(doc(db, "cardAdmin", id), {
    clientName: deleteField(),
    nfcStatus: "not-programmed",
    notes: `Released for reuse ${new Date().toLocaleDateString()}`,
    updatedAt: serverTimestamp()
  }, { merge: true });
  if (ownerSnap.exists()) batch.delete(doc(db, "cardOwners", id));
  if (claimSnap.exists()) batch.delete(doc(db, "cardClaims", id));
  batch.delete(doc(db, "ownerActivity", id));
  batch.delete(doc(db, "cardStats", id));
  mediaSnap.forEach((m) => batch.delete(m.ref));
  await deleteProfileStorageMedia(profileSnap.exists()?profileSnap.data():{});
  await batch.commit();
  await deleteRefsInChunks(monthSnaps.docs.map((d) => d.ref));
  await deleteRefsInChunks(daySnaps.docs.map((d) => d.ref));
  $("clientDetailDialog")?.close();
  alert(`${id} is available again. Its permanent URL was preserved and a new activation code was generated.`);
  await loadCards();
}

async function setComplimentaryTier(id, card, tier, enabled){
  if(!["Premium","Business"].includes(tier)) return;
  const currentBase=basePlan(card);
  if(currentBase==="Business") return alert("This client already has JMX Business as the base plan. No complimentary upgrade is needed.");
  if(tier==="Premium" && currentBase==="Premium" && enabled) return alert("This client already has Premium as the base plan.");

  const hasExistingGift=card.complimentaryPremium===true || card.complimentaryBusiness===true;
  const previousStatus=hasExistingGift ? (card.preGiftSubscriptionStatus ?? "none") : (card.subscription?.status || "none");
  const previousSource=hasExistingGift ? (card.preGiftSubscriptionSource ?? "manual") : (card.subscription?.source || "manual");
  const payload={updatedAt:serverTimestamp()};

  if(enabled){
    payload.complimentaryPremium=tier==="Premium";
    payload.complimentaryBusiness=tier==="Business";
    payload.complimentaryBasePlan=currentBase;
    payload.preGiftSubscriptionStatus=previousStatus;
    payload.preGiftSubscriptionSource=previousSource;
    payload.subscription={...(card.subscription||{}),source:"complimentary",status:"active",complimentaryTier:tier};
  }else{
    payload.complimentaryPremium=false;
    payload.complimentaryBusiness=false;
    payload.complimentaryBasePlan=deleteField();
    payload.subscription={...(card.subscription||{}),source:previousSource,status:previousStatus,complimentaryTier:deleteField()};
    payload.preGiftSubscriptionStatus=deleteField();
    payload.preGiftSubscriptionSource=deleteField();
  }
  await setDoc(doc(db,"cards",id),payload,{merge:true});
  await loadCards();
}

async function toggleComplimentary(id, card){
  await setComplimentaryTier(id, card, "Premium", card.complimentaryPremium!==true);
}

async function toggleComplimentaryBusiness(id, card){
  await setComplimentaryTier(id, card, "Business", card.complimentaryBusiness!==true);
}

async function setBasePlan(id, card, next){
  if(!["Basic","Premium","Business"].includes(next)) return;
  const current=basePlan(card);
  if(next===current && !complimentaryTier(card)) return;
  const gift=complimentaryTier(card);
  const message=gift
    ? `Change ${id} base plan from ${current} to ${next}? The current complimentary ${gift} gift will be removed. Client profile data will be preserved.`
    : `Change ${id} from ${current} to ${next}? Existing profile data will be preserved.`;
  if(!confirm(message)) return;
  const batch=writeBatch(db);
  batch.set(doc(db,"cards",id),{
    plan:next,complimentaryPremium:false,complimentaryBusiness:false,complimentaryBasePlan:deleteField(),preGiftSubscriptionStatus:deleteField(),preGiftSubscriptionSource:deleteField(),
    subscription:{...(card.subscription||{}),source:gift?(card.preGiftSubscriptionSource||"manual"):(card.subscription?.source||"manual"),status:gift?(card.preGiftSubscriptionStatus||"none"):(card.subscription?.status||"none"),complimentaryTier:deleteField()},updatedAt:serverTimestamp()
  },{merge:true});
  batch.set(doc(db,"inventory",id),{plan:next,updatedAt:serverTimestamp()},{merge:true});
  await batch.commit();
  await loadCards();
}

async function changePlan(id, card) {
  const current=basePlan(card);
  const entered=prompt(`Change ${id} base plan. Enter Basic, Premium, or Business:`, current);
  if(entered===null)return;
  const map={basic:"Basic",premium:"Premium",business:"Business","jmx business":"Business"};
  const next=map[entered.trim().toLowerCase()];
  if(!next)return alert("Invalid plan. Use Basic, Premium, or Business.");
  await setBasePlan(id, card, next);
}

async function returnSoldToAvailable(id) {
  const card = cards.find(c => c.id === id);
  if (!card || card.status !== "sold") return;
  const ownerEmail = card.owner?.ownerEmail || card.profile?.email || "";
  if (ownerEmail || card.profile?.fullName || card.status === "activated") return alert(`${id} appears to have client ownership/profile data. It was not returned to Available.`);
  if (!confirm(`Return ${id} from Sold / Awaiting Activation to Available?\n\nThe permanent Card ID, NFC URL and existing activation code will be preserved.`)) return;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db,"cards",id), {status:"available",soldAt:deleteField(),updatedAt:serverTimestamp()}, {merge:true});
    batch.set(doc(db,"inventory",id), {status:"available",soldAt:deleteField(),updatedAt:serverTimestamp()}, {merge:true});
    await batch.commit();
    if ($("clientDetailDialog")?.open) $("clientDetailDialog").close();
    await loadCards();
  } catch (error) {
    console.error("Return sold card to available failed", error);
    alert("Could not return this card to Available. No intentional client data was removed.");
  }
}

async function updateStatus(id, next) {
  const payload = { status: next, updatedAt: serverTimestamp() };
  if (next === "sold") payload.soldAt = serverTimestamp();
  await setDoc(doc(db, "cards", id), payload, { merge: true });
  await loadCards();
}

async function removeAvailable(id) {
  const card = cards.find((c) => c.id === id);
  if (PROTECTED_CARD_IDS.has(id)) return alert(`${id} is protected and cannot be deleted.`);
  if (!card || card.status !== "available") return;
  if (!confirm(`Delete unused NFC ${id}?`)) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, "cards", id));
  batch.delete(doc(db, "profiles", id));
  batch.delete(doc(db, "inventory", id));
  batch.delete(doc(db, "cardAdmin", id));
  await batch.commit();
  await loadCards();
}

async function regenerate(id) {
  const card = cards.find((c) => c.id === id);
  if (PROTECTED_CARD_IDS.has(id)) return alert(`${id} is protected and cannot be regenerated.`);
  if (!card || card.status !== "available") return;
  const next = randomCode();
  if (!confirm(`Regenerate ${id} as ${next}? The old NFC URL will stop working.`)) return;
  const [profile, meta] = await Promise.all([
    getDoc(doc(db, "profiles", id)),
    getDoc(doc(db, "cardAdmin", id))
  ]);
  const batch = writeBatch(db);
  batch.set(doc(db, "cards", next), {
    inventoryVersion: 2,
    status: "available",
    plan: card.plan || "Basic",
    nfcStatus: card.nfcStatus || "not-programmed",
    requiresActivationCode: card.requiresActivationCode !== false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  if (profile.exists()) batch.set(doc(db, "profiles", next), profile.data());
  batch.set(doc(db, "inventory", next), { activationCode: activationCode(), inventoryVersion: 2, status: "available", plan: card.plan || "Basic", physicalType: meta.exists() ? (meta.data().physicalType || "PVC") : "PVC", nfcStatus: card.nfcStatus || "not-programmed", notes: meta.exists() ? (meta.data().notes || "") : "", requiresActivationCode: card.requiresActivationCode !== false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  if (meta.exists()) batch.set(doc(db, "cardAdmin", next), { ...meta.data(), updatedAt: serverTimestamp() });
  batch.delete(doc(db, "cards", id)); batch.delete(doc(db, "profiles", id)); batch.delete(doc(db, "inventory", id)); batch.delete(doc(db, "cardAdmin", id));
  await batch.commit();
  alert(`New NFC URL: ${friendlyUrl(next)}`);
  await loadCards();
}

function blankProfile() {
  return {
    fullName: "", position: "", company: "", city: "", state: "", description: "", phone: "", phoneRaw: "", phone2: "", phone2Raw: "", whatsapp: "", whatsappRaw: "", email: "", website: "",
    facebook: "", instagram: "", linkedin: "", twitter: "", tiktok: "", youtube: "", catalog: "", customBusinessLabel: "More Information", customBusinessSubtitle: "Open business link", customBusinessUrl: "", videoUrl: "",
    service1Title: "Service One", service1Description: "", service1Icon: "fa-star", service2Title: "Service Two", service2Description: "", service2Icon: "fa-star", service3Title: "Service Three", service3Description: "", service3Icon: "fa-star",
    finalCtaTitle: "Let's Connect", finalCtaText: "Contact us today.", finalCtaLabel: "Contact Now", theme: "gold", visibility: {}, media: {}, mediaStorageVersion: 2, updatedAt: serverTimestamp()
  };
}

async function createCard(event) {
  event?.preventDefault?.();
  const button = $("createCardButton");
  setDialogStatus("");
  const id = cleanCode($("newCardId").value);
  $("newCardId").value = id;
  if (id.length < 4) return setDialogStatus("Use at least 4 letters or numbers.", "error");

  const plan = $("newPlan").value;
  const physicalType = $("newPhysicalType").value;
  const nfcStatus = $("newNfcStatus").value;
  const requiresActivationCode = $("requireActivationCode").checked;
  const code = $("newActivationCode").value.trim().toUpperCase();
  const notes = $("newNotes").value.trim();
  if (requiresActivationCode && !code) return setDialogStatus("Generate an activation code before creating the card.", "error");

  button.disabled = true;
  button.textContent = "Creating…";
  setDialogStatus("Creating NFC inventory card…", "working");
  try {
    if ((await getDoc(doc(db, "cards", id))).exists()) {
      return setDialogStatus("That card code already exists. Choose another code or press Random.", "error");
    }
    const batch = writeBatch(db);
    batch.set(doc(db, "cards", id), { inventoryVersion: 2, status: "available", plan, complimentaryPremium:false, complimentaryBusiness:false, subscription:{status:"none",source:"manual"}, nfcStatus, requiresActivationCode, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(db, "inventory", id), { activationCode: code, inventoryVersion: 2, status: "available", plan, physicalType, nfcStatus, notes, requiresActivationCode, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(db, "cardAdmin", id), { physicalType, nfcStatus, notes, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(db, "profiles", id), blankProfile());
    await batch.commit();
    setDialogStatus(`Card ${id} created successfully.`, "ok");
    await loadCards();
    setTimeout(() => {
      $("cardDialog").close();
      $("cardForm").reset();
      prepareDialog();
      setDialogStatus("");
    }, 450);
  } catch (error) {
    console.error("Create NFC card failed", error);
    const codeName = String(error?.code || "");
    if (codeName.includes("permission-denied")) {
      setDialogStatus("Firebase blocked this action. Publish the firestore.rules included with this ZIP, then try again.", "error");
    } else if (codeName.includes("unavailable")) {
      setDialogStatus("Firebase is temporarily unavailable. Check your internet connection and try again.", "error");
    } else {
      setDialogStatus("Could not create the NFC card: " + (error?.message || "Unknown error"), "error");
    }
  } finally {
    button.disabled = false;
    button.textContent = "Create Inventory Card";
  }
}

function prepareDialog() {
  $("newCardId").value = randomCode();
  $("newActivationCode").value = activationCode();
  $("requireActivationCode").checked = true;
  updatePreview();
}
function updatePreview() {
  const id = cleanCode($("newCardId").value);
  $("newCardId").value = id;
  $("newUrlPreview").textContent = id ? friendlyUrl(id) : "—";
}

$("loginButton").addEventListener("click", signIn);
$("dashboardGoogleLogin")?.addEventListener("click", signInWithGoogle);
$("loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") signIn(); });
$("logoutButton").addEventListener("click", () => signOut(auth));
$("newCardButton").addEventListener("click", () => { prepareDialog(); $("cardDialog").showModal(); });
$("cardForm").addEventListener("submit", createCard);
$("closeCardDialog").addEventListener("click", () => $("cardDialog").close());
$("cancelCardButton").addEventListener("click", () => $("cardDialog").close());
$("searchCards").addEventListener("input", () => { if (!$("searchCards").value.trim()) render(); });
$("searchCards").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); render(); } });
$("masterSearchButton")?.addEventListener("click", render);
["availablePanelSearch","soldPanelSearch","basicPanelSearch","premiumPanelSearch","businessPanelSearch"].forEach(id => $(id)?.addEventListener("input", render));
$("statusFilter").addEventListener("change", render);
$("planFilter")?.addEventListener("change", render);
const inventoryPanelMap={
  available:()=>$("inventoryAvailableList")?.closest(".inventory-list-column"),
  sold:()=>$("inventorySoldList")?.closest(".inventory-list-column"),
  basic:()=>$("basicCardsGrid")?.closest(".plan-column"),
  premium:()=>$("premiumCardsGrid")?.closest(".plan-column"),
  business:()=>$("businessCardsGrid")?.closest(".plan-column")
};
let expandedInventoryPanel=null, inventoryPanelBackdrop=null;
function closeInventoryPanel(){
  if(!expandedInventoryPanel)return;
  expandedInventoryPanel.classList.remove("inventory-panel-expanded");
  expandedInventoryPanel.querySelector(".compact-record-list")?.classList.remove("is-expanded");
  expandedInventoryPanel.querySelector("[data-panel-expand]")?.setAttribute("aria-expanded","false");
  inventoryPanelBackdrop?.remove(); inventoryPanelBackdrop=null; expandedInventoryPanel=null; document.body.classList.remove("inventory-panel-open");
}
function openInventoryPanel(key){
  const panel=inventoryPanelMap[key]?.(); if(!panel)return;
  if(expandedInventoryPanel===panel){closeInventoryPanel();return;}
  closeInventoryPanel(); expandedInventoryPanel=panel; panel.classList.add("inventory-panel-expanded"); panel.querySelector(".compact-record-list")?.classList.add("is-expanded"); panel.querySelector("[data-panel-expand]")?.setAttribute("aria-expanded","true");
  inventoryPanelBackdrop=document.createElement("div"); inventoryPanelBackdrop.className="inventory-panel-backdrop"; inventoryPanelBackdrop.addEventListener("click",closeInventoryPanel); document.body.appendChild(inventoryPanelBackdrop); document.body.classList.add("inventory-panel-open");
}
document.querySelectorAll("[data-panel-expand]").forEach(button=>button.addEventListener("click",()=>openInventoryPanel(button.dataset.panelExpand)));
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&expandedInventoryPanel)closeInventoryPanel();});
$("newCardId").addEventListener("input", updatePreview);
$("regenerateCode").addEventListener("click", () => { $("newCardId").value = randomCode(); updatePreview(); });
$("regenerateActivation").addEventListener("click", () => $("newActivationCode").value = activationCode());

function closeClientDetailSafely(){if(dialogDraftChanged()&&!confirm("Discard unsaved client changes?"))return;clientDialogDraft=null;clientDialogOriginal=null;$("clientDetailDialog").close();}
$("closeClientDetailDialog")?.addEventListener("click", closeClientDetailSafely);
$("clientDetailDialog")?.addEventListener("click", (event) => {if (event.target === $("clientDetailDialog")) closeClientDetailSafely();});
$("clientDetailDialog")?.addEventListener("cancel",(event)=>{if(dialogDraftChanged()&&!confirm("Discard unsaved client changes?")){event.preventDefault();return;}clientDialogDraft=null;clientDialogOriginal=null;});
async function handleDialogAction(event) {
  const button = event.target.closest("[data-dialog-action]");
  if (!button) return;
  const id = $("clientDetailDialog").dataset.cardId;
  const action = button.dataset.dialogAction;
  if(action==="saveClientChanges") return saveClientDialogChanges(id);
  await performCardAction(id, action, button);
  if (["plan", "sold", "returnAvailable", "suspend", "reactivate", "regenerate", "delete", "release"].includes(action) && $("clientDetailDialog").open) {
    $("clientDetailDialog").close();
  }
}
$("clientDetailActions")?.addEventListener("click", handleDialogAction);
$("clientDetailActions")?.addEventListener("click",e=>{const b=e.target.closest("[data-nfc-client-action]");if(!b)return;const id=$("clientDetailDialog").dataset.cardId;if(b.dataset.nfcClientAction==="return")returnNfcClientCardToInventory(id);if(b.dataset.nfcClientAction==="delete")deleteNfcClientCard(id)});
$("clientDetailBody")?.addEventListener("click",e=>{const b=e.target.closest("[data-open-linked-nfc]");if(b){$("clientDetailDialog")?.close();openNfcDeviceDialog(b.dataset.openLinkedNfc)}});
$("clientDetailBody")?.addEventListener("click", handleDialogAction);
$("clientDetailBody")?.addEventListener("click", async (event)=>{
  const planButton=event.target.closest("[data-draft-base-plan]");if(!planButton)return;
  clientDialogDraft.basePlan=planButton.dataset.draftBasePlan;normalizeDialogDraft(clientDialogDraft);
  const id=$("clientDetailDialog").dataset.cardId;await openClientDialog(id,true);setDialogSaveState();
});
$("clientDetailBody")?.addEventListener("change", async (event) => {
  const walletSelect=event.target.closest("[data-client-feature-select]");
  if(walletSelect){
    const featureKey=walletSelect.dataset.clientFeatureSelect;
    if(walletSelect.value==="inherit") delete clientDialogDraft.featureOverrides[featureKey];
    else clientDialogDraft.featureOverrides[featureKey]=walletSelect.value==="on";
    setDialogSaveState();return;
  }
  const featureInput=event.target.closest("[data-client-feature]");
  if(featureInput){clientDialogDraft.featureOverrides[featureInput.dataset.clientFeature]=featureInput.checked;setDialogSaveState();return;}
  const limitMode=event.target.closest("[data-ai-client-limit-mode]");
  if(limitMode){clientDialogDraft.aiScannerMonthlyLimit={mode:limitMode.value,count:Number(document.querySelector("[data-ai-client-limit-count]")?.value||50)};const count=document.querySelector("[data-ai-client-limit-count]");if(count)count.disabled=limitMode.value!=="number";setDialogSaveState();return;}
  const limitCount=event.target.closest("[data-ai-client-limit-count]");
  if(limitCount){clientDialogDraft.aiScannerMonthlyLimit={mode:"number",count:Math.max(1,Number(limitCount.value||1))};setDialogSaveState();return;}
  const input=event.target.closest("[data-gift-tier]");if(!input)return;
  if(input.dataset.giftTier==="Business"){clientDialogDraft.complimentaryBusiness=input.checked;if(input.checked)clientDialogDraft.complimentaryPremium=false;}
  else {clientDialogDraft.complimentaryPremium=input.checked;if(input.checked)clientDialogDraft.complimentaryBusiness=false;}
  normalizeDialogDraft(clientDialogDraft);const id=$("clientDetailDialog").dataset.cardId;await openClientDialog(id,true);setDialogSaveState();
});



function mergeFeatureControls(raw={}){
  const d=defaultFeatureControls();
  return {enabled:raw.enabled!==false,global:{...d.global,...(raw.global||{})},Basic:{...d.Basic,...(raw.Basic||{})},Premium:{...d.Premium,...(raw.Premium||{})},Business:{...d.Business,...(raw.Business||{})}};
}
function renderFeatureControls(){
  const enabled=$("featureControlsEnabled"); if(enabled) enabled.checked=featureControls.enabled!==false;
  const panels=$("featurePanels"), show=$("showFeaturePanels"); if(panels&&show) panels.hidden=!show.checked;
  const targets={global:$("globalFeatureSwitches"),Basic:$("basicFeatureSwitches"),Premium:$("premiumFeatureSwitches"),Business:$("businessFeatureSwitches")};
  Object.entries(targets).forEach(([group,root])=>{
    if(!root)return; root.innerHTML=FEATURE_DEFS.map(([key,label])=>`<label class="feature-switch-item" data-group="${group}" data-feature="${key}"><span>${label}</span><span class="mini-switch"><input type="checkbox" ${featureControls[group]?.[key]!==false?"checked":""}><i></i></span></label>`).join("");
  });
  updateFeatureDependencyUI();
}
function updateFeatureDependencyUI(){
  const globalRoot=$("globalFeatureSwitches"); if(!globalRoot)return;
  const globals={}; globalRoot.querySelectorAll("[data-feature]").forEach(row=>globals[row.dataset.feature]=row.querySelector("input").checked);
  ["basicFeatureSwitches","premiumFeatureSwitches","businessFeatureSwitches"].forEach(id=>$(id)?.querySelectorAll("[data-feature]").forEach(row=>row.classList.toggle("master-off",globals[row.dataset.feature]===false)));
  document.querySelectorAll("[data-purge-gallery]").forEach(button=>{
    const scope=button.dataset.purgeGallery;
    const root=scope==="Global"?$("globalFeatureSwitches"):scope==="Basic"?$("basicFeatureSwitches"):scope==="Premium"?$("premiumFeatureSwitches"):$("businessFeatureSwitches");
    const galleryRow=root?.querySelector('[data-feature="gallery"]');
    const galleryOff=galleryRow?galleryRow.querySelector("input").checked===false:false;
    button.disabled=!galleryOff;
    button.title=galleryOff?"Permanently delete stored Gallery media for this scope after confirmation.":"Turn Gallery OFF in this scope before a purge can be requested.";
  });
}
function closeExpandedFeaturePanel(){
  const expanded=document.querySelector(".feature-column.is-expanded");
  if(!expanded)return;
  expanded.classList.remove("is-expanded");
  const button=expanded.querySelector("[data-feature-expand]");
  if(button){button.setAttribute("aria-expanded","false");button.title="Expand controls";const icon=button.querySelector("i");if(icon)icon.className="fa-solid fa-expand";}
  const backdrop=$("featureExpandBackdrop");if(backdrop)backdrop.hidden=true;
  document.body.classList.remove("feature-panel-open");
}
function openExpandedFeaturePanel(column){
  if(!column)return;
  const alreadyOpen=column.classList.contains("is-expanded");
  closeExpandedFeaturePanel();
  if(alreadyOpen)return;
  column.classList.add("is-expanded");
  const button=column.querySelector("[data-feature-expand]");
  if(button){button.setAttribute("aria-expanded","true");button.title="Close expanded controls";const icon=button.querySelector("i");if(icon)icon.className="fa-solid fa-xmark";}
  const backdrop=$("featureExpandBackdrop");if(backdrop)backdrop.hidden=false;
  document.body.classList.add("feature-panel-open");
  column.querySelector(".feature-switch-list")?.scrollTo({top:0,behavior:"auto"});
}
function initFeaturePanelExpansion(){
  document.querySelectorAll("[data-feature-expand]").forEach(button=>button.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();openExpandedFeaturePanel(button.closest(".feature-column"));}));
  $("featureExpandBackdrop")?.addEventListener("click",closeExpandedFeaturePanel);
  document.addEventListener("keydown",event=>{if(event.key==="Escape")closeExpandedFeaturePanel();});
}

function collectFeatureControls(){
  const next=defaultFeatureControls(); next.enabled=$("featureControlsEnabled")?.checked!==false;
  [["global","globalFeatureSwitches"],["Basic","basicFeatureSwitches"],["Premium","premiumFeatureSwitches"],["Business","businessFeatureSwitches"]].forEach(([group,id])=>{
    $(id)?.querySelectorAll("[data-feature]").forEach(row=>next[group][row.dataset.feature]=row.querySelector("input").checked);
  });
  return next;
}
async function saveFeatureControls(){
  const status=$("featureControlStatus"),button=$("saveFeatureControls"),next=collectFeatureControls();
  if(button)button.disabled=true;if(status){status.textContent="Saving…";status.className="status"}
  try{
    await setDoc(doc(db,"platform","publicSettings"),{featureControls:next,updatedAt:serverTimestamp()},{merge:true});
    featureControls=next;
    if(status){status.textContent="Feature controls saved successfully.";status.className="status ok"}
  }catch(e){
    console.error(e);
    if(status){status.textContent="Unable to save feature controls.";status.className="status error"}
  }finally{if(button)button.disabled=false}
}

async function loadPlatformSettings(){
  const snap=await getDoc(doc(db,"platform","publicSettings")); const d=snap.exists()?snap.data():{};
  if($("premiumEnabled")) $("premiumEnabled").checked=d.premiumEnabled===true;
  if($("billingEnabled")) $("billingEnabled").checked=d.billingEnabled===true;
  if($("privacyRequired")) $("privacyRequired").checked=d.privacyRequired!==false;
  if($("premiumCheckoutUrl")) $("premiumCheckoutUrl").value=d.premiumCheckoutUrl||"";
  if($("privacyPolicyUrl")) $("privacyPolicyUrl").value=d.privacyPolicyUrl||"";
  if($("privacyAgreementText")) $("privacyAgreementText").value=d.privacyAgreementText||"";
  featureControls=mergeFeatureControls(d.featureControls||{}); renderFeatureControls();
  if($("businessEnabled")) $("businessEnabled").checked=d.business?.enabled===true;
  if($("businessPlanName")) $("businessPlanName").value=d.business?.planName||"JMX Business";
  if($("businessTitle")) $("businessTitle").value=d.business?.title||"Advanced networking for growing businesses";
  if($("businessDescription")) $("businessDescription").value=d.business?.description||"";
  if($("businessPrice")) $("businessPrice").value=d.business?.price||"";
  if($("businessCtaText")) $("businessCtaText").value=d.business?.ctaText||"Get JMX Business";
  if($("businessCtaUrl")) $("businessCtaUrl").value=d.business?.ctaUrl||"";
  if($("businessFeatureList")) $("businessFeatureList").value=(d.business?.features||[]).join("\n");
  if($("businessPrivacy")) $("businessPrivacy").value=d.business?.privacyPolicy||"";
  if($("businessTerms")) $("businessTerms").value=d.business?.terms||"";
  if($("businessPoliciesReady")) $("businessPoliciesReady").checked=d.business?.policiesReady===true;
}

async function saveBusinessSettings(){
  const status=$("businessSettingsStatus");
  const enabled=$("businessEnabled")?.checked===true;
  const business={
    enabled,planName:$("businessPlanName")?.value.trim()||"JMX Business",title:$("businessTitle")?.value.trim()||"",description:$("businessDescription")?.value.trim()||"",price:$("businessPrice")?.value.trim()||"",ctaText:$("businessCtaText")?.value.trim()||"Get JMX Business",ctaUrl:$("businessCtaUrl")?.value.trim()||"",features:($("businessFeatureList")?.value||"").split(/\n+/).map(x=>x.trim()).filter(Boolean),privacyPolicy:$("businessPrivacy")?.value.trim()||"",terms:$("businessTerms")?.value.trim()||"",policiesReady:$("businessPoliciesReady")?.checked===true,updatedAt:new Date().toISOString()
  };
  if(enabled && (!business.policiesReady || !business.privacyPolicy || !business.terms || !business.ctaUrl)){
    if(status){status.textContent="Business cannot be published yet. Add Privacy, Terms, a valid CTA destination, and mark Policies Ready.";status.className="status error";}
    $("businessEnabled").checked=false; business.enabled=false;
  }
  try{await setDoc(doc(db,"platform","publicSettings"),{business,updatedAt:serverTimestamp()},{merge:true});if(status){status.textContent=business.enabled?"Business settings saved and public visibility enabled.":"Business settings saved. Public Business remains hidden.";status.className="status ok";}}catch(e){console.error(e);if(status){status.textContent="Could not save Business settings.";status.className="status error";}}
}

async function savePlatformSettings(){
  const payload={premiumEnabled:$("premiumEnabled")?.checked===true,billingEnabled:$("billingEnabled")?.checked===true,privacyRequired:$("privacyRequired")?.checked!==false,premiumCheckoutUrl:$("premiumCheckoutUrl")?.value.trim()||"",privacyPolicyUrl:$("privacyPolicyUrl")?.value.trim()||"",privacyAgreementText:$("privacyAgreementText")?.value.trim()||"",updatedAt:serverTimestamp()};
  const status=$("platformStatus");
  try{await setDoc(doc(db,"platform","publicSettings"),payload,{merge:true});if(status){status.textContent="Platform settings saved.";status.className="status ok"}}catch(e){console.error(e);if(status){status.textContent="Could not save platform settings.";status.className="status error"}}
}

const purgeGalleryMediaCall=httpsCallable(functions,"purgeGalleryMedia");
async function requestGalleryPurge(scope){
  const status=$("featureControlStatus");
  try{
    if(status){status.textContent=`Checking ${scope} Gallery media…`;status.className="status"}
    const preview=(await purgeGalleryMediaCall({scope,dryRun:true})).data||{};
    const cards=Number(preview.cardsAffected||0),files=Number(preview.storageObjects||0);
    if(!cards&&!files){if(status){status.textContent=`No stored Gallery media found for ${scope}.`;status.className="status ok"}return}
    const warning=`This will permanently delete Gallery media for ${cards} affected card${cards===1?"":"s"} (${files} stored file${files===1?"":"s"}) in ${scope}. Profile photos, covers, logos, catalogs, Card IDs and activation codes are not touched. This cannot be undone. Continue?`;
    if(!confirm(warning)){if(status){status.textContent="Gallery purge canceled.";status.className="status"}return}
    const typed=prompt(`Type ${scope.toUpperCase()} to confirm permanent Gallery deletion for this scope.`);
    if(typed!==scope.toUpperCase()){if(status){status.textContent="Gallery purge canceled: confirmation did not match.";status.className="status error"}return}
    if(status){status.textContent=`Deleting ${scope} Gallery media…`;status.className="status"}
    const result=(await purgeGalleryMediaCall({scope,dryRun:false,confirmation:"PURGE_GALLERY_MEDIA"})).data||{};
    if(status){status.textContent=`Gallery purge complete: ${Number(result.cardsAffected||0)} cards processed, ${Number(result.storageObjectsDeleted||0)} stored files deleted.`;status.className="status ok"}
  }catch(e){console.error(e);if(status){status.textContent="Gallery purge failed. No other card/profile data was intentionally removed.";status.className="status error"}}
}
const aiScannerHealthCall=httpsCallable(functions,"aiScannerHealth");
const aiScannerSummaryCall=httpsCallable(functions,"getAiScannerAdminSummary");
const saveAiScannerAdminConfigCall=httpsCallable(functions,"saveAiScannerAdminConfig");
const scanBusinessCardCall=httpsCallable(functions,"scanBusinessCard");
let aiScannerAdminConfig={externalServicesAllowed:false,ocrProvider:"googleVision",aiParsingProvider:"basic",limits:{Basic:{mode:"disabled",count:0},Premium:{mode:"disabled",count:0},Business:{mode:"disabled",count:0}}};
function aiLimitFromUi(plan){const mode=$("aiLimit"+plan+"Mode")?.value||"disabled";return{mode,count:Math.max(0,Number($("aiLimit"+plan+"Count")?.value||0))}}
function renderAiScannerAdminConfig(){
  if($("aiKillSwitch"))$("aiKillSwitch").checked=aiScannerAdminConfig.externalServicesAllowed===true;
  ["Basic","Premium","Business"].forEach(plan=>{const lim=aiScannerAdminConfig.limits?.[plan]||{mode:"disabled",count:0};if($("aiLimit"+plan+"Mode"))$("aiLimit"+plan+"Mode").value=lim.mode||"disabled";if($("aiLimit"+plan+"Count")){$("aiLimit"+plan+"Count").value=Number(lim.count||50);$("aiLimit"+plan+"Count").disabled=lim.mode!=="number";}});
  const state=$("aiKillSwitchState");if(state){const on=aiScannerAdminConfig.externalServicesAllowed===true;state.textContent=on?"External AI Services: ACTIVE":"External AI Services: BLOCKED";state.className="ai-kill-state "+(on?"active":"blocked");}
}
async function loadAiScannerAdmin(){
  try{
    const r=(await aiScannerSummaryCall({})).data;
    const cfg=r?.config||{};
    aiScannerAdminConfig={...aiScannerAdminConfig,...cfg,limits:{...aiScannerAdminConfig.limits,...(cfg.limits||{})}};
    renderAiScannerAdminConfig();
    renderAiScannerUsage(r);
  }catch(e){
    console.warn("AI Scanner admin configuration unavailable",{code:e?.code||"unknown",message:e?.message||String(e),operation:"loadAiScannerAdmin",source:"getAiScannerAdminSummary",authenticated:!!auth.currentUser});
    const st=$("aiScannerAdminStatus");if(st){st.textContent="AI Scanner configuration could not be loaded.";st.className="status error";}
  }
}
async function saveAiScannerAdmin(){
  const nextOn=$("aiKillSwitch")?.checked===true;
  if(aiScannerAdminConfig.externalServicesAllowed===true&&!nextOn&&!confirm("Disable external AI services? This stops new billable AI Card Scanner requests until you turn them back on.")){if($("aiKillSwitch"))$("aiKillSwitch").checked=true;return;}
  const status=$("aiScannerAdminStatus");if(status){status.textContent="Saving AI Scanner settings…";status.className="status";}
  const payload={externalServicesAllowed:nextOn,ocrProvider:"googleVision",aiParsingProvider:"basic",limits:{Basic:aiLimitFromUi("Basic"),Premium:aiLimitFromUi("Premium"),Business:aiLimitFromUi("Business")}};
  try{
    const result=(await saveAiScannerAdminConfigCall(payload)).data;
    const saved=result?.config||payload;
    aiScannerAdminConfig={...aiScannerAdminConfig,...saved,limits:{...aiScannerAdminConfig.limits,...(saved.limits||payload.limits)}};
    renderAiScannerAdminConfig();
    if(status){status.textContent="AI Scanner settings saved successfully.";status.className="status ok";}
  }catch(e){
    console.error("AI Scanner settings save failed",{code:e?.code||"unknown",message:e?.message||String(e),operation:"saveAiScannerAdmin",documentPath:"platform/aiScanner",authenticated:!!auth.currentUser,uidPresent:!!auth.currentUser?.uid});
    if(status){status.textContent="Unable to save AI Scanner settings. Please try again.";status.className="status error";}
  }
}
async function checkAiScannerConnection(){
  const status=$("aiScannerProviderStatus");if(status)status.textContent="Checking configuration…";
  try{const r=(await aiScannerHealthCall({})).data;const o=$("aiOcrProviderState"),a=$("aiParsingProviderState");if(o)o.textContent=`${r.ocr.provider}: ${r.ocr.status}`;if(a)a.textContent=`${r.aiParsing.provider}: ${r.aiParsing.status}`;if(status)status.textContent=r.externalServicesAllowed?"Provider configuration is ready for a live scan test.":"Kill Switch is OFF. External calls are blocked.";}
  catch(e){console.error(e);if(status)status.textContent="Provider check failed: "+(e?.message||"unknown error");}
}
function renderAiScannerUsage(r={}){const u=r.usage||{};if($("aiUsageMonth"))$("aiUsageMonth").textContent=r.month||"—";if($("aiUsageTotal"))$("aiUsageTotal").textContent=Number(u.totalScans||0).toLocaleString();if($("aiUsageSuccess"))$("aiUsageSuccess").textContent=Number(u.successfulScans||0).toLocaleString();if($("aiUsageFailed"))$("aiUsageFailed").textContent=Number(u.failedScans||0).toLocaleString();if($("aiUsageOcr"))$("aiUsageOcr").textContent=Number(u.ocrRequests||0).toLocaleString();if($("aiUsageBasic"))$("aiUsageBasic").textContent=Number(u.planScans?.Basic||0).toLocaleString();if($("aiUsagePremium"))$("aiUsagePremium").textContent=Number(u.planScans?.Premium||0).toLocaleString();if($("aiUsageBusiness"))$("aiUsageBusiness").textContent=Number(u.planScans?.Business||0).toLocaleString();}
async function refreshAiScannerAdminSummary(){
  try{const r=(await aiScannerSummaryCall({})).data;renderAiScannerUsage(r);}
  catch(e){console.warn("AI Scanner usage unavailable",{code:e?.code||"unknown",message:e?.message||String(e),operation:"refreshAiScannerAdminSummary",authenticated:!!auth.currentUser});}
}
function fileToCompressedBase64(file,maxW=1600,maxH=1100,quality=.82){return new Promise((resolve,reject)=>{if(!file||!/^image\/(jpeg|png|webp)$/i.test(file.type))return reject(new Error("Choose a JPG, PNG, or WebP image."));if(file.size>12*1024*1024)return reject(new Error("Image must be under 12 MB."));const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{const scale=Math.min(1,maxW/img.naturalWidth,maxH/img.naturalHeight),c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);resolve(c.toDataURL("image/jpeg",quality).split(",")[1]);};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Could not read image."));};img.src=url;});}
async function runAdminAiScannerTest(){const cardId=cleanCode($("aiTestCardId")?.value||"");const file=$("aiTestImage")?.files?.[0],status=$("aiTestStatus");if(!cardId||!file){if(status)status.textContent="Enter a test Card ID and choose a business card image.";return;}if(status)status.textContent="Running Test Mode OCR…";try{const imageBase64=await fileToCompressedBase64(file);const r=(await scanBusinessCardCall({cardId,imageBase64,testMode:true})).data;if(status)status.textContent=`Test successful: ${r.contact?.fullName||"contact detected"}. Test Mode did not create Leads or production usage.`;await checkAiScannerConnection();}catch(e){console.error(e);if(status)status.textContent="Test failed: "+(e?.message||"unknown error");}}
function initAiScannerAdmin(){
  $("saveAiScannerSettings")?.addEventListener("click",saveAiScannerAdmin);$("checkAiScannerConnection")?.addEventListener("click",checkAiScannerConnection);$("testAiScanner")?.addEventListener("click",runAdminAiScannerTest);$("refreshAiUsage")?.addEventListener("click",refreshAiScannerAdminSummary);
  ["Basic","Premium","Business"].forEach(plan=>$("aiLimit"+plan+"Mode")?.addEventListener("change",e=>{const input=$("aiLimit"+plan+"Count");if(input)input.disabled=e.target.value!=="number";}));
  $("aiKillSwitch")?.addEventListener("change",e=>{const state=$("aiKillSwitchState");if(state){state.textContent=e.target.checked?"External AI Services: ACTIVE":"External AI Services: BLOCKED";state.className="ai-kill-state "+(e.target.checked?"active":"blocked");}});
}

function initMarketing(){
  const q=$("companyQrAdmin");if(q&&window.QRCode){q.innerHTML="";new QRCode(q,{text:"https://jmxdigitalcard.com/",width:140,height:140,colorDark:"#111111",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.H})}
  $("copyCompanyUrl")?.addEventListener("click",async()=>{await copyText("https://jmxdigitalcard.com/");$("copyCompanyUrl").textContent="Copied JMX URL";setTimeout(()=>$("copyCompanyUrl").innerHTML='<i class="fa-solid fa-copy"></i> Copy JMX URL',1200)});
  $("savePlatformButton")?.addEventListener("click",savePlatformSettings);
  initFeaturePanelExpansion();
  $("saveFeatureControls")?.addEventListener("click",saveFeatureControls);
  $("saveBusinessSettings")?.addEventListener("click",saveBusinessSettings);
  $("businessKpiCard")?.addEventListener("click",()=>{if($("planFilter")){$("planFilter").value="Business";render();document.querySelector(".client-plan-board")?.scrollIntoView({behavior:"smooth",block:"start"});}});
  $("showFeaturePanels")?.addEventListener("change",e=>{if($("featurePanels"))$("featurePanels").hidden=!e.target.checked;if(!e.target.checked)closeExpandedFeaturePanel();});
  $("globalFeatureSwitches")?.addEventListener("change",updateFeatureDependencyUI);
  ["basicFeatureSwitches","premiumFeatureSwitches","businessFeatureSwitches"].forEach(id=>$(id)?.addEventListener("change",updateFeatureDependencyUI));
  document.querySelectorAll("[data-purge-gallery]").forEach(button=>button.addEventListener("click",()=>requestGalleryPurge(button.dataset.purgeGallery)));
}

initMarketing();
initAiScannerAdmin();

onAuthStateChanged(auth, async (currentUser) => {
  user = currentUser || null;
  $("loginGate").hidden = Boolean(currentUser);
  $("dashboardContent").hidden = !currentUser;
  $("logoutButton").hidden = !currentUser;
  if (!currentUser) return setLoginStatus("");
  try {
    if (!(await isAdmin(currentUser))) {
      await signOut(auth);
      return setLoginStatus("This account is not the JMX platform administrator.", "error");
    }
    await Promise.all([loadCards(),loadPlatformSettings(),loadAiScannerAdmin()]);
  } catch (error) {
    console.error(error);
    setLoginStatus("Could not load dashboard: " + error.message, "error");
  }
});

// ===== Official JMX NFC Device-ID inventory / batch system — Sep 2026 =====
let nfcDevices=[];
let nfcBatches=[];
let nfcEncoderBatchId=null;
let nfcEncoderIndex=0;
let expandedNfcBox=null;
let nfcBackdrop=null;
const NFC_TYPE_LABELS={card:"NFC Card",sticker:"NFC Sticker",keychain:"NFC Keychain",bracelet:"NFC Bracelet",ring:"NFC Ring",plate:"NFC Plate",tag:"NFC Tag",other:"Other / Custom"};
const NFC_QUICK_TYPES={"card-pvc":{deviceType:"card",material:"PVC"},"card-metal":{deviceType:"card",material:"Metal"}};
function nfcRandom(prefix,length=12){return `${prefix}-${randomCode(length)}`}
function nfcStatusClass(s){return s==="active"?"":s==="available"?"available":"disabled"}
function nfcDeviceUrl(id){return `https://jmxdigitalcard.com/d/${encodeURIComponent(id)}`}
function nfcRecordSearchText(d){const c=cards.find(x=>x.id===d.cardId)||{},b=nfcBatches.find(x=>x.batchId===d.batchId)||{};return [d.deviceId,d.batchId,d.activationCode,b.activationCode,d.deviceType,d.material,d.plan,d.status,d.notes,d.cardId,c.profile?.fullName,c.profile?.company,c.profile?.email,c.profile?.phone,c.profile?.phone2,c.owner?.ownerEmail,c.admin?.clientName,c.admin?.notes].filter(Boolean).join(" ").toLowerCase()}
function nfcBatchSearchText(b){const c=cards.find(x=>x.id===b.cardId)||{};return [b.batchId,b.activationCode,b.deviceType,b.status,b.notes,b.cardId,c.profile?.fullName,c.profile?.company,c.profile?.email,c.profile?.phone,c.owner?.ownerEmail,c.admin?.clientName,c.admin?.notes].filter(Boolean).join(" ").toLowerCase()}
async function loadNfcData(){
  try{
    const [d,b]=await Promise.all([getDocs(collection(db,"nfcDevices")),getDocs(collection(db,"nfcBatches"))]);
    nfcDevices=d.docs.map(x=>({id:x.id,...x.data(),deviceId:x.data().deviceId||x.id}));
    nfcBatches=b.docs.map(x=>({id:x.id,...x.data(),batchId:x.data().batchId||x.id}));
    renderNfcCenter();
  }catch(e){console.error("NFC Device Center load failed",e)}
}
function nfcClientSearchText(card){return [cardSearchText(card),effectivePlan(card),card.admin?.notes,card.inventory?.notes].filter(Boolean).join(" ").toLowerCase()}
function nfcClientPlanMarkup(items){
  return items.map(card=>{
    const devices=nfcDevices.filter(d=>d.cardId===card.id);
    const name=card.profile?.fullName||card.admin?.clientName||card.owner?.ownerEmail||card.id;
    const company=card.profile?.company&&card.profile.company!==name?card.profile.company:"";
    const phone=card.profile?.phone||"",email=card.profile?.email||card.owner?.ownerEmail||"";
    return `<button class="nfc-record nfc-client-plan-record" type="button" data-nfc-client="${esc(card.id)}"><span><strong>${esc(name)}</strong><small>${company?esc(company)+" · ":""}${esc(phone||email||effectivePlan(card))}</small><small class="nfc-client-plan-meta">NFC Card: ${devices.some(d=>d.status==="active")?"Active":devices.some(d=>["suspended","disabled"].includes(d.status))?"Suspended":"Linked"}</small></span><span class="nfc-client-open-pill">OPEN</span></button>`;
  }).join("");
}
function renderNfcPlanClients(){
  if(!$("nfcPlanClientBoard"))return;
  const officialCardIds=new Set(nfcDevices.filter(d=>d.cardId).map(d=>d.cardId));
  const activeCards=cards.filter(c=>officialCardIds.has(c.id)&&["activated","suspended"].includes(c.status));
  const buckets={Basic:activeCards.filter(c=>effectivePlan(c)==="Basic"),Premium:activeCards.filter(c=>effectivePlan(c)==="Premium"),Business:activeCards.filter(c=>effectivePlan(c)==="Business")};
  const configs=[
    ["Basic","nfcBasicClientsCount","nfcBasicClientsSearch","nfcBasicClientsList"],
    ["Premium","nfcPremiumClientsCount","nfcPremiumClientsSearch","nfcPremiumClientsList"],
    ["Business","nfcBusinessClientsCount","nfcBusinessClientsSearch","nfcBusinessClientsList"]
  ];
  for(const [plan,countId,searchId,listId] of configs){
    const all=buckets[plan],q=$(searchId)?.value.trim().toLowerCase()||"",filtered=all.filter(c=>!q||nfcClientSearchText(c).includes(q));
    $(countId).textContent=all.length;
    $(listId).innerHTML=filtered.length?nfcClientPlanMarkup(filtered):'<div class="inventory-pool-empty compact">No matching clients in this plan.</div>';
  }
  document.querySelectorAll("[data-nfc-client]").forEach(b=>b.onclick=()=>openClientDialog(b.dataset.nfcClient));
}
function nfcListMarkup(items,isBatch=false){
  return items.map(item=>{
    const id=isBatch?item.batchId:item.deviceId;
    const type=NFC_TYPE_LABELS[item.deviceType]||item.deviceType||"NFC Device";
    const c=cards.find(x=>x.id===item.cardId);const owner=c?.profile?.fullName||c?.admin?.clientName||c?.owner?.ownerEmail||item.cardId||"Unassigned";
    const sub=isBatch?`${item.quantity||0} devices · ${item.activationCode||"No activation code"}`:`${item.batchId||"No batch"} · ${owner}`;
    return `<button class="nfc-record" type="button" data-${isBatch?"nfc-batch":"nfc-device"}="${esc(id)}"><span><strong>${esc(id)}</strong><small>${esc(type)} · ${esc(sub)}</small></span><span class="nfc-device-status-pill ${nfcStatusClass(item.status)}">${esc(item.status||"available")}</span></button>`;
  }).join("");
}
function nfcSimpleCardMarkup(items,state){
  return items.slice(0,6).map(d=>{const batch=nfcBatches.find(b=>b.batchId===d.batchId)||{},note=d.notes||batch.notes||"NFC Card",plan=d.plan||batch.plan||"Basic";return `<div class="nfc-record nfc-simple-card-record"><button type="button" class="nfc-simple-card-main" data-nfc-device="${esc(d.deviceId)}"><span><strong>${esc(note)}</strong><small>${esc(plan)} · ${state==="sold"?"NOT ACTIVATED":"Available"}</small></span></button><div class="nfc-simple-card-actions">${state==="available"?`<button class="mini" type="button" data-mark-nfc-sold="${esc(d.deviceId)}">Mark as Sold</button>`:""}<button class="mini" type="button" data-nfc-device="${esc(d.deviceId)}">View</button></div></div>`}).join("")||'<div class="inventory-pool-empty compact">No cards in this section.</div>';
}
function renderNfcCenter(){
  if(!$("nfcDeviceCenter"))return;
  const cardsOnly=nfcDevices.filter(x=>x.deviceType==="card");
  const available=cardsOnly.filter(x=>["available","pending"].includes(x.status)&&!x.cardId),sold=cardsOnly.filter(x=>x.status==="sold"&&!x.cardId);
  $("nfcDeviceTotal").textContent=cardsOnly.length;$("nfcDeviceAvailable").textContent=available.length;$("nfcDeviceActive").textContent=cardsOnly.filter(x=>x.status==="active").length;$("nfcDeviceDisabled").textContent=cardsOnly.filter(x=>["disabled","suspended","lost","stolen","retired","archived"].includes(x.status)).length;$("nfcBatchTotal").textContent=nfcBatches.length;
  const aq=$("nfcAvailableCardsSearch")?.value.trim().toLowerCase()||"",sq=$("nfcSoldCardsSearch")?.value.trim().toLowerCase()||"";
  $("nfcAvailableCardsCount").textContent=available.length;$("nfcSoldCardsCount").textContent=sold.length;
  $("nfcAvailableCardsList").innerHTML=nfcSimpleCardMarkup(available.filter(x=>!aq||nfcRecordSearchText(x).includes(aq)),"available");$("nfcSoldCardsList").innerHTML=nfcSimpleCardMarkup(sold.filter(x=>!sq||nfcRecordSearchText(x).includes(sq)),"sold");
  document.querySelectorAll("[data-nfc-device]").forEach(b=>b.onclick=()=>openNfcDeviceDialog(b.dataset.nfcDevice));document.querySelectorAll("[data-mark-nfc-sold]").forEach(b=>b.onclick=()=>markNfcCardSold(b.dataset.markNfcSold));
  renderNfcPlanClients();renderNfcGlobalSearch();
}
async function markNfcCardSold(deviceId){const d=nfcDevices.find(x=>x.deviceId===deviceId);if(!d)return;if(!confirm("Mark this NFC card as SOLD and waiting for customer activation?"))return;const wb=writeBatch(db),now=serverTimestamp();wb.set(doc(db,"nfcDevices",deviceId),{status:"sold",lifecycleStatus:"sold",soldAt:now,updatedAt:now},{merge:true});wb.set(doc(db,"nfcDevicePublic",deviceId),{status:"sold",updatedAt:now},{merge:true});if(d.batchId)wb.set(doc(db,"nfcBatches",d.batchId),{status:"sold",soldAt:now,updatedAt:now},{merge:true});await wb.commit();await loadNfcData();}
function renderNfcGlobalSearch(){
  const q=$("nfcGlobalSearch")?.value.trim().toLowerCase()||"",box=$("nfcGlobalResults");if(!box)return;if(!q){box.hidden=true;box.innerHTML="";return}
  const dm=nfcDevices.filter(x=>nfcRecordSearchText(x).includes(q)).slice(0,10),bm=nfcBatches.filter(x=>nfcBatchSearchText(x).includes(q)).slice(0,10),officialIds=new Set(nfcDevices.filter(d=>d.cardId).map(d=>d.cardId)),cm=cards.filter(x=>officialIds.has(x.id)&&cardSearchText(x).includes(q)).slice(0,10);
  const results=[...cm.map(c=>({kind:"client",id:c.id,title:c.profile?.fullName||c.admin?.clientName||c.owner?.ownerEmail||c.id,sub:`${c.id} · ${effectivePlan(c)} · ${c.status||""}`})),...bm.map(b=>({kind:"batch",id:b.batchId,title:b.batchId,sub:`${NFC_TYPE_LABELS[b.deviceType]||b.deviceType} · ${b.activationCode||""} · ${b.cardId||"Unassigned"}`})),...dm.map(d=>({kind:"device",id:d.deviceId,title:d.deviceId,sub:`${NFC_TYPE_LABELS[d.deviceType]||d.deviceType} · ${d.batchId||""} · ${d.cardId||"Unassigned"}`}))].slice(0,20);
  box.hidden=false;box.innerHTML=`<div class="master-search-results-head"><strong>${results.length} result${results.length===1?"":"s"}</strong><span class="subtitle small">Clients + Device IDs + Batch IDs + activation codes</span></div><div class="master-search-result-list">${results.length?results.map(r=>`<button class="master-search-result" type="button" data-nfc-search-kind="${r.kind}" data-nfc-search-id="${esc(r.id)}"><span><strong>${esc(r.title)}</strong><small>${esc(r.sub)}</small></span><span class="master-search-category">${r.kind.toUpperCase()}</span></button>`).join(""):'<div class="inventory-pool-empty compact">No matching client, batch or device.</div>'}</div>`;
  box.querySelectorAll("[data-nfc-search-kind]").forEach(b=>b.onclick=()=>{if(b.dataset.nfcSearchKind==="client")openClientDialog(b.dataset.nfcSearchId);else if(b.dataset.nfcSearchKind==="batch")openNfcBatchDetails(b.dataset.nfcSearchId);else openNfcDeviceDialog(b.dataset.nfcSearchId)});
}
function refreshNfcBatchForm(){
  if(!$("nfcBatchId"))return;$("nfcBatchId").value=nfcRandom("BATCH",8);$("nfcBatchActivationCode").value=nfcRandom("ACT",8);const sel=$("nfcBatchCardId");if(sel)sel.innerHTML='<option value="">Keep Available / Unassigned</option>'+cards.filter(c=>["activated","suspended"].includes(c.status)).map(c=>`<option value="${esc(c.id)}">${esc(c.profile?.fullName||c.admin?.clientName||c.owner?.ownerEmail||c.id)} — ${esc(c.id)} (${esc(effectivePlan(c))})</option>`).join("")
}
function openNfcBatchCreate(){refreshNfcBatchForm();$("nfcBatchStatus").textContent="";$("nfcBatchDialog")?.showModal()}
function openNfcQuickDeviceCreate(){
  $("nfcQuickDeviceNotes").value="";$("nfcQuickDeviceStatus").textContent="";$("nfcQuickDeviceDialog")?.showModal();
}
async function createNfcQuickDevice(e){
  e.preventDefault();
  const choice=NFC_QUICK_TYPES[$("nfcQuickDeviceType")?.value]||NFC_QUICK_TYPES["card-pvc"],plan=$("nfcQuickDevicePlan")?.value||"Basic",notes=$("nfcQuickDeviceNotes")?.value.trim()||"",statusEl=$("nfcQuickDeviceStatus"),button=$("createNfcQuickDeviceButton");
  const deviceId=nfcRandom("JMX",14),batchId=nfcRandom("BATCH",8),activationCode=nfcRandom("ACT",8);button.disabled=true;button.textContent="Creating…";statusEl.textContent="Creating Device ID and activation code…";
  try{
  {
      const wb=writeBatch(db),now=serverTimestamp();
      wb.set(doc(db,"nfcBatches",batchId),{batchId,activationCode,activationMode:"individual-device",deviceType:choice.deviceType,material:choice.material,quantity:1,plan,cardId:null,status:"available",enabled:true,notes,activationCodeStatus:"unused",encodingStatus:"not-started",encodedCount:0,createdBy:user?.uid||"",createdAt:now,updatedAt:now});
      wb.set(doc(db,"nfcDevices",deviceId),{deviceId,batchId,activationCodeRef:batchId,deviceType:choice.deviceType,material:choice.material,plan,deviceNumber:1,cardId:null,status:"available",lifecycleStatus:"available",enabled:true,deviceEnabled:true,tapCount:0,encodingStatus:"not-encoded",notes,createdAt:now,updatedAt:now});
      wb.set(doc(db,"nfcDevicePublic",deviceId),{deviceId,batchId,deviceType:choice.deviceType,material:choice.material,plan,status:"available",enabled:true,updatedAt:now});await wb.commit();await loadNfcData();
    }
    statusEl.innerHTML=`Created <strong>${esc(deviceId)}</strong> · Activation Code <strong>${esc(activationCode)}</strong>`;
    await copyText(nfcDeviceUrl(deviceId));
    setTimeout(()=>{$("nfcQuickDeviceDialog")?.close();openNfcBatchEncoder(batchId)},650);
  }catch(err){console.error(err);statusEl.textContent="Could not create device: "+(err?.message||"unknown error")}
  finally{button.disabled=false;button.textContent="Create Device"}
}
async function createNfcBatch(e){
  e.preventDefault();const quantity=Math.max(1,Math.min(5000,Number($("nfcBatchQuantity").value||1))),deviceType="card",batchId=$("nfcBatchId").value,activationCode=$("nfcBatchActivationCode").value,cardId=null,plan=$("nfcBatchPlan")?.value||"Basic",notes=$("nfcBatchNotes").value.trim(),statusEl=$("nfcBatchStatus");statusEl.textContent=`Creating ${quantity} devices…`;
  const deviceIds=[];for(let i=0;i<quantity;i++)deviceIds.push(nfcRandom("JMX",14));const initialStatus=cardId?"pending":"available";
  if((await getDoc(doc(db,"nfcBatches",batchId))).exists()){statusEl.textContent="Batch ID already exists. Generate another.";return}
  const now=serverTimestamp();
  try{
    await setDoc(doc(db,"nfcBatches",batchId),{batchId,activationCode,deviceType,quantity,plan,cardId:null,status:initialStatus,enabled:true,notes,activationCodeStatus:"unused",encodingStatus:"not-started",encodedCount:0,createdBy:user?.uid||"",createdAt:now,updatedAt:now});
    for(let start=0;start<deviceIds.length;start+=180){const wb=writeBatch(db);for(const [offset,deviceId] of deviceIds.slice(start,start+180).entries()){const deviceNumber=start+offset+1;wb.set(doc(db,"nfcDevices",deviceId),{deviceId,batchId,deviceType,deviceNumber,plan,cardId:null,status:initialStatus,enabled:true,tapCount:0,encodingStatus:"not-encoded",notes:"",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});wb.set(doc(db,"nfcDevicePublic",deviceId),{deviceId,batchId,deviceType,plan,cardId:null,status:initialStatus,enabled:true,updatedAt:serverTimestamp()})}await wb.commit()}
    statusEl.textContent=`Created ${quantity} ${NFC_TYPE_LABELS[deviceType]||deviceType}(s). Activation code: ${activationCode}`;await copyText(activationCode);setTimeout(()=>{$("nfcBatchDialog")?.close();openNfcBatchEncoder(batchId)},700);await loadNfcData();
  }catch(err){console.error(err);statusEl.textContent="Could not create the batch: "+(err?.message||"unknown error")}
}
function closeNfcExpanded(){if(!expandedNfcBox)return;expandedNfcBox.classList.remove("is-expanded");expandedNfcBox.querySelector("[data-nfc-expand]")?.setAttribute("aria-expanded","false");nfcBackdrop?.remove();nfcBackdrop=null;expandedNfcBox=null;document.body.classList.remove("nfc-device-panel-open")}
function expandNfcBox(key){const box=document.querySelector(`[data-nfc-box="${key}"]`);if(!box)return;if(expandedNfcBox===box)return closeNfcExpanded();closeNfcExpanded();expandedNfcBox=box;box.classList.add("is-expanded");nfcBackdrop=document.createElement("div");nfcBackdrop.className="nfc-device-backdrop";nfcBackdrop.onclick=closeNfcExpanded;document.body.appendChild(nfcBackdrop);document.body.classList.add("nfc-device-panel-open")}
async function setNfcDeviceEnabled(deviceId,enabled){const d=nfcDevices.find(x=>x.deviceId===deviceId);if(!d)return;const batch=nfcBatches.find(x=>x.batchId===d.batchId);const restored=d.cardId?(batch?.activationCodeStatus==="used"?"active":"pending"):"available";const status=enabled?restored:"disabled";const wb=writeBatch(db);wb.set(doc(db,"nfcDevices",deviceId),{enabled,status,updatedAt:serverTimestamp()},{merge:true});wb.set(doc(db,"nfcDevicePublic",deviceId),{enabled,status,updatedAt:serverTimestamp()},{merge:true});await wb.commit();await loadNfcData()}
async function setNfcBatchEnabled(batchId,enabled){
  const batch=nfcBatches.find(x=>x.batchId===batchId);if(!batch)return;
  const affected=nfcDevices.filter(x=>x.batchId===batchId);
  const terminal=new Set(["lost","stolen","replaced","retired","archived"]);
  const batchStatus=enabled?(batch.cardId?(batch.activationCodeStatus==="used"?"active":"pending"):"available"):"disabled";
  await setDoc(doc(db,"nfcBatches",batchId),{enabled,status:batchStatus,updatedAt:serverTimestamp()},{merge:true});
  for(let i=0;i<affected.length;i+=180){
    const wb=writeBatch(db);
    affected.slice(i,i+180).forEach(d=>{
      const lifecycle=String(d.lifecycleStatus||d.status||"").toLowerCase();
      const preserve=terminal.has(lifecycle);
      const ownEnabled=d.deviceEnabled!==false && d.enabled!==false && !preserve;
      const restored=d.cardId?(batch.activationCodeStatus==="used"?"active":"pending"):"available";
      const status=preserve?lifecycle:(enabled?restored:"disabled");
      const publicEnabled=enabled&&ownEnabled;
      wb.set(doc(db,"nfcDevices",d.deviceId),{batchEnabled:enabled,status:preserve?lifecycle:status,updatedAt:serverTimestamp()},{merge:true});
      wb.set(doc(db,"nfcDevicePublic",d.deviceId),{enabled:publicEnabled,status:preserve?lifecycle:status,updatedAt:serverTimestamp()},{merge:true});
    });
    await wb.commit();
  }
  await setDoc(doc(db,"nfcDeviceEvents",`${Date.now()}-${batchId}`),{event:enabled?"Batch Reactivated":"Batch Disabled",batchId,adminUid:user?.uid||"",createdAt:serverTimestamp()});
  await loadNfcData();
}
async function assignNfcBatch(batchId,cardId){
  const b=nfcBatches.find(x=>x.batchId===batchId);if(!b||!cardId)return;const target=cards.find(c=>c.id===cardId);if(!target)return alert("Card/Profile not found.");
  const items=nfcDevices.filter(x=>x.batchId===batchId),normalStatus=b.activationCodeStatus==="used"?"active":"pending",terminal=new Set(["lost","stolen","replaced","retired","archived"]),previousCardId=b.cardId||null;
  await setDoc(doc(db,"nfcBatches",batchId),{cardId,status:normalStatus,updatedAt:serverTimestamp()},{merge:true});
  for(let i=0;i<items.length;i+=180){const wb=writeBatch(db);items.slice(i,i+180).forEach(d=>{const life=String(d.lifecycleStatus||d.status||"").toLowerCase(),keep=terminal.has(life),status=keep?life:normalStatus,enabled=keep?false:d.enabled!==false;wb.set(doc(db,"nfcDevices",d.deviceId),{cardId,status,lifecycleStatus:status,enabled,updatedAt:serverTimestamp()},{merge:true});wb.set(doc(db,"nfcDevicePublic",d.deviceId),{cardId,status,enabled,updatedAt:serverTimestamp()},{merge:true})});await wb.commit()}
  await setDoc(doc(db,"nfcDeviceEvents",`${Date.now()}-${batchId}`),{event:previousCardId&&previousCardId!==cardId?"Batch Transferred":"Batch Assigned",batchId,previousCardId,cardId,adminUid:user?.uid||"",createdAt:serverTimestamp()});await Promise.all([loadNfcData(),loadCards()])
}
async function replaceNfcDevice(deviceId){
  const d=nfcDevices.find(x=>x.deviceId===deviceId);if(!d)return;if(!confirm(`Replace ${deviceId}? The old Device ID will be retired and a brand-new ID will be created.`))return;
  const next=nfcRandom("JMX",14),batch=nfcBatches.find(x=>x.batchId===d.batchId),status=d.cardId?(batch?.activationCodeStatus==="used"?"active":"pending"):"available",wb=writeBatch(db);
  wb.set(doc(db,"nfcDevices",deviceId),{enabled:false,deviceEnabled:false,status:"replaced",lifecycleStatus:"replaced",replacedBy:next,updatedAt:serverTimestamp()},{merge:true});
  wb.set(doc(db,"nfcDevicePublic",deviceId),{enabled:false,status:"replaced",updatedAt:serverTimestamp()},{merge:true});
  const clean={...d};delete clean.lifecycleStatus;delete clean.replacedBy;delete clean.deviceEnabled;delete clean.replaces;
  wb.set(doc(db,"nfcDevices",next),{...clean,deviceId:next,status,lifecycleStatus:status,enabled:true,deviceEnabled:true,replaces:deviceId,tapCount:0,encodingStatus:"not-encoded",createdAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:false});
  wb.set(doc(db,"nfcDevicePublic",next),{deviceId:next,batchId:d.batchId||null,deviceType:d.deviceType,cardId:d.cardId||null,status,enabled:true,updatedAt:serverTimestamp()},{merge:false});
  wb.set(doc(db,"nfcDeviceEvents",`${Date.now()}-${next}`),{event:"Device Replaced",deviceId:next,previousDeviceId:deviceId,batchId:d.batchId||null,cardId:d.cardId||null,adminUid:user?.uid||"",createdAt:serverTimestamp()});await wb.commit();await loadNfcData();alert(`Replacement created: ${next}`)
}
async function setClientNfcTypeEnabled(cardId,type,enabled){
  const card=cards.find(c=>c.id===cardId);const controls={...(card?.nfcDeviceControls||{}),[type]:enabled};
  await setDoc(doc(db,"cards",cardId),{nfcDeviceControls:controls,updatedAt:serverTimestamp()},{merge:true});
  await setDoc(doc(db,"nfcDeviceEvents",`${Date.now()}-${cardId}-${type}`),{event:"Client NFC Type Control Changed",cardId,deviceType:type,enabled,adminUid:user?.uid||"",createdAt:serverTimestamp()});
  await loadCards();await loadNfcData();
}
function nfcBatchDevices(batchId){return nfcDevices.filter(d=>d.batchId===batchId).sort((a,b)=>Number(a.deviceNumber||999999)-Number(b.deviceNumber||999999)||String(a.deviceId).localeCompare(String(b.deviceId)))}
function nfcEncodingDone(d){return ["encoded","verified"].includes(d.encodingStatus)}
function nfcEncodingLabel(d){return ({"not-encoded":"Not Encoded",encoding:"Encoding",encoded:"Encoded",verified:"Verified",error:"Encoding Error"})[d.encodingStatus]||"Not Encoded"}
function renderNfcEncoder(){
  const batch=nfcBatches.find(b=>b.batchId===nfcEncoderBatchId),items=nfcBatchDevices(nfcEncoderBatchId);if(!batch||!items.length)return;
  nfcEncoderIndex=Math.max(0,Math.min(nfcEncoderIndex,items.length-1));const d=items[nfcEncoderIndex],done=items.filter(nfcEncodingDone).length;
  $("nfcEncoderTitle").textContent="Program / Encode Batch";$("nfcEncoderSubtitle").textContent=`${batch.batchId} · ${NFC_TYPE_LABELS[batch.deviceType]||batch.deviceType} · ${batch.cardId||"Unassigned inventory"}`;
  $("nfcEncoderProgressText").textContent=`${done} / ${items.length}`;$("nfcEncoderProgressLabel").textContent="devices encoded / verified";$("nfcEncoderProgress").max=items.length;$("nfcEncoderProgress").value=done;
  $("nfcEncoderDeviceNumber").textContent=`Device ${String(d.deviceNumber||nfcEncoderIndex+1).padStart(3,"0")}`;$("nfcEncoderDeviceId").textContent=d.deviceId;$("nfcEncoderBatchId").textContent=d.batchId;$("nfcEncoderDeviceType").textContent=NFC_TYPE_LABELS[d.deviceType]||d.deviceType;$("nfcEncoderDeviceStatus").textContent=nfcEncodingLabel(d);$("nfcEncoderUrl").value=nfcDeviceUrl(d.deviceId);
  $("nfcEncoderPrevious").disabled=nfcEncoderIndex===0;$("nfcEncoderMarkNext").textContent=nfcEncoderIndex===items.length-1?"Mark Encoded & Finish":"Mark Encoded & Next";
  $("nfcEncoderStatus").textContent=done===items.length?"Batch production complete. You can re-open any device to verify or re-copy its URL.":"Manual mode: write the URL shown above to this physical NFC device, then mark it encoded.";
}
function openNfcBatchEncoder(batchId){const items=nfcBatchDevices(batchId);if(!items.length)return alert("This batch contains no devices.");nfcEncoderBatchId=batchId;const firstPending=items.findIndex(d=>!nfcEncodingDone(d));nfcEncoderIndex=firstPending>=0?firstPending:0;renderNfcEncoder();$("nfcEncoderDialog")?.showModal()}
async function updateNfcEncoding(deviceId,encodingStatus){
  const d=nfcDevices.find(x=>x.deviceId===deviceId);if(!d)return;const stamp=new Date().toISOString();
  const payload={encodingStatus,encodedBy:user?.uid||"",updatedAt:serverTimestamp()};if(["encoded","verified"].includes(encodingStatus))payload.encodedAt=serverTimestamp();await setDoc(doc(db,"nfcDevices",deviceId),payload,{merge:true});
  await setDoc(doc(db,"nfcDeviceEvents",`${Date.now()}-${deviceId}-encoding`),{event:`Encoding ${encodingStatus}`,deviceId,batchId:d.batchId||null,adminUid:user?.uid||"",createdAt:serverTimestamp()});
  d.encodingStatus=encodingStatus;if(["encoded","verified"].includes(encodingStatus))d.encodedAt=stamp;
  const items=nfcBatchDevices(d.batchId),encodedCount=items.filter(nfcEncodingDone).length;await setDoc(doc(db,"nfcBatches",d.batchId),{encodedCount,encodingStatus:encodedCount===items.length?"complete":encodedCount?"in-progress":"not-started",updatedAt:serverTimestamp()},{merge:true});renderNfcEncoder();renderNfcCenter();
}
async function markCurrentNfcEncoded(next=true){const items=nfcBatchDevices(nfcEncoderBatchId),d=items[nfcEncoderIndex];if(!d)return;await updateNfcEncoding(d.deviceId,"encoded");if(next&&nfcEncoderIndex<items.length-1){nfcEncoderIndex++;renderNfcEncoder()}}
async function verifyCurrentNfcDevice(){const items=nfcBatchDevices(nfcEncoderBatchId),d=items[nfcEncoderIndex];if(!d)return;const expected=nfcDeviceUrl(d.deviceId);const entered=prompt("Verify the URL written/read from this NFC device. Paste or type it here:",expected);if(entered===null)return;if(entered.trim()!==expected){$("nfcEncoderStatus").textContent="Verification failed: the URL does not match this Device ID.";await updateNfcEncoding(d.deviceId,"error");return}await updateNfcEncoding(d.deviceId,"verified");$("nfcEncoderStatus").textContent="Verified: URL matches the expected Device ID."}
function exportNfcBatchCsv(batchId){const batch=nfcBatches.find(b=>b.batchId===batchId),items=nfcBatchDevices(batchId);if(!batch||!items.length)return;const rows=[["Batch ID","Device Number","Device Type","Device ID","NFC Resolver URL","Device Status","Encoding Status","Profile/Card","Encoded At"],...items.map((d,i)=>[batchId,d.deviceNumber||i+1,NFC_TYPE_LABELS[d.deviceType]||d.deviceType,d.deviceId,nfcDeviceUrl(d.deviceId),d.status||"",nfcEncodingLabel(d),d.cardId||"",d.encodedAt?.toDate?.()?.toISOString?.()||d.encodedAt||""])];const csv=rows.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\r\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`${batchId}-nfc-production.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

async function openNfcBatchDetails(batchId){const b=nfcBatches.find(x=>x.batchId===batchId);if(!b)return;const items=nfcDevices.filter(x=>x.batchId===batchId),card=cards.find(x=>x.id===b.cardId),dialog=$("nfcDeviceDialog");$("nfcDeviceDialogTitle").textContent=batchId;$("nfcDeviceDialogSubtitle").textContent=`${NFC_TYPE_LABELS[b.deviceType]||b.deviceType} batch · ${items.length} devices`;$("nfcDeviceDialogBody").innerHTML=`<div class="client-detail-grid"><section class="detail-panel"><h3>Batch Information</h3><div class="detail-list"><div><span>Activation Code</span><strong class="nfc-copy-code">${esc(b.activationCode||"—")}</strong></div><div><span>Activation status</span><strong>${esc(b.activationCodeStatus||"unused")}</strong></div><div><span>Assigned profile</span><strong>${esc(card?.profile?.fullName||card?.admin?.clientName||b.cardId||"Unassigned")}</strong></div><div><span>Quantity</span><strong>${items.length}</strong></div></div><label class="form-group"><span>Assign / Transfer Batch</span><select id="nfcAssignBatchCard"><option value="">Choose client/profile</option>${cards.filter(c=>["activated","suspended"].includes(c.status)).map(c=>`<option value="${esc(c.id)}" ${c.id===b.cardId?"selected":""}>${esc(c.profile?.fullName||c.admin?.clientName||c.owner?.ownerEmail||c.id)} — ${esc(c.id)}</option>`).join("")}</select></label><div class="nfc-device-mini-list">${items.map(d=>`<div class="nfc-device-mini-row"><span><strong>${esc(d.deviceId)}</strong><small>${esc(d.status||"")} · ${Number(d.tapCount||0)} taps</small></span><span class="nfc-device-status-pill ${nfcStatusClass(d.status)}">${esc(d.status||"")}</span><button class="mini-button" type="button" data-open-device="${esc(d.deviceId)}">Open</button></div>`).join("")}</div></section></div>`;$("nfcDeviceDialogActions").innerHTML=`<button class="primary-button" data-program-batch>${items.some(d=>!nfcEncodingDone(d))?"Program / Continue Devices":"Review Encoded Devices"}</button><button class="secondary-button" data-export-batch>Export Batch CSV</button><button class="secondary-button" data-copy-batch-code>Copy Activation Code</button><button class="secondary-button" data-copy-activation-link>Copy Activation Page</button><button class="secondary-button" data-assign-batch>Assign / Transfer</button>${b.enabled===false||b.status==="disabled"?'<button class="primary-button" data-toggle-batch="on">Enable Batch</button>':'<button class="danger-button" data-toggle-batch="off">Disable Batch</button>'}`;dialog.showModal();dialog.querySelector("[data-program-batch]")?.addEventListener("click",()=>{dialog.close();openNfcBatchEncoder(batchId)});dialog.querySelector("[data-export-batch]")?.addEventListener("click",()=>exportNfcBatchCsv(batchId));dialog.querySelectorAll("[data-open-device]").forEach(x=>x.onclick=()=>{dialog.close();openNfcDeviceDialog(x.dataset.openDevice)});dialog.querySelector("[data-copy-batch-code]")?.addEventListener("click",()=>copyText(b.activationCode||""));dialog.querySelector("[data-copy-activation-link]")?.addEventListener("click",()=>copyText(`${location.origin}/device-activate.html?code=${encodeURIComponent(b.activationCode||"")}`));dialog.querySelector("[data-assign-batch]")?.addEventListener("click",async()=>{const target=dialog.querySelector("#nfcAssignBatchCard")?.value;if(!target)return alert("Choose a client/profile first.");await assignNfcBatch(batchId,target);dialog.close()});dialog.querySelector('[data-toggle-batch="on"]')?.addEventListener("click",async()=>{await setNfcBatchEnabled(batchId,true);dialog.close()});dialog.querySelector('[data-toggle-batch="off"]')?.addEventListener("click",async()=>{await setNfcBatchEnabled(batchId,false);dialog.close()})}
function profileLifecycle(card){
  const raw=String(card?.profileStatus||card?.admin?.profileStatus||"").toLowerCase();
  if(raw)return raw;
  if(card?.status==="suspended")return "suspended";
  if(card?.status==="activated")return "active";
  return card?.status||"active";
}
function clientNfcSection(card){
  // Production UI is intentionally card-only. Legacy non-card Device-ID records are preserved in Firestore
  // for compatibility/history, but they are not surfaced in the administrator interface.
  const ds=nfcDevices.filter(d=>d.cardId===card.id&&d.deviceType==="card");
  const bs=nfcBatches.filter(b=>b.cardId===card.id&&(b.deviceType||"card")==="card");
  const cardControlOn=card.nfcDeviceControls?.card!==false;
  return `<section class="detail-panel"><div class="nfc-client-section-title"><div><h3>Official JMX NFC Cards</h3><p class="subtitle small">Card-only Device-ID resolver layer. Existing URL cards, QR and Google Wallet remain compatible and separate.</p></div><span class="nfc-device-status-pill ${nfcStatusClass(profileLifecycle(card))}">${esc(profileLifecycle(card).toUpperCase())}</span></div>
  <div class="nfc-client-overview"><article><span>Plan</span><strong>${esc(effectivePlan(card)==="Business"?"JMX Business":effectivePlan(card))}</strong></article><article><span>Profile ID</span><strong>${esc(card.profileId||card.admin?.profileId||"Legacy profile")}</strong></article><article><span>Total NFC Cards</span><strong>${ds.length}</strong></article><article><span>Card Batches</span><strong>${bs.length}</strong></article></div>
  <div class="nfc-client-quick-actions"><button type="button" class="primary-button" data-client-create-batch><i class="fa-solid fa-plus"></i> Add NFC Cards</button><button type="button" class="secondary-button" data-client-assign-batch><i class="fa-solid fa-link"></i> Assign Existing Batch</button>${profileLifecycle(card)==="active"?'<button type="button" class="secondary-button" data-profile-lifecycle="suspended">Suspend Profile</button>':'<button type="button" class="secondary-button" data-profile-lifecycle="active">Reactivate Profile</button>'}<button type="button" class="secondary-button" data-profile-lifecycle="archived">Archive Profile</button></div>
  <div class="nfc-client-device-summary"><article><span>NFC Cards</span><strong>${ds.length}</strong></article></div>
  <h4>Client NFC Master Control</h4><div class="nfc-control-grid"><button type="button" class="nfc-control-button ${card.nfcDevicesEnabled===false?"off":""}" data-client-nfc-master data-client-nfc-master-state="${card.nfcDevicesEnabled===false?"off":"on"}"><span>All Official NFC Cards</span><strong>${card.nfcDevicesEnabled===false?"OFF":"ON"}</strong></button></div>
  <h4>NFC Card Control — This Client Only</h4><div class="nfc-control-grid"><button type="button" class="nfc-control-button ${cardControlOn?"":"off"}" data-client-nfc-type="card" data-client-nfc-state="${cardControlOn?"on":"off"}"><span>NFC Cards</span><strong>${cardControlOn?"ON":"OFF"}</strong></button></div>
  <h4>NFC Card Batches</h4><div class="nfc-device-mini-list">${bs.length?bs.map(b=>{const amount=nfcDevices.filter(d=>d.batchId===b.batchId&&d.deviceType==="card").length;return `<div class="nfc-device-mini-row"><span><strong>${esc(b.batchId)}</strong><small>${amount} NFC card${amount===1?"":"s"} · ${esc(b.status||"available")}</small></span><span class="nfc-device-status-pill ${nfcStatusClass(b.status)}">${b.enabled===false?"OFF":"ON"}</span><button type="button" class="mini-button" data-client-open-batch="${esc(b.batchId)}">Open / Control</button></div>`}).join(""):'<p class="subtitle small">No NFC card batches assigned yet.</p>'}</div>
  <h4>Individual NFC Cards</h4><div class="nfc-device-mini-list">${ds.slice(0,40).map(d=>`<div class="nfc-device-mini-row"><span><strong>${esc(d.deviceId)}</strong><small>NFC Card · ${esc(d.batchId||"")}</small></span><span class="nfc-device-status-pill ${nfcStatusClass(d.lifecycleStatus||d.status)}">${esc(d.lifecycleStatus||d.status||"")}</span><button type="button" class="mini-button" data-client-open-device="${esc(d.deviceId)}">Open</button></div>`).join("")||'<p class="subtitle small">No NFC cards assigned yet.</p>'}</div>
  <div class="detail-wide inventory-note-detail"><span>Admin note</span><strong>${esc(card.admin?.notes||card.inventory?.notes||"—")}</strong><button class="inline-edit-note" type="button" data-client-admin-note><i class="fa-solid fa-pen"></i> Edit note</button></div></section>`
}
async function setProfileLifecycle(cardId,next){
  const card=cards.find(c=>c.id===cardId);if(!card)return;
  const label=next==="active"?"reactivate":next;
  if(!confirm(`${label.charAt(0).toUpperCase()+label.slice(1)} profile ${cardId}?`))return;
  const legacyStatus=next==="active"?"activated":"suspended";
  const wb=writeBatch(db);
  wb.set(doc(db,"cards",cardId),{profileStatus:next,status:legacyStatus,updatedAt:serverTimestamp()},{merge:true});
  wb.set(doc(db,"cardAdmin",cardId),{profileStatus:next,updatedAt:serverTimestamp()},{merge:true});
  wb.set(doc(db,"nfcDeviceEvents",`${Date.now()}-${cardId}`),{event:next==="active"?"Profile Reactivated":next==="suspended"?"Profile Suspended":"Profile Archived",cardId,profileId:card.profileId||card.admin?.profileId||null,adminUid:user?.uid||"",createdAt:serverTimestamp()});
  await wb.commit();await loadCards();await loadNfcData();
}
function openAssignBatchChooser(cardId){
  const available=nfcBatches.filter(b=>(b.deviceType||"card")==="card"&&(!b.cardId||b.cardId===cardId));
  const dialog=$("nfcDeviceDialog");$("nfcDeviceDialogTitle").textContent="Assign Existing Batch";$("nfcDeviceDialogSubtitle").textContent=`Select an unassigned batch for ${cardId}`;
  $("nfcDeviceDialogBody").innerHTML=`<div class="client-detail-grid"><section class="detail-panel"><label class="form-group"><span>Available NFC Batch</span><select id="nfcClientBatchChooser"><option value="">Choose batch</option>${available.map(b=>`<option value="${esc(b.batchId)}">${esc(b.batchId)} — ${esc(NFC_TYPE_LABELS[b.deviceType]||b.deviceType)} — ${Number(b.quantity||0)} devices</option>`).join("")}</select></label><p class="subtitle small">Existing Device IDs are preserved. Assignment changes only which profile the resolver opens.</p></section></div>`;
  $("nfcDeviceDialogActions").innerHTML='<button class="primary-button" data-confirm-client-batch>Assign Batch</button><button class="secondary-button" data-cancel-client-batch>Cancel</button>';dialog.showModal();
  dialog.querySelector("[data-cancel-client-batch]")?.addEventListener("click",()=>dialog.close());
  dialog.querySelector("[data-confirm-client-batch]")?.addEventListener("click",async()=>{const batchId=dialog.querySelector("#nfcClientBatchChooser")?.value;if(!batchId)return alert("Choose a batch first.");if(!confirm(`Assign ${batchId} to ${cardId}?`))return;await assignNfcBatch(batchId,cardId);dialog.close();await openClientDialog(cardId,false)});
}
function openNfcBatchCreateForCard(cardId){refreshNfcBatchForm();if($("nfcBatchCardId"))$("nfcBatchCardId").value=cardId;$("nfcBatchQuantity").value="1";$("nfcBatchStatus").textContent="";$("nfcBatchDialog")?.showModal()}
const originalOpenClientDialogNfc=openClientDialog;
openClientDialog=async function(id,resetDraft=true){await originalOpenClientDialogNfc(id,resetDraft);const card=cards.find(c=>c.id===id),body=$("clientDetailBody");if(!card||!body)return;const grid=body.querySelector(".client-detail-grid")||body;grid.insertAdjacentHTML("beforeend",clientNfcSection(card));body.querySelectorAll("[data-client-open-device]").forEach(b=>b.onclick=()=>openNfcDeviceDialog(b.dataset.clientOpenDevice));body.querySelectorAll("[data-client-open-batch]").forEach(b=>b.onclick=()=>{$("clientDetailDialog")?.close();openNfcBatchDetails(b.dataset.clientOpenBatch)});body.querySelector("[data-client-nfc-master]")?.addEventListener("click",async()=>{const next=body.querySelector("[data-client-nfc-master]").dataset.clientNfcMasterState!=="on";await setDoc(doc(db,"cards",id),{nfcDevicesEnabled:next,updatedAt:serverTimestamp()},{merge:true});await loadCards();await openClientDialog(id,false)});body.querySelectorAll("[data-client-nfc-type]").forEach(b=>b.onclick=async()=>{const next=b.dataset.clientNfcState!=="on";b.disabled=true;await setClientNfcTypeEnabled(id,b.dataset.clientNfcType,next);await openClientDialog(id,false)});body.querySelector("[data-client-admin-note]")?.addEventListener("click",async()=>{await editInventoryNote(id);await openClientDialog(id,false)});body.querySelector("[data-client-create-batch]")?.addEventListener("click",()=>{$("clientDetailDialog")?.close();openNfcBatchCreateForCard(id)});body.querySelector("[data-client-assign-batch]")?.addEventListener("click",()=>{$("clientDetailDialog")?.close();openAssignBatchChooser(id)});body.querySelectorAll("[data-profile-lifecycle]").forEach(b=>b.onclick=async()=>{await setProfileLifecycle(id,b.dataset.profileLifecycle);$("clientDetailDialog")?.close()})}

function prepareNfcProfileDialog(){
  const cardId=randomCode();$("nfcProfileCardId").value=cardId;$("nfcProfileInternalId").value=nfcRandom("PROF",14);$("nfcProfileUrlPreview").textContent=friendlyUrl(cardId);$("nfcProfileStatus").textContent="";
}
async function createNfcProfile(e){
  e.preventDefault();const status=$("nfcProfileStatus"),button=$("createNfcProfileButton");
  const fullName=$("nfcProfileName").value.trim(),company=$("nfcProfileCompany").value.trim(),email=$("nfcProfileEmail").value.trim(),phone=$("nfcProfilePhone").value.trim(),plan=$("nfcProfilePlan").value,cardId=cleanCode($("nfcProfileCardId").value),profileId=$("nfcProfileInternalId").value.trim(),notes=$("nfcProfileNotes").value.trim();
  if(!fullName)return status.textContent="Customer Name is required.";if(!cardId||!profileId)return status.textContent="Card ID / Profile ID is missing.";
  button.disabled=true;button.textContent="Creating…";status.textContent="Creating digital profile and internal identifiers…";
  try{
if((await getDoc(doc(db,"cards",cardId))).exists())throw new Error("Card ID already exists. Press Random and try again.");
    const wb=writeBatch(db);const profile=blankProfile();profile.fullName=fullName;profile.company=company;profile.email=email;profile.phone=phone;profile.phoneRaw=phone;profile.profileId=profileId;
    wb.set(doc(db,"cards",cardId),{inventoryVersion:2,status:"activated",profileStatus:"active",profileId,creationMethod:"official-device-id-profile",plan,complimentaryPremium:false,complimentaryBusiness:false,subscription:{status:"none",source:"manual"},nfcStatus:"not-programmed",requiresActivationCode:false,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    wb.set(doc(db,"profiles",cardId),profile);
    wb.set(doc(db,"inventory",cardId),{inventoryVersion:2,status:"activated",plan,physicalType:"Profile / Device-ID",nfcStatus:"not-programmed",notes,requiresActivationCode:false,activationCode:"",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    wb.set(doc(db,"cardAdmin",cardId),{profileId,profileStatus:"active",creationMethod:"official-device-id-profile",clientName:fullName,physicalType:"Profile / Device-ID",nfcStatus:"not-programmed",notes,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    wb.set(doc(db,"nfcDeviceEvents",`${Date.now()}-${cardId}`),{event:"Profile Created",cardId,profileId,plan,adminUid:user?.uid||"",createdAt:serverTimestamp()});
    await wb.commit();status.textContent=`Profile ${fullName} created successfully.`;await loadCards();renderNfcCenter();setTimeout(()=>{$("nfcProfileDialog")?.close();$("nfcProfileForm")?.reset();prepareNfcProfileDialog();openClientDialog(cardId)},450);
  }catch(err){console.error(err);status.textContent="Could not create profile: "+(err?.message||"Unknown error")}finally{button.disabled=false;button.textContent="Create Profile"}
}

async function setNfcDeviceLifecycle(deviceId,next){
  const d=nfcDevices.find(x=>x.deviceId===deviceId);if(!d)return;
  const terminal=new Set(["lost","stolen","replaced","retired","archived"]);const disabling=terminal.has(next)||next==="suspended"||next==="disabled";
  if(["lost","stolen","retired","archived"].includes(next)&&!confirm(`Mark ${deviceId} as ${next.toUpperCase()} and disable it?`))return;
  const batch=nfcBatches.find(x=>x.batchId===d.batchId);let status=next,enabled=!disabling;
  if(next==="active"){status=d.cardId?(batch?.activationCodeStatus==="used"?"active":"pending"):"available";enabled=true}
  const wb=writeBatch(db);wb.set(doc(db,"nfcDevices",deviceId),{status,lifecycleStatus:status,enabled,deviceEnabled:enabled,updatedAt:serverTimestamp()},{merge:true});wb.set(doc(db,"nfcDevicePublic",deviceId),{status,enabled,updatedAt:serverTimestamp()},{merge:true});wb.set(doc(db,"nfcDeviceEvents",`${Date.now()}-${deviceId}`),{event:next==="active"?"Device Reactivated":next==="suspended"?"Device Suspended":next==="lost"?"Device Lost":next==="stolen"?"Device Stolen":next==="retired"?"Device Retired":"Device Archived",deviceId,batchId:d.batchId||null,cardId:d.cardId||null,adminUid:user?.uid||"",createdAt:serverTimestamp()});await wb.commit();await loadNfcData();
}
async function openNfcDeviceDialog(deviceId){
  const d=nfcDevices.find(x=>x.deviceId===deviceId);if(!d)return;const batch=nfcBatches.find(x=>x.batchId===d.batchId),card=cards.find(x=>x.id===d.cardId),dialog=$("nfcDeviceDialog"),life=String(d.lifecycleStatus||d.status||"available").toLowerCase();
  $("nfcDeviceDialogTitle").textContent=card?.profile?.fullName||d.notes||batch?.notes||"NFC Card";$("nfcDeviceDialogSubtitle").textContent=`${d.material||"NFC Card"} · ${life}`;
  $("nfcDeviceDialogBody").innerHTML=`<div class="client-detail-grid"><section class="detail-panel"><h3>NFC Card</h3><div class="detail-list"><div><span>Plan</span><strong>${esc(card?effectivePlan(card):(d.plan||batch?.plan||"Basic"))}</strong></div><div><span>Status</span><strong>${esc(life.toUpperCase())}</strong></div><div><span>Client</span><strong>${esc(card?.profile?.fullName||card?.admin?.clientName||"Unassigned — customer activates later")}</strong></div><div><span>Private Note</span><strong>${esc(d.notes||batch?.notes||"—")}</strong></div><div><span>Total taps</span><strong>${Number(d.tapCount||0).toLocaleString()}</strong></div></div><details class="nfc-advanced-details"><summary>Advanced Details</summary><div class="detail-list"><div><span>Internal Device ID</span><strong class="break-anywhere">${esc(deviceId)}</strong></div><div><span>Resolver URL</span><strong class="break-anywhere">${esc(nfcDeviceUrl(deviceId))}</strong></div><div><span>Activation Code</span><strong>${esc(batch?.activationCode||"—")}</strong></div><div><span>Batch</span><strong>${esc(d.batchId||"—")}</strong></div><div><span>Encoding</span><strong>${esc(d.encodingStatus||"not-encoded")}</strong></div></div></details><div id="nfcDeliveryKitQr" class="nfc-delivery-qr" hidden></div></section></div>`;
  const canReactivate=["suspended","disabled"].includes(life),canSuspend=["active","pending","available"].includes(life);
  $("nfcDeviceDialogActions").innerHTML=`<button class="primary-button" data-nfc-copy-url>Copy NFC URL</button><button class="secondary-button" data-delivery-kit>Delivery Kit</button>${canReactivate?'<button class="secondary-button" data-device-life="active">Reactivate</button>':""}${canSuspend?'<button class="secondary-button" data-device-life="suspended">Suspend</button>':""}${!["lost","stolen","replaced","retired","archived"].includes(life)?'<button class="danger-button" data-device-life="lost">Lost</button><button class="danger-button" data-device-life="stolen">Stolen</button>':""}${!["replaced","retired","archived"].includes(life)?'<button class="secondary-button" data-replace-device>Replace Device</button><button class="secondary-button" data-device-life="retired">Retire</button>':""}${life!=="archived"?'<button class="secondary-button" data-device-life="archived">Archive</button>':""}${batch?`<button class="secondary-button" data-open-batch="${esc(batch.batchId)}">Open Batch</button>`:""}`;
  dialog.showModal();
  dialog.querySelector("[data-nfc-copy-url]")?.addEventListener("click",()=>copyText(nfcDeviceUrl(deviceId)));
  dialog.querySelector("[data-delivery-kit]")?.addEventListener("click",()=>{const host=$("nfcDeliveryKitQr");if(!host)return;host.hidden=false;host.innerHTML=`<div class="delivery-kit"><h3>Customer Delivery Kit</h3><p><strong>Activate:</strong> ${esc(`${location.origin}/device-activate.html?device=${encodeURIComponent(deviceId)}`)}</p><p><strong>Activation Code:</strong> ${esc(batch?.activationCode||"—")}</p><p><strong>Manage/Edit:</strong> ${esc(`${location.origin}/login`)}</p><div id="deliveryActivationQr"></div><div class="dialog-actions"><button type="button" class="mini" data-copy-activation>Copy Activation Link</button><button type="button" class="mini" data-copy-code>Copy Code</button><button type="button" class="mini" data-copy-login>Copy Login Link</button></div></div>`;if(window.QRCode)new QRCode(host.querySelector("#deliveryActivationQr"),{text:`${location.origin}/device-activate.html?device=${encodeURIComponent(deviceId)}`,width:150,height:150});host.querySelector("[data-copy-activation]")?.addEventListener("click",()=>copyText(`${location.origin}/device-activate.html?device=${encodeURIComponent(deviceId)}`));host.querySelector("[data-copy-code]")?.addEventListener("click",()=>copyText(batch?.activationCode||""));host.querySelector("[data-copy-login]")?.addEventListener("click",()=>copyText(`${location.origin}/login`));});
  dialog.querySelectorAll("[data-device-life]").forEach(b=>b.onclick=async()=>{await setNfcDeviceLifecycle(deviceId,b.dataset.deviceLife);dialog.close()});dialog.querySelector("[data-open-batch]")?.addEventListener("click",()=>{dialog.close();openNfcBatchDetails(batch.batchId)});dialog.querySelector("[data-replace-device]")?.addEventListener("click",async()=>{dialog.close();await replaceNfcDevice(deviceId)})
}

const returnNfcCardToInventoryCall=httpsCallable(functions,"returnNfcCardToInventory");
const deleteNfcClientCardCall=httpsCallable(functions,"deleteNfcClientCard");
async function returnNfcClientCardToInventory(cardId){
  const linked=nfcDevices.filter(d=>d.cardId===cardId&&d.deviceType==="card");
  if(!linked.length)return alert("No hay una tarjeta NFC vinculada a este cliente.");
  if(linked.length!==1)return alert("Este cliente tiene más de una tarjeta NFC vinculada. Revise los detalles antes de devolver una tarjeta al inventario.");
  if(!confirm("¿Devolver esta tarjeta NFC al inventario Disponible? Se eliminará la vinculación con el cliente."))return;
  if(!confirm("CONFIRMACIÓN FINAL: el código de activación anterior dejará de funcionar y se generará uno nuevo. ¿Continuar?"))return;
  try{
    const result=(await returnNfcCardToInventoryCall({cardId,deviceId:linked[0].deviceId})).data;
    await loadNfcData();
    $("clientDetailDialog")?.close();
    alert(`Tarjeta devuelta a Disponible. Nuevo código de activación: ${result?.activationCode||"generado"}`);
  }catch(e){console.error(e);alert(e?.message||"No se pudo devolver la tarjeta al inventario.");}
}
async function deleteNfcClientCard(cardId){
  const linked=nfcDevices.filter(d=>d.cardId===cardId&&d.deviceType==="card");
  if(!linked.length)return alert("No hay una tarjeta NFC vinculada a este cliente.");
  if(linked.length!==1)return alert("Este cliente tiene más de una tarjeta NFC vinculada. Revise los detalles antes de eliminar.");
  if(!confirm("¿Está seguro de que desea eliminar este cliente y su tarjeta NFC?"))return;
  if(!confirm("Esta acción es permanente. ¿Está completamente seguro?"))return;
  try{
    await deleteNfcClientCardCall({cardId,deviceId:linked[0].deviceId});
    await loadNfcData();
    $("clientDetailDialog")?.close();
    alert("Cliente y tarjeta NFC eliminados permanentemente.");
  }catch(e){console.error(e);alert(e?.message||"No se pudo eliminar el cliente y la tarjeta NFC.");}
}
function initNfcDeviceCenter(){
  $("newNfcDeviceButton")?.addEventListener("click",openNfcQuickDeviceCreate);$("closeNfcQuickDeviceDialog")?.addEventListener("click",()=>$("nfcQuickDeviceDialog")?.close());$("cancelNfcQuickDeviceButton")?.addEventListener("click",()=>$("nfcQuickDeviceDialog")?.close());$("nfcQuickDeviceForm")?.addEventListener("submit",createNfcQuickDevice);
  $("newNfcProfileButton")?.addEventListener("click",()=>{prepareNfcProfileDialog();$("nfcProfileDialog")?.showModal()});$("closeNfcProfileDialog")?.addEventListener("click",()=>$("nfcProfileDialog")?.close());$("cancelNfcProfileButton")?.addEventListener("click",()=>$("nfcProfileDialog")?.close());$("nfcProfileForm")?.addEventListener("submit",createNfcProfile);$("regenerateNfcProfileCardId")?.addEventListener("click",()=>{const id=randomCode();$("nfcProfileCardId").value=id;$("nfcProfileUrlPreview").textContent=friendlyUrl(id)});
  $("newNfcBatchButton")?.addEventListener("click",openNfcBatchCreate);$("closeNfcBatchDialog")?.addEventListener("click",()=>$("nfcBatchDialog")?.close());$("cancelNfcBatchButton")?.addEventListener("click",()=>$("nfcBatchDialog")?.close());$("nfcBatchForm")?.addEventListener("submit",createNfcBatch);$("regenerateBatchId")?.addEventListener("click",()=>$("nfcBatchId").value=nfcRandom("BATCH",8));$("regenerateBatchActivation")?.addEventListener("click",()=>$("nfcBatchActivationCode").value=nfcRandom("ACT",8));$("closeNfcDeviceDialog")?.addEventListener("click",()=>$("nfcDeviceDialog")?.close());$("closeNfcEncoderDialog")?.addEventListener("click",()=>$("nfcEncoderDialog")?.close());$("nfcEncoderDialog")?.addEventListener("click",e=>{if(e.target===$("nfcEncoderDialog"))$("nfcEncoderDialog").close()});$("copyNfcEncoderUrl")?.addEventListener("click",()=>copyText($("nfcEncoderUrl")?.value||""));$("nfcEncoderPrevious")?.addEventListener("click",()=>{if(nfcEncoderIndex>0){nfcEncoderIndex--;renderNfcEncoder()}});$("nfcEncoderMarkNext")?.addEventListener("click",()=>markCurrentNfcEncoded(true));$("nfcEncoderVerify")?.addEventListener("click",verifyCurrentNfcDevice);$("nfcEncoderMarkError")?.addEventListener("click",async()=>{const d=nfcBatchDevices(nfcEncoderBatchId)[nfcEncoderIndex];if(d)await updateNfcEncoding(d.deviceId,"error")});$("nfcDeviceDialog")?.addEventListener("click",e=>{if(e.target===$("nfcDeviceDialog"))$("nfcDeviceDialog").close()});document.querySelectorAll("[data-nfc-expand]").forEach(b=>b.addEventListener("click",()=>expandNfcBox(b.dataset.nfcExpand)));["nfcAvailableCardsSearch","nfcSoldCardsSearch","nfcBasicClientsSearch","nfcPremiumClientsSearch","nfcBusinessClientsSearch"].forEach(id=>$(id)?.addEventListener("input",renderNfcCenter));let timer;$("nfcGlobalSearch")?.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(renderNfcGlobalSearch,220)});$("nfcGlobalSearchButton")?.addEventListener("click",renderNfcGlobalSearch);document.addEventListener("keydown",e=>{if(e.key==="Escape")closeNfcExpanded()});
}
initNfcDeviceCenter();
// load when authenticated; the existing admin check protects the collections in Firestore rules.
onAuthStateChanged(auth, async currentUser=>{if(currentUser&&await isAdmin(currentUser).catch(()=>false))await loadNfcData()});

const NFC_SETTING_TYPES=["card"];
let nfcDeviceSettings={enabled:true,global:{},Basic:{},Premium:{},Business:{}};
function defaultNfcSettings(){const b=()=>Object.fromEntries(NFC_SETTING_TYPES.map(t=>[t,true]));return {enabled:true,global:b(),Basic:b(),Premium:b(),Business:b()}}
function renderNfcSettings(){if(!$("nfcSettingsMatrix"))return;const d=defaultNfcSettings();nfcDeviceSettings={enabled:nfcDeviceSettings.enabled!==false,global:{...d.global,...(nfcDeviceSettings.global||{})},Basic:{...d.Basic,...(nfcDeviceSettings.Basic||{})},Premium:{...d.Premium,...(nfcDeviceSettings.Premium||{})},Business:{...d.Business,...(nfcDeviceSettings.Business||{})}};$("nfcSystemEnabled").checked=nfcDeviceSettings.enabled;$("nfcSettingsMatrix").innerHTML=["global","Basic","Premium","Business"].map(group=>`<section class="nfc-settings-column"><h4>${group==="global"?"GLOBAL":group==="Business"?"JMX Business":group}</h4>${NFC_SETTING_TYPES.map(t=>`<label class="nfc-settings-toggle"><span>${esc(NFC_TYPE_LABELS[t])}</span><input type="checkbox" data-nfc-setting-group="${group}" data-nfc-setting-type="${t}" ${nfcDeviceSettings[group]?.[t]!==false?"checked":""}></label>`).join("")}</section>`).join("")}
async function loadNfcSettings(){try{const s=await getDoc(doc(db,"platform","nfcDeviceSettings"));nfcDeviceSettings=s.exists()?s.data():defaultNfcSettings();renderNfcSettings()}catch(e){console.error("NFC settings load failed",e)}}
async function saveNfcSettings(){const status=$("nfcSettingsStatus");status.textContent="Saving…";const next=defaultNfcSettings();next.enabled=$("nfcSystemEnabled")?.checked!==false;document.querySelectorAll("[data-nfc-setting-group]").forEach(x=>next[x.dataset.nfcSettingGroup][x.dataset.nfcSettingType]=x.checked);try{await setDoc(doc(db,"platform","nfcDeviceSettings"),{...next,updatedAt:serverTimestamp()},{merge:true});nfcDeviceSettings=next;status.textContent="NFC controls saved."}catch(e){console.error(e);status.textContent="Could not save NFC controls."}}
$("saveNfcDeviceSettings")?.addEventListener("click",saveNfcSettings);
onAuthStateChanged(auth,async currentUser=>{if(currentUser&&await isAdmin(currentUser).catch(()=>false))await loadNfcSettings()});


/* Sep 2026 — reusable desktop contextual help tooltips (hover/focus only) */
(function initJmxAdminTooltips(){
  const finePointer=()=>window.matchMedia?.("(hover: hover) and (pointer: fine)").matches===true;
  const featureHelp={
    description:"Muestra u oculta la descripción del perfil o negocio en la tarjeta digital pública.",
    saveContact:"Muestra u oculta Guardar contacto, para que un visitante pueda guardar los datos del cliente en su teléfono.",
    quickActions:"Muestra u oculta las acciones rápidas del perfil, como los accesos de contacto que estén habilitados.",
    phone:"Muestra u oculta la acción del teléfono principal en la tarjeta digital.",
    phone2:"Permite mostrar u ocultar un segundo número de teléfono en la tarjeta digital.",
    whatsapp:"Muestra u oculta la acción de WhatsApp en la tarjeta digital.",
    email:"Muestra u oculta la acción de correo electrónico en la tarjeta digital.",
    website:"Muestra u oculta la sección o enlace de sitio web en la tarjeta digital.",
    location:"Muestra u oculta la ubicación o dirección del cliente en la tarjeta digital.",
    facebook:"Muestra u oculta el enlace de Facebook en la tarjeta digital.",
    instagram:"Muestra u oculta el enlace de Instagram en la tarjeta digital.",
    linkedin:"Muestra u oculta el enlace de LinkedIn en la tarjeta digital.",
    twitter:"Muestra u oculta el enlace de X / Twitter en la tarjeta digital.",
    tiktok:"Muestra u oculta el enlace de TikTok en la tarjeta digital.",
    youtube:"Muestra u oculta el enlace de YouTube en la tarjeta digital.",
    services:"Muestra u oculta la sección Servicios del perfil.",
    gallery:"Muestra u oculta la Galería de Fotos del perfil.",
    video:"Muestra u oculta la sección de video destacado del perfil.",
    qr:"Muestra u oculta el código QR del perfil.",
    customQR:"Permite o bloquea las opciones para personalizar el código QR.",
    qrDownload:"Permite o bloquea la descarga del código QR.",
    finalCTA:"Muestra u oculta la llamada a la acción final del perfil.",
    businessLinks:"Muestra u oculta los enlaces comerciales adicionales del perfil.",
    catalog:"Permite o bloquea la sección de catálogo o PDF.",
    customBusiness:"Muestra u oculta el enlace comercial personalizado.",
    analytics:"Permite o bloquea el acceso a las analíticas estándar.",
    advancedAnalytics:"Permite o bloquea las analíticas avanzadas.",
    quickCapture:"Muestra u oculta el formulario Quick Capture para captar prospectos.",
    leads:"Permite o bloquea Leads / Mis Contactos para administrar prospectos capturados.",
    contactNotes:"Permite o bloquea las notas de contactos.",
    meetingNotes:"Permite o bloquea las notas de reuniones.",
    followUp:"Permite o bloquea las herramientas de seguimiento de contactos.",
    csvExport:"Permite o bloquea la exportación de contactos o leads en formato CSV.",
    vcfDownload:"Permite o bloquea la descarga de contactos en formato VCF/vCard.",
    contactMap:"Permite o bloquea el módulo Mapa de Contactos cuando la integración esté disponible.",
    aiScanner:"Permite o bloquea el Escáner de Tarjetas de Presentación con IA.",
    autoIntroEmail:"Permite o bloquea el correo automático de presentación cuando la integración esté disponible.",
    appleWallet:"Permite o bloquea Apple Wallet cuando la integración esté disponible.",
    googleWallet:"Permite o bloquea el acceso del propietario a Google Wallet.",
    googleWalletThemes:"Permite o bloquea la personalización de temas de Google Wallet.",
    qrCardThemes:"Permite o bloquea la personalización de temas de la tarjeta QR.",
    profileThemes:"Permite o bloquea la personalización de colores/temas del perfil.",
    brandingRemoval:"Permite o bloquea la opción de retirar el branding de JMX cuando corresponda.",
    advancedNetworkingInsights:"Permite o bloquea las herramientas avanzadas de información de networking cuando estén disponibles."
  };
  const exact={
    newNfcProfileButton:"Crea manualmente un nuevo perfil de cliente JMX. Después se puede vincular una tarjeta NFC física.",
    newNfcDeviceButton:"Crea una nueva tarjeta NFC física y la agrega al inventario disponible.",
    newNfcBatchButton:"Crea varias tarjetas NFC a la vez y las agrega al inventario disponible.",
    newCardButton:"Crea una nueva tarjeta en el inventario.",
    nfcGlobalSearch:"Busca clientes y tarjetas NFC por nombre, empresa, correo, teléfono o identificadores administrativos.",
    nfcGlobalSearchButton:"Ejecuta la búsqueda de clientes y tarjetas NFC.",
    searchCards:"Busca inventario y clientes por nombre, código, URL, correo, teléfono, plan, fecha o notas.",
    masterSearchButton:"Busca en todo el inventario y los clientes.",
    nfcSystemEnabled:"Activa o desactiva globalmente el sistema oficial de tarjetas NFC con ID.",
    featureControlsEnabled:"Activa o desactiva las reglas avanzadas de control de funciones.",
    showFeaturePanels:"Muestra u oculta en el administrador los paneles de switches Global, Basic, Premium y JMX Business.",
    premiumEnabled:"Muestra u oculta el plan Premium en el sitio público.",billingEnabled:"Activa o desactiva el checkout de suscripciones.",privacyRequired:"Exige aceptar la privacidad antes de completar un pago.",
    businessEnabled:"Muestra u oculta JMX Business en el sitio público.",businessPoliciesReady:"Marca las políticas de JMX Business como listas/aprobadas.",
    aiKillSwitch:"Permite o bloquea globalmente los servicios externos de IA/OCR.",logoutButton:"Cierra la sesión del administrador JMX.",dashboardGoogleLogin:"Inicia sesión en el administrador con Google.",loginButton:"Inicia sesión en el administrador.",
    closeCardDialog:"Cierra esta ventana.",closeClientDetailDialog:"Cierra la ventana del cliente.",closeNfcProfileDialog:"Cierra esta ventana.",closeNfcQuickDeviceDialog:"Cierra esta ventana.",closeNfcBatchDialog:"Cierra esta ventana.",closeNfcEncoderDialog:"Cierra esta ventana.",closeNfcDeviceDialog:"Cierra esta ventana."
  };
  const actionHelp={
    "mark-sold":"Marca esta tarjeta como vendida y la mueve de Disponible a Vendida / esperando activación.",
    "delivery-kit":"Abre la información de entrega y activación necesaria para entregar esta tarjeta al cliente.",
    suspend:"Suspende temporalmente esta tarjeta NFC sin borrar el perfil ni los datos del cliente.",
    reactivate:"Vuelve a habilitar una tarjeta o perfil que estaba suspendido.",
    replace:"Reemplaza la tarjeta NFC física conservando el perfil digital del cliente.",
    return:"Desvincula al cliente, invalida el código anterior, genera uno nuevo y devuelve la tarjeta a Disponible.",
    delete:"Inicia la eliminación permanente protegida por confirmaciones.",
    view:"Abre los detalles administrativos de este registro.",edit:"Abre la edición de este registro.",history:"Muestra el historial de esta tarjeta o cliente.",analytics:"Muestra las analíticas disponibles para esta tarjeta o cliente."
  };
  const clean=s=>(s||"").replace(/\s+/g," ").trim();
  function scopeText(el){
    const group=el.closest?.("[data-feature-panel]")?.dataset.featurePanel||el.dataset?.group||el.dataset?.nfcSettingGroup;
    if(group==="global")return " Este control aplica a todos los planes; si se apaga globalmente, bloquea esta función aunque un plan la tenga encendida.";
    if(group==="Basic")return " Este control aplica a clientes Basic.";
    if(group==="Premium")return " Este control aplica a clientes Premium.";
    if(group==="Business")return " Este control aplica a clientes JMX Business.";
    return "";
  }
  function featureText(k,el){return (featureHelp[k]||`Controla la función ${k}.`)+scopeText(el)}
  function helpFor(el){
    if(!el)return "";if(el.dataset?.tooltip)return el.dataset.tooltip;if(exact[el.id])return exact[el.id];
    const featureRow=el.closest?.("[data-feature]");if(featureRow)return featureText(featureRow.dataset.feature,featureRow);
    const clientFeature=el.closest?.("[data-client-feature], [data-client-feature-select]");if(clientFeature){const k=clientFeature.dataset.clientFeature||clientFeature.dataset.clientFeatureSelect;return (featureHelp[k]||"Controla esta función.")+" Este override afecta solamente a este cliente; si se deja en Heredar, sigue la configuración normal de su plan."}
    const nfcSetting=el.closest?.("[data-nfc-setting-group]");if(nfcSetting)return "Activa o desactiva las tarjetas NFC físicas con ID para este nivel de control."+scopeText(nfcSetting);
    if(el.matches?.("[data-feature-expand],[data-panel-expand],[data-nfc-expand]"))return el.getAttribute("aria-expanded")==="true"?"Contrae esta sección.":"Expande esta sección para ver más controles o registros.";
    if(el.matches?.("[data-nfc-copy-url]"))return "Copia la URL única que utiliza esta tarjeta NFC para resolver y abrir el perfil correspondiente.";
    if(el.matches?.("[data-delivery-kit]"))return actionHelp["delivery-kit"];
    if(el.matches?.('[data-device-life="lost"]'))return "Marca esta tarjeta física como perdida y la saca del uso normal hasta que el administrador cambie su estado o la reemplace.";
    if(el.matches?.('[data-device-life="stolen"]'))return "Marca esta tarjeta física como robada y deshabilita su uso normal.";
    if(el.matches?.('[data-device-life="retired"]'))return "Retira permanentemente esta tarjeta física del servicio normal y conserva su historial administrativo.";
    if(el.matches?.('[data-device-life="archived"]'))return "Archiva el registro de esta tarjeta para quitarla de la operación normal, conservando su historial.";
    if(el.matches?.("[data-replace-device]"))return actionHelp.replace;
    if(el.matches?.("[data-open-batch]"))return "Abre el lote al que pertenece esta tarjeta NFC.";
    if(el.matches?.("[data-nfc-client-action=return]"))return actionHelp.return;
    if(el.matches?.("[data-nfc-client-action=delete]"))return "Elimina permanentemente este cliente y su tarjeta NFC después de dos confirmaciones.";
    if(el.matches?.("[data-open-linked-nfc]"))return "Abre los detalles administrativos de la tarjeta NFC física vinculada a este cliente.";
    for(const [key,text] of Object.entries(actionHelp)){if(el.matches?.(`[data-${key}], [data-dialog-action="${key}"], [data-nfc-client-action="${key}"], [data-device-life="${key}"]`))return text}
    const txt=clean(el.getAttribute?.("aria-label")||el.textContent||el.placeholder);
    if(!txt)return "";
    if(/delete permanently|eliminar permanentemente/i.test(txt))return "Elimina permanentemente este registro después de las confirmaciones requeridas.";
    if(/return.*inventory|devolver.*inventario/i.test(txt))return actionHelp.return;
    if(/replace|reemplazar/i.test(txt))return actionHelp.replace;
    if(/suspend profile|suspender perfil/i.test(txt))return "Suspende temporalmente el perfil completo del cliente sin borrar sus datos.";
    if(/archive profile|perfil de archivo|archivar perfil/i.test(txt))return "Archiva el perfil administrativo del cliente conservando su historial.";
    if(/suspend|suspender/i.test(txt))return actionHelp.suspend;
    if(/reactivate|reactivar|enable|habilitar/i.test(txt))return "Vuelve a habilitar esta función, tarjeta o perfil según el control seleccionado.";
    if(/disable|deshabilitar/i.test(txt))return "Deshabilita temporalmente esta función o elemento según el control seleccionado.";
    if(/save|guardar/i.test(txt))return "Guarda estos cambios.";
    if(/copy|copiar/i.test(txt))return "Copia este valor al portapapeles.";
    if(/random|regenerar/i.test(txt))return "Genera un nuevo valor aleatorio para este campo.";
    if(/cancel|cancelar/i.test(txt))return "Cancela y cierra sin completar esta acción.";
    if(/close|cerrar|×|^x$/i.test(txt))return "Cierra esta ventana.";
    if(/search|buscar/i.test(txt))return "Busca registros que coincidan con la información escrita.";
    if(/view all|ver todos/i.test(txt))return "Muestra todos los registros de esta sección.";
    if(/add.*nfc|añadir.*nfc/i.test(txt))return "Permite agregar o asignar tarjetas NFC con ID adicionales a este cliente.";
    if(/assign.*batch|asignar.*lote/i.test(txt))return "Permite asignar a este cliente tarjetas de un lote NFC de tarjetas existente.";
    if(/open profile|abrir perfil/i.test(txt))return "Abre el perfil público de este cliente.";
    if(/edit profile|editar perfil/i.test(txt))return "Abre el editor del perfil de este cliente.";
    if(/copy.*recover|recover url|recuperar url/i.test(txt))return "Copia o recupera la URL pública de este perfil.";
    if(/create|crear/i.test(txt))return `${txt}. Abre el formulario para realizar esta acción.`;
    if(el.matches?.('input[type="checkbox"]')){const label=clean(el.closest("label")?.querySelector("span,strong")?.textContent||el.closest("label")?.textContent);return label?`Activa o desactiva ${label}.`:"Activa o desactiva esta opción."}
    if(el.matches?.("button,[role=button],select,input[type=search]"))return `${txt}.`;
    return "";
  }
  let tip=null,timer=null,current=null;
  function ensure(){if(tip)return tip;tip=document.createElement("div");tip.className="jmx-admin-tooltip";tip.setAttribute("role","tooltip");tip.id="jmxAdminTooltip";document.body.appendChild(tip);return tip}
  function targetFrom(node){return node?.closest?.('[data-tooltip],button,input[type="checkbox"],input[type="search"],select,[role="button"],[data-feature],[data-client-feature],[data-client-feature-select],[data-nfc-setting-group],summary')||null}
  function place(el){const t=ensure(),r=el.getBoundingClientRect(),tr=t.getBoundingClientRect(),gap=9;let left=r.left+(r.width-tr.width)/2;left=Math.max(8,Math.min(left,innerWidth-tr.width-8));let top=r.top-tr.height-gap;if(top<8)top=Math.min(innerHeight-tr.height-8,r.bottom+gap);t.style.left=`${Math.round(left)}px`;t.style.top=`${Math.round(top)}px`}
  function show(el){if(!finePointer())return;const text=helpFor(el);if(!text)return;current=el;clearTimeout(timer);timer=setTimeout(()=>{if(current!==el)return;const t=ensure();t.textContent=text;t.classList.add("is-visible");requestAnimationFrame(()=>place(el));el.setAttribute("aria-describedby","jmxAdminTooltip")},300)}
  function hide(el){clearTimeout(timer);if(el&&el.getAttribute?.("aria-describedby")==="jmxAdminTooltip")el.removeAttribute("aria-describedby");current=null;if(tip)tip.classList.remove("is-visible")}
  document.addEventListener("pointerover",e=>{const el=targetFrom(e.target);if(el&&el!==current)show(el)});
  document.addEventListener("pointerout",e=>{const el=targetFrom(e.target);if(el&&!el.contains(e.relatedTarget))hide(el)});
  document.addEventListener("focusin",e=>{const el=targetFrom(e.target);if(el)show(el)});
  document.addEventListener("focusout",e=>{const el=targetFrom(e.target);if(el)hide(el)});
  window.addEventListener("scroll",()=>{if(current&&tip?.classList.contains("is-visible"))place(current)},true);window.addEventListener("resize",()=>{if(current&&tip?.classList.contains("is-visible"))place(current)});
})();
