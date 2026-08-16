import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

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
function monthKey(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`}
function msg(value, type = "") { $("status").textContent = value; $("status").className = "status " + type; }
async function login() {
  try { await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value); }
  catch (error) { console.error(error); msg("Email or password is incorrect.", "error"); }
}
async function load(currentUser) {
  const q = query(collection(db, "cardOwners"), where("ownerUid", "==", currentUser.uid));
  const snap = await getDocs(q);
  const cards = [];
  for (const d of snap.docs) {
    const [card,stats,month]=await Promise.all([getDoc(doc(db,"cards",d.id)),getDoc(doc(db,"cardStats",d.id)),getDoc(doc(db,"monthlyStats",`${d.id}_${monthKey()}`))]);
    cards.push({ id:d.id,...(card.exists()?card.data():{}),stats:stats.exists()?stats.data():{},monthStats:month.exists()?month.data():{} });
  }
  $("cardList").innerHTML = cards.length ? cards.map((card) => `<a class="owner-card" href="admin.html?card=${encodeURIComponent(card.id)}"><strong>${card.id}</strong><span>${card.plan || "Basic"} • ${card.status || "activated"}${(card.plan||"Basic")==="Premium"?` • ${Number(card.stats?.views||0).toLocaleString()} total views • ${Number(card.monthStats?.views||0).toLocaleString()} this month`:""}</span><i class="fa-solid fa-chevron-right"></i></a>`).join("") : '<p class="muted">No activated cards are linked to this account.</p>';
  $("loginForm").hidden = true;
  $("cards").hidden = false;
}
onAuthStateChanged(auth, (currentUser) => {
  if (currentUser) load(currentUser);
  else { $("loginForm").hidden = false; $("cards").hidden = true; }
});
$("loginButton").onclick = login;
$("password").onkeydown = (e) => { if (e.key === "Enter") login(); };
$("logout").onclick = () => signOut(auth);
