import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, serverTimestamp, writeBatch, query, where, deleteField } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

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
const $ = (id) => document.getElementById(id);
const SAFE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let user = null;
let cards = [];
const PROTECTED_CARD_IDS = new Set(["BOSS"]);
const FEATURE_DEFS = [
  ["description","Description"],["saveContact","Save Contact"],["quickActions","Quick Actions"],["phone","Primary Phone"],["phone2","Second Phone"],["whatsapp","WhatsApp"],["email","Email"],["website","Website"],["location","Location"],["facebook","Facebook"],["instagram","Instagram"],["linkedin","LinkedIn"],["twitter","X / Twitter"],["tiktok","TikTok"],["youtube","YouTube"],["services","Services"],["gallery","Gallery"],["video","Featured Video"],["qr","QR Code"],["finalCTA","Final CTA"],["businessLinks","Business Links"],["catalog","Catalog / PDF"],["customBusiness","Custom Business Link"]
];
const BASIC_FEATURE_DEFAULTS = new Set(["description","saveContact","quickActions","phone","whatsapp","email","location","facebook","qr"]);
function defaultFeatureControls(){
  const global={},Basic={},Premium={};
  FEATURE_DEFS.forEach(([key])=>{global[key]=true;Basic[key]=BASIC_FEATURE_DEFAULTS.has(key);Premium[key]=true});
  return {enabled:true,global,Basic,Premium};
}
let featureControls = defaultFeatureControls();


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
function currentMonthKey(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`}

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
    const [adminSnap, ownerSnap, profileSnap, statsSnap, monthSnap] = await Promise.all([
      getDoc(doc(db, "cardAdmin", id)),
      getDoc(doc(db, "cardOwners", id)),
      getDoc(doc(db, "profiles", id)),
      getDoc(doc(db, "cardStats", id)),
      getDoc(doc(db, "monthlyStats", `${id}_${currentMonthKey()}`))
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
      stats: statsSnap.exists() ? statsSnap.data() : {},
      monthStats: monthSnap.exists() ? monthSnap.data() : {}
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
    cta: "CTA"
  };
  return labels[name] || name.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
}

function actionBreakdown(actions = {}) {
  const entries = Object.entries(actions || {}).filter(([, value]) => Number(value || 0) > 0).sort((a,b)=>Number(b[1])-Number(a[1]));
  if (!entries.length) return '<div class="analytics-empty">No clicks recorded yet.</div>';
  return entries.map(([name, value]) => `<div class="analytics-action-row"><span>${esc(prettyActionName(name))}</span><strong>${Number(value || 0).toLocaleString()}</strong></div>`).join("");
}

function render() {
  const search = $("searchCards").value.trim().toLowerCase();
  const filter = $("statusFilter").value;
  const planFilter = $("planFilter")?.value || "all";
  const list = cards.filter((card) => {
    const admin = card.admin || {};
    const owner = card.owner || {};
    const profile = card.profile || {};
    const haystack = [card.id, card.plan, card.status, admin.clientName, admin.notes, owner.ownerEmail, profile.fullName, profile.company, profile.email, profile.phone].join(" ").toLowerCase();
    return (!search || haystack.includes(search)) && (filter === "all" || card.status === filter) && (planFilter === "all" || (card.complimentaryPremium===true?"Premium":(card.plan || "Basic")) === planFilter);
  });

  $("totalCards").textContent = cards.length;
  $("availableCards").textContent = cards.filter((c) => c.status === "available").length;
  $("activatedCards").textContent = cards.filter((c) => c.status === "activated").length;
  $("suspendedCards").textContent = cards.filter((c) => c.status === "suspended").length;
  const effectivePlan=c=>c.complimentaryPremium===true?"Premium":(c.plan||"Basic");
  const clientStatuses = new Set(["activated", "suspended"]);
  const unclaimedStatuses = new Set(["available", "sold"]);
  $("basicCards").textContent = cards.filter(c=>clientStatuses.has(c.status) && effectivePlan(c)==="Basic").length;
  $("premiumCards").textContent = cards.filter(c=>clientStatuses.has(c.status) && effectivePlan(c)==="Premium").length;
  $("compCards").textContent = cards.filter(c=>c.complimentaryPremium===true).length;
  $("inactiveCards").textContent = cards.filter(c=>unclaimedStatuses.has(c.status) || !c.status).length;

  const inventoryRowMarkup = (card) => {
    const admin = card.admin || {};
    const inventory = card.inventory || {};
    const effective = card.complimentaryPremium===true ? "Premium" : (card.plan || "Basic");
    const note = admin.notes || inventory.notes || "Add private note";
    const created = card.createdAt?.toDate ? card.createdAt.toDate().toLocaleDateString() : "—";
    return `<div class="inventory-list-row-wrap">
      <button class="inventory-list-row" type="button" data-inventory-id="${esc(card.id)}">
        <span class="inventory-list-main">
          <strong>${esc(card.id)}</strong>
          <small>${esc(friendlyUrl(card.id))}</small>
        </span>
        <span class="inventory-list-note" title="${esc(note)}">${esc(note)}</span>
        <span class="inventory-list-plan">${esc(effective)}</span>
        <span class="inventory-list-date"><small>Created</small><strong>${esc(created)}</strong></span>
        <span class="badge ${badgeClass(card.status)}">${esc(card.status || "available")}</span>
        <i class="fa-solid fa-chevron-right"></i>
      </button>
      <button class="inventory-note-edit" type="button" data-edit-note="${esc(card.id)}" title="Edit internal note" aria-label="Edit internal note for ${esc(card.id)}"><i class="fa-solid fa-pen"></i></button>
    </div>`;
  };

  const clientRowMarkup = (card) => {
    const admin = card.admin || {};
    const owner = card.owner || {};
    const profile = card.profile || {};
    const stats = card.stats || {};
    const monthStats = card.monthStats || {};
    const effective = card.complimentaryPremium===true ? "Premium" : (card.plan || "Basic");
    const displayName = profile.fullName || admin.clientName || owner.ownerEmail || card.id;
    return `<button class="client-list-row" type="button" data-client-id="${esc(card.id)}">
      <span class="client-list-main"><strong>${esc(displayName)}</strong><small>${esc(card.id)} · ${esc(owner.ownerEmail || "No owner email")}</small></span>
      <span class="client-list-plan">${esc(effective)}</span>
      <span class="client-list-stat"><strong>${Number(stats.views || 0).toLocaleString()}</strong><small>total views</small></span>
      <span class="client-list-stat"><strong>${Number(monthStats.views || 0).toLocaleString()}</strong><small>this month</small></span>
      <span class="badge ${badgeClass(card.status)}">${esc(card.status || "activated")}</span>
      <i class="fa-solid fa-chevron-right"></i>
    </button>`;
  };

  const inventoryList = list.filter(c => unclaimedStatuses.has(c.status) || !c.status);
  const basicList = list.filter(c => clientStatuses.has(c.status) && effectivePlan(c)==="Basic");
  const premiumList = list.filter(c => clientStatuses.has(c.status) && effectivePlan(c)==="Premium");

  const availableInventory = inventoryList.filter((c) => (c.status || "available") === "available");
  const soldInventory = inventoryList.filter((c) => c.status === "sold");
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
  $("basicColumnCount").textContent=basicList.length;
  $("premiumColumnCount").textContent=premiumList.length;
  $("emptyState").hidden = list.length > 0;
  document.querySelectorAll(".inventory-list-row").forEach((row) => row.addEventListener("click", () => openInventoryDialog(row.dataset.inventoryId)));
  document.querySelectorAll(".inventory-note-edit").forEach((button) => button.addEventListener("click", async (event) => {
    event.stopPropagation();
    await editInventoryNote(button.dataset.editNote);
  }));
  document.querySelectorAll(".client-list-row").forEach((row) => row.addEventListener("click", () => openClientDialog(row.dataset.clientId)));
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
  const effective = card.complimentaryPremium===true ? "Premium" : (card.plan || "Basic");
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
          <div><span>Plan</span><strong>${esc(effective)}</strong></div>
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
    <button class="secondary-button" data-dialog-action="note"><i class="fa-solid fa-pen"></i> Edit Internal Note</button>
    ${card.status === "available" ? '<button class="secondary-button" data-dialog-action="sold"><i class="fa-solid fa-tag"></i> Mark Sold</button>' : ""}
    ${card.status === "available" && !PROTECTED_CARD_IDS.has(id) ? '<button class="secondary-button" data-dialog-action="regenerate"><i class="fa-solid fa-arrows-rotate"></i> Regenerate</button><button class="danger-button" data-dialog-action="delete"><i class="fa-solid fa-trash"></i> Delete</button>' : ""}
  `;
  dialog.showModal();
}


