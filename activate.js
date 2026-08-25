import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getFirestore, doc, getDoc, writeBatch, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

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
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
const $ = (id) => document.getElementById(id);
const CARD_ID = (new URLSearchParams(location.search).get("card") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
let mode = "new";
let card = null;

function msg(value, type = "") { $("status").textContent = value; $("status").className = "status " + type; }
function blankProfile() {
  return {
    fullName: "", position: "", company: "", city: "", state: "", description: "", phone: "", phoneRaw: "", phone2: "", phone2Raw: "", whatsapp: "", whatsappRaw: "", email: "", website: "",
    facebook: "", instagram: "", linkedin: "", twitter: "", tiktok: "", youtube: "", catalog: "", customBusinessLabel: "More Information", customBusinessSubtitle: "Open business link", customBusinessUrl: "", videoUrl: "",
    service1Title: "Service One", service1Description: "", service1Icon: "fa-star", service2Title: "Service Two", service2Description: "", service2Icon: "fa-star", service3Title: "Service Three", service3Description: "", service3Icon: "fa-star",
    finalCtaTitle: "Let's Connect", finalCtaText: "Contact us today.", finalCtaLabel: "Contact Now", theme: "gold", visibility: {}, updatedAt: serverTimestamp()
  };
}
function setMode(next) {
  mode = next;
  $("newAccountMode").classList.toggle("active", mode === "new");
  $("existingAccountMode").classList.toggle("active", mode === "existing");
  $("activateButton").textContent = mode === "new" ? "Create Account & Activate" : "Sign In & Activate";
  msg("");
}
function unavailable(text) {
  $("notAvailableText").textContent = text;
  $("notAvailable").hidden = false;
  $("activationContent").hidden = true;
}
function setBusy(isBusy) {
  $("activateButton").disabled = isBusy;
  $("googleActivateButton").disabled = isBusy;
}
async function boot() {
  if (!CARD_ID) return unavailable("Missing card code.");
  const snap = await getDoc(doc(db, "cards", CARD_ID));
  if (!snap.exists()) return unavailable("This NFC card code does not exist.");
  card = snap.data();
  $("cardLabel").textContent = `Card ${CARD_ID} • ${card.plan || "Basic"} plan`;
  if (["activated", "suspended", "active"].includes(card.status)) return unavailable(card.status === "suspended" ? "This card is suspended." : "This card has already been activated. Use Owner Login to edit it.");
  if (!["available", "sold"].includes(card.status)) return unavailable("This card cannot be activated right now.");
  const noCodeRequired = card.requiresActivationCode === false;
  $("codeWrap").hidden = noCodeRequired;
  $("googleCodeWrap").hidden = noCodeRequired;
  $("activationContent").hidden = false;
}
async function claimCard(currentUser, code) {
  const email = (currentUser.email || "").trim().toLowerCase();

  // Do not read cardOwners here. Firestore intentionally allows that document
  // to be read only by the administrator or the existing owner. A brand-new
  // customer is neither yet, so that preflight read caused permission-denied
  // before the atomic claim could even run. Ownership/availability is already
  // enforced safely by the Firestore rules during the batch commit.
  const profileSnap = await getDoc(doc(db, "profiles", CARD_ID));
  const batch = writeBatch(db);
  batch.set(doc(db, "cardClaims", CARD_ID), {
    ownerUid: currentUser.uid,
    ownerEmail: email,
    activationCode: code,
    createdAt: serverTimestamp()
  });
  batch.set(doc(db, "cardOwners", CARD_ID), {
    ownerUid: currentUser.uid,
    ownerEmail: email,
    activatedAt: serverTimestamp()
  });
  batch.update(doc(db, "cards", CARD_ID), {
    status: "activated",
    activatedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  if (!profileSnap.exists()) batch.set(doc(db, "profiles", CARD_ID), blankProfile());
  await batch.commit();
  await setDoc(doc(db, "ownerActivity", CARD_ID), {
    ownerUid: currentUser.uid,
    lastLoginAt: serverTimestamp()
  }, { merge: true }).catch(() => {});
  msg("Activated! Opening your profile editor…", "ok");
  setTimeout(() => location.href = `admin.html?card=${encodeURIComponent(CARD_ID)}`, 900);
}
function activationError(error) {
  console.error(error);
  const map = {
    "auth/email-already-in-use": "That email already has an account. Choose ‘I Already Have an Account’ or continue with Google.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/popup-closed-by-user": "Google sign-in was closed before it finished.",
    "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.",
    "auth/cancelled-popup-request": "Google sign-in was cancelled. Please try again.",
    "auth/account-exists-with-different-credential": "This email already uses another sign-in method. Sign in with the original method first.",
    "permission-denied": "Activation code is incorrect or this NFC card is not available."
  };
  msg(map[error.code] || error.message || "Activation failed.", "error");
}
async function activateWithEmail() {
  const email = $("email").value.trim().toLowerCase();
  const password = $("password").value;
  const code = $("activationCode").value.trim().toUpperCase();
  if (!email || password.length < 6) return msg("Enter a valid email and a password with at least 6 characters.", "error");
  if (card.requiresActivationCode !== false && !code) return msg("Enter the activation code included with your NFC card.", "error");
  setBusy(true);
  msg("Activating your card…", "working");
  try {
    const cred = mode === "new"
      ? await createUserWithEmailAndPassword(auth, email, password)
      : await signInWithEmailAndPassword(auth, email, password);
    await claimCard(cred.user, code);
  } catch (error) {
    activationError(error);
  } finally {
    setBusy(false);
  }
}
async function activateWithGoogle() {
  const code = $("googleActivationCode").value.trim().toUpperCase();
  if (card.requiresActivationCode !== false && !code) return msg("Enter the activation code included with your NFC card before continuing with Google.", "error");
  setBusy(true);
  msg("Opening Google sign-in…", "working");
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    msg("Google account connected. Activating your card…", "working");
    await claimCard(cred.user, code);
  } catch (error) {
    activationError(error);
  } finally {
    setBusy(false);
  }
}
$("newAccountMode").onclick = () => setMode("new");
$("existingAccountMode").onclick = () => setMode("existing");
$("activateButton").onclick = activateWithEmail;
$("googleActivateButton").onclick = activateWithGoogle;
$("password").onkeydown = (e) => { if (e.key === "Enter") activateWithEmail(); };
$("activationCode").onkeydown = (e) => { if (e.key === "Enter") activateWithEmail(); };
$("googleActivationCode").onkeydown = (e) => { if (e.key === "Enter") activateWithGoogle(); };
boot();
