import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

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
    return new URL(`index.html?card=${encodeURIComponent(id)}`, location.href).href;
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
  const snap = await getDocs(collection(db, "cards"));
  const result = [];
  for (const d of snap.docs) {
    if (d.id === "main" && d.data().fullName && !d.data().inventoryVersion) continue;
    const [adminSnap, ownerSnap, inventorySnap] = await Promise.all([
      getDoc(doc(db, "cardAdmin", d.id)),
      getDoc(doc(db, "cardOwners", d.id)),
      getDoc(doc(db, "inventory", d.id))
    ]);
    result.push({
      id: d.id,
      ...d.data(),
      admin: adminSnap.exists() ? adminSnap.data() : {},
      owner: ownerSnap.exists() ? ownerSnap.data() : null,
      inventory: inventorySnap.exists() ? inventorySnap.data() : {}
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

function render() {
  const search = $("searchCards").value.trim().toLowerCase();
  const filter = $("statusFilter").value;
  const list = cards.filter((card) => {
    const admin = card.admin || {};
    const owner = card.owner || {};
    const haystack = [card.id, card.plan, card.status, admin.clientName, admin.notes, owner.ownerEmail].join(" ").toLowerCase();
    return (!search || haystack.includes(search)) && (filter === "all" || card.status === filter);
  });

  $("totalCards").textContent = cards.length;
  $("availableCards").textContent = cards.filter((c) => c.status === "available").length;
  $("activatedCards").textContent = cards.filter((c) => c.status === "activated").length;
  $("suspendedCards").textContent = cards.filter((c) => c.status === "suspended").length;

  $("cardsGrid").innerHTML = list.map((card) => {
    const admin = card.admin || {};
    const owner = card.owner || {};
    const inventory = card.inventory || {};
    return `<article class="client-card" data-id="${esc(card.id)}">
      <div class="client-head"><div><h3>${esc(card.id)}</h3><div class="client-meta">${esc(admin.clientName || owner.ownerEmail || "Unassigned NFC")}</div></div><span class="badge ${badgeClass(card.status)}">${esc(card.status || "available")}</span></div>
      <div class="card-url">${esc(friendlyUrl(card.id))}</div>
      <div class="card-details">
        <div><span>Plan</span><br><strong>${esc(card.plan || "Basic")}</strong></div>
        <div><span>Physical</span><br>${esc(admin.physicalType || "PVC")}</div>
        <div><span>Owner</span><br>${esc(owner.ownerEmail || "Not activated")}</div>
        <div><span>NFC</span><br>${esc(card.nfcStatus || admin.nfcStatus || "not-programmed")}</div>
        <div><span>Activation</span><br>${card.requiresActivationCode !== false ? `<code>${esc(inventory.activationCode || "—")}</code>` : "No code required"}</div>
        <div><span>Activated</span><br>${card.activatedAt?.toDate ? card.activatedAt.toDate().toLocaleDateString() : "—"}</div>
      </div>
      <div class="card-actions">
        <button class="mini" data-action="open">Open</button><button class="mini" data-action="copy">Copy NFC URL</button><button class="mini" data-action="code">Copy Activation</button><button class="mini" data-action="plan">Change Plan</button>
        ${card.status === "available" ? '<button class="mini" data-action="sold">Mark Sold</button>' : ""}
        ${card.status === "activated" ? '<button class="mini danger" data-action="suspend">Suspend</button>' : ""}
        ${card.status === "suspended" ? '<button class="mini" data-action="reactivate">Reactivate</button>' : ""}
        ${["activated", "suspended"].includes(card.status) ? '<button class="mini" data-action="edit">Edit Profile</button>' : ""}
        ${card.status === "available" ? '<button class="mini" data-action="regenerate">Regenerate</button><button class="mini danger" data-action="delete">Delete</button>' : ""}
      </div>
    </article>`;
  }).join("");
  $("emptyState").hidden = list.length > 0;
  document.querySelectorAll(".client-card").forEach((card) => card.addEventListener("click", handleAction));
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

async function handleAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const id = event.currentTarget.dataset.id;
  const card = cards.find((c) => c.id === id);
  const action = button.dataset.action;
  if (action === "open") window.open(friendlyUrl(id), "_blank");
  if (action === "edit") location.href = editorUrl(id);
  if (action === "copy") {
    await copyText(friendlyUrl(id));
    button.textContent = "Copied";
    setTimeout(() => button.textContent = "Copy NFC URL", 1000);
  }
  if (action === "code") {
    const code = card.inventory?.activationCode || "";
    if (!code) return alert("This card has no activation code.");
    await copyText(code);
    button.textContent = "Copied";
    setTimeout(() => button.textContent = "Copy Activation", 1000);
  }
  if (action === "plan") await changePlan(id, card);
  if (action === "sold") await updateStatus(id, "sold");
  if (action === "suspend") await updateStatus(id, "suspended");
  if (action === "reactivate") await updateStatus(id, "activated");
  if (action === "regenerate") await regenerate(id);
  if (action === "delete") await removeAvailable(id);
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
  batch.set(doc(db, "inventory", next), { activationCode: activationCode(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
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
    batch.set(doc(db, "cards", id), { inventoryVersion: 2, status: "available", plan, nfcStatus, requiresActivationCode, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(db, "inventory", id), { activationCode: code, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
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
$("loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") signIn(); });
$("logoutButton").addEventListener("click", () => signOut(auth));
$("newCardButton").addEventListener("click", () => { prepareDialog(); $("cardDialog").showModal(); });
$("cardForm").addEventListener("submit", createCard);
$("closeCardDialog").addEventListener("click", () => $("cardDialog").close());
$("cancelCardButton").addEventListener("click", () => $("cardDialog").close());
$("searchCards").addEventListener("input", render);
$("statusFilter").addEventListener("change", render);
$("newCardId").addEventListener("input", updatePreview);
$("regenerateCode").addEventListener("click", () => { $("newCardId").value = randomCode(); updatePreview(); });
$("regenerateActivation").addEventListener("click", () => $("newActivationCode").value = activationCode());

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
    await loadCards();
  } catch (error) {
    console.error(error);
    setLoginStatus("Could not load dashboard: " + error.message, "error");
  }
});