async function openClientDialog(id) {
  const card = cards.find((c) => c.id === id);
  if (!card) return;
  const claimSnap = await getDoc(doc(db, "cardClaims", id));
  const profile = card.profile || {};
  const claim = claimSnap.exists() ? claimSnap.data() : {};
  const admin = card.admin || {};
  const owner = card.owner || {};
  const stats = card.stats || {};
  const monthStats = card.monthStats || {};
  const effective = card.complimentaryPremium===true ? "Premium" : (card.plan || "Basic");
  const totalActions = stats.actions || {};
  const monthActions = monthStats.actions || {};
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
          <div><span>Plan</span><strong>${esc(effective)}</strong></div>
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
      <section class="detail-panel analytics-panel">
        <h3>Analytics</h3>
        <div class="analytics-summary">
          <article><span>Total views</span><strong>${Number(stats.views || 0).toLocaleString()}</strong></article>
          <article><span>Views this month</span><strong>${Number(monthStats.views || 0).toLocaleString()}</strong></article>
          <article><span>Total clicks</span><strong>${sumActions(totalActions).toLocaleString()}</strong></article>
          <article><span>Clicks this month</span><strong>${sumActions(monthActions).toLocaleString()}</strong></article>
        </div>
        <div class="analytics-columns">
          <div><h4>All-time clicks</h4>${actionBreakdown(totalActions)}</div>
          <div><h4>This month</h4>${actionBreakdown(monthActions)}</div>
        </div>
      </section>
    </div>`;
  $("clientDetailActions").innerHTML = `
    <button class="secondary-button" data-dialog-action="copy"><i class="fa-solid fa-copy"></i> Copy / Recover URL</button>
    <button class="secondary-button" data-dialog-action="open"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open Profile</button>
    <button class="secondary-button" data-dialog-action="edit"><i class="fa-solid fa-pen"></i> Edit Profile</button>
    <button class="secondary-button" data-dialog-action="plan"><i class="fa-solid fa-layer-group"></i> Change Plan</button>
    ${card.status === "activated" ? '<button class="secondary-button" data-dialog-action="suspend">Suspend</button>' : ''}
    ${card.status === "suspended" ? '<button class="secondary-button" data-dialog-action="reactivate">Reactivate</button>' : ''}
    ${PROTECTED_CARD_IDS.has(id) ? '<span class="protected-note"><i class="fa-solid fa-lock"></i> Protected card: release/delete disabled</span>' : '<button class="danger-button" data-dialog-action="release"><i class="fa-solid fa-rotate-left"></i> Release / Reset for Reuse</button>'}
  `;
  dialog.showModal();
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
  if (action === "note") await editInventoryNote(id);
  if (action === "comp") await toggleComplimentary(id, card);
  if (action === "sold") await updateStatus(id, "sold");
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
    previousMonthStats: card.monthStats || {}
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
  await batch.commit();
  await deleteRefsInChunks(monthSnaps.docs.map((d) => d.ref));
  await deleteRefsInChunks(daySnaps.docs.map((d) => d.ref));
  $("clientDetailDialog")?.close();
  alert(`${id} is available again. Its permanent URL was preserved and a new activation code was generated.`);
  await loadCards();
}

async function toggleComplimentary(id, card){
  const next=card.complimentaryPremium!==true;
  await setDoc(doc(db,"cards",id),{complimentaryPremium:next,updatedAt:serverTimestamp(),subscription:{...(card.subscription||{}),source:next?"complimentary":(card.subscription?.source||"manual"),status:next?"active":(card.subscription?.status||"none")}}, {merge:true});
  await loadCards();
}

async function changePlan(id, card) {
  const next = (card.plan || "Basic") === "Basic" ? "Premium" : "Basic";
  if (!confirm(`Change ${id} from ${card.plan || "Basic"} to ${next}?`)) return;
  await setDoc(doc(db, "cards", id), { plan: next, updatedAt: serverTimestamp() }, { merge: true });
  await loadCards();
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
    finalCtaTitle: "Let's Connect", finalCtaText: "Contact us today.", finalCtaLabel: "Contact Now", theme: "gold", visibility: {}, updatedAt: serverTimestamp()
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
    batch.set(doc(db, "cards", id), { inventoryVersion: 2, status: "available", plan, complimentaryPremium:false, subscription:{status:"none",source:"manual"}, nfcStatus, requiresActivationCode, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
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
$("searchCards").addEventListener("input", render);
$("statusFilter").addEventListener("change", render);
$("planFilter")?.addEventListener("change", render);
$("newCardId").addEventListener("input", updatePreview);
$("regenerateCode").addEventListener("click", () => { $("newCardId").value = randomCode(); updatePreview(); });
$("regenerateActivation").addEventListener("click", () => $("newActivationCode").value = activationCode());

$("closeClientDetailDialog")?.addEventListener("click", () => $("clientDetailDialog").close());
$("clientDetailDialog")?.addEventListener("click", (event) => {
  if (event.target === $("clientDetailDialog")) $("clientDetailDialog").close();
});
async function handleDialogAction(event) {
  const button = event.target.closest("[data-dialog-action]");
  if (!button) return;
  const id = $("clientDetailDialog").dataset.cardId;
  const action = button.dataset.dialogAction;
  await performCardAction(id, action, button);
  if (["plan", "sold", "suspend", "reactivate", "regenerate", "delete", "release"].includes(action) && $("clientDetailDialog").open) {
    $("clientDetailDialog").close();
  }
}
$("clientDetailActions")?.addEventListener("click", handleDialogAction);
$("clientDetailBody")?.addEventListener("click", handleDialogAction);



function mergeFeatureControls(raw={}){
  const d=defaultFeatureControls();
  return {enabled:raw.enabled!==false,global:{...d.global,...(raw.global||{})},Basic:{...d.Basic,...(raw.Basic||{})},Premium:{...d.Premium,...(raw.Premium||{})}};
}
function renderFeatureControls(){
  const enabled=$("featureControlsEnabled"); if(enabled) enabled.checked=featureControls.enabled!==false;
  const panels=$("featurePanels"), show=$("showFeaturePanels"); if(panels&&show) panels.hidden=!show.checked;
  const targets={global:$("globalFeatureSwitches"),Basic:$("basicFeatureSwitches"),Premium:$("premiumFeatureSwitches")};
  Object.entries(targets).forEach(([group,root])=>{
    if(!root)return; root.innerHTML=FEATURE_DEFS.map(([key,label])=>`<label class="feature-switch-item" data-group="${group}" data-feature="${key}"><span>${label}</span><span class="mini-switch"><input type="checkbox" ${featureControls[group]?.[key]!==false?"checked":""}><i></i></span></label>`).join("");
  });
  updateFeatureDependencyUI();
}
function updateFeatureDependencyUI(){
  const globalRoot=$("globalFeatureSwitches"); if(!globalRoot)return;
  const globals={}; globalRoot.querySelectorAll("[data-feature]").forEach(row=>globals[row.dataset.feature]=row.querySelector("input").checked);
  ["basicFeatureSwitches","premiumFeatureSwitches"].forEach(id=>$(id)?.querySelectorAll("[data-feature]").forEach(row=>row.classList.toggle("master-off",globals[row.dataset.feature]===false)));
}
function collectFeatureControls(){
  const next=defaultFeatureControls(); next.enabled=$("featureControlsEnabled")?.checked!==false;
  [["global","globalFeatureSwitches"],["Basic","basicFeatureSwitches"],["Premium","premiumFeatureSwitches"]].forEach(([group,id])=>{
    $(id)?.querySelectorAll("[data-feature]").forEach(row=>next[group][row.dataset.feature]=row.querySelector("input").checked);
  });
  return next;
}
async function saveFeatureControls(){
  const status=$("featureControlStatus"); featureControls=collectFeatureControls();
  try{await setDoc(doc(db,"platform","publicSettings"),{featureControls,updatedAt:serverTimestamp()},{merge:true}); if(status){status.textContent="Feature controls saved and applied to public cards.";status.className="status ok"}}
  catch(e){console.error(e);if(status){status.textContent="Could not save feature controls.";status.className="status error"}}
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
}
async function savePlatformSettings(){
  const payload={premiumEnabled:$("premiumEnabled")?.checked===true,billingEnabled:$("billingEnabled")?.checked===true,privacyRequired:$("privacyRequired")?.checked!==false,premiumCheckoutUrl:$("premiumCheckoutUrl")?.value.trim()||"",privacyPolicyUrl:$("privacyPolicyUrl")?.value.trim()||"",privacyAgreementText:$("privacyAgreementText")?.value.trim()||"",updatedAt:serverTimestamp()};
  const status=$("platformStatus");
  try{await setDoc(doc(db,"platform","publicSettings"),payload,{merge:true});if(status){status.textContent="Platform settings saved.";status.className="status ok"}}catch(e){console.error(e);if(status){status.textContent="Could not save platform settings.";status.className="status error"}}
}
function initMarketing(){
  const q=$("companyQrAdmin");if(q&&window.QRCode){q.innerHTML="";new QRCode(q,{text:"https://jmxdigitalcard.com/",width:140,height:140,colorDark:"#111111",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.H})}
  $("copyCompanyUrl")?.addEventListener("click",async()=>{await copyText("https://jmxdigitalcard.com/");$("copyCompanyUrl").textContent="Copied JMX URL";setTimeout(()=>$("copyCompanyUrl").innerHTML='<i class="fa-solid fa-copy"></i> Copy JMX URL',1200)});
  $("savePlatformButton")?.addEventListener("click",savePlatformSettings);
  $("saveFeatureControls")?.addEventListener("click",saveFeatureControls);
  $("showFeaturePanels")?.addEventListener("change",e=>{if($("featurePanels"))$("featurePanels").hidden=!e.target.checked});
  $("globalFeatureSwitches")?.addEventListener("change",updateFeatureDependencyUI);
}
initMarketing();

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
    await Promise.all([loadCards(),loadPlatformSettings()]);
  } catch (error) {
    console.error(error);
    setLoginStatus("Could not load dashboard: " + error.message, "error");
  }
});
