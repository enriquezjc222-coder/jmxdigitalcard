import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDf12K0m93K4cWSotDcSg2fIS-s3uaLW_Y",
  authDomain: "jmx-digital-card.firebaseapp.com",
  projectId: "jmx-digital-card",
  storageBucket: "jmx-digital-card.firebasestorage.app",
  messagingSenderId: "411133047344",
  appId: "1:411133047344:web:07c250e162cde4d63cb3f5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const LEGACY_STORAGE_KEY = "premiumDigitalCardProfile";
const THEME_KEY = "digitalCardTheme";
const CARD_ID = sanitizeCardId(new URLSearchParams(location.search).get("card") || "main");
const cardRef = doc(db, "cards", CARD_ID);
const profileRef = doc(db, "profiles", CARD_ID);
const ownerRef = doc(db, "cardOwners", CARD_ID);
const platformRef = doc(db, "platform", "config");
const mediaCol = collection(db, "cards", CARD_ID, "media");
const adminMetaRef = doc(db, "cardAdmin", CARD_ID);

const VISIBILITY_LABELS = {
  description:"Description", saveContact:"Save Contact button", quickActions:"Quick action buttons",
  phone:"Phone 1", phone2:"Phone 2", whatsapp:"WhatsApp", email:"Email", website:"Website",
  location:"Location", facebook:"Facebook", instagram:"Instagram", linkedin:"LinkedIn",
  twitter:"X / Twitter", tiktok:"TikTok", youtube:"YouTube", businessLinks:"Business Links",
  catalog:"Catalog", customBusiness:"Extra business link", services:"Services", gallery:"Gallery",
  video:"Video", qr:"QR code", finalCTA:"Final contact button"
};

const defaults = {
  fullName:"", position:"", company:"",
  city:"", state:"",
  description:"",
  phone:"", phoneRaw:"", phone2:"", phone2Raw:"",
  whatsapp:"", whatsappRaw:"", email:"", website:"",
  facebook:"", instagram:"", linkedin:"", twitter:"", tiktok:"", youtube:"",
  catalog:"", catalogFileName:"", customBusinessLabel:"",
  customBusinessSubtitle:"", customBusinessUrl:"",
  profileImage:"", coverImage:"", logoImage:"", galleryImages:[], videoUrl:"",
  service1Title:"", service1Description:"", service1Icon:"fa-house",
  service2Title:"", service2Description:"", service2Icon:"fa-screwdriver-wrench",
  service3Title:"", service3Description:"", service3Icon:"fa-paint-roller",
  finalCtaTitle:"Let's Connect", finalCtaText:"",
  finalCtaLabel:"Contact Now", theme:"gold",
  visibility:Object.fromEntries(Object.keys(VISIBILITY_LABELS).map(k=>[k,true]))
};

let currentProfile = structuredCloneSafe(defaults);
let currentUser = null;
let currentCardOwnerUid = null;
let currentCardPlan = "Premium";
let currentRole = "none";
let pendingMedia = new Map();
let pendingDeletes = new Set();

function sanitizeCardId(value){
  const raw = String(value || "main").trim();
  if (raw.toLowerCase() === "main") return "main";
  return raw.toUpperCase().replace(/[^A-Z0-9_-]/g, "-").slice(0, 64) || "main";
}
function structuredCloneSafe(v){ return JSON.parse(JSON.stringify(v)); }
function $id(id){ return document.getElementById(id); }
function getVal(id){ return ($id(id)?.value || "").trim(); }
function setVal(id,v){ const e=$id(id); if(e)e.value=v || ""; }
function normalizePhone(v){ const s=String(v||"").trim(); if(!s)return ""; const digits=s.replace(/\D/g,""); return s.startsWith("+")?"+"+digits:digits.length===10?"+1"+digits:"+"+digits; }
function normalizeURL(v){ const s=String(v||"").trim(); if(!s)return ""; return /^https?:\/\//i.test(s)?s:"https://"+s; }
function setStatus(msg,type="ok"){ const e=$id("saveStatus"); if(!e)return; e.textContent=msg; e.className="save-status "+type; }
function setAuthStatus(msg,type=""){ const e=$id("authStatus"); if(!e)return; e.textContent=msg; e.className="auth-status "+type; }
function setBusy(on){ document.body.classList.toggle("admin-busy",on); [$id("saveProfile"),$id("resetProfile")].forEach(b=>{if(b)b.disabled=on;}); }
function publicCardURL(){
  if(CARD_ID==="main") return location.origin+"/";
  if(["localhost","127.0.0.1"].includes(location.hostname)||location.hostname.endsWith("github.io")) return new URL(`card.html?card=${encodeURIComponent(CARD_ID)}`,location.href).href;
  return `${location.origin}/c/${CARD_ID}`;
}

function setCardIdentity(){ if($id("currentCardId"))$id("currentCardId").textContent=CARD_ID; const a=$id("publicCardUrl"); if(a){a.href=publicCardURL();a.textContent=publicCardURL();} }

function getLegacyProfile(){
  try{
    const raw=localStorage.getItem(LEGACY_STORAGE_KEY);
    if(!raw)return null;
    const p=JSON.parse(raw);
    return {...structuredCloneSafe(defaults),...p,visibility:{...defaults.visibility,...(p.visibility||{})},galleryImages:Array.isArray(p.galleryImages)?p.galleryImages:[]};
  }catch{return null;}
}

async function loadRemoteProfile(){
  const [cardSnap,profileSnap,ownerSnap]=await Promise.all([getDoc(cardRef),getDoc(profileRef),getDoc(ownerRef)]);
  if(!cardSnap.exists()&&!profileSnap.exists()) return null;
  const meta=cardSnap.exists()?cardSnap.data():{};
  currentCardPlan=meta.plan||"Premium";
  currentCardOwnerUid=ownerSnap.exists()?ownerSnap.data().ownerUid:(meta.ownerUid||null);
  const data=profileSnap.exists()?profileSnap.data():meta;
  const p={...structuredCloneSafe(defaults),...data,visibility:{...defaults.visibility,...(data.visibility||{})},galleryImages:[]};
  ["ownerUid","createdAt","updatedAt","plan","status"].forEach(k=>delete p[k]);
  const mediaSnap=await getDocs(mediaCol);const gallery=[];
  mediaSnap.forEach(d=>{const m=d.data(),dataUrl=m.data||"";if(d.id==="logo")p.logoImage=dataUrl;else if(d.id==="profile")p.profileImage=dataUrl;else if(d.id==="cover")p.coverImage=dataUrl;else if(d.id==="catalog"){p.catalogFile=dataUrl;p.catalogFileName=m.name||p.catalogFileName||"";}else if(d.id.startsWith("gallery-")){const i=Number(d.id.split("-")[1]);if(Number.isInteger(i))gallery[i]=dataUrl;}});
  p.galleryImages=gallery.filter(Boolean);return p;
}

function profileForFirestore(p){
  const clean={...p};
  delete clean.profileImage;delete clean.coverImage;delete clean.logoImage;delete clean.galleryImages;delete clean.catalogFile;delete clean.status;
  clean.updatedAt=serverTimestamp();
  return clean;
}

async function ensureCardDocument(){
  const snap=await getDoc(profileRef);
  if(snap.exists())return;
  const p=collectFormProfile();
  await setDoc(profileRef,profileForFirestore(p),{merge:true});
}

async function saveMediaDoc(id,data,name=""){
  if(!data){ await deleteDoc(doc(db,"cards",CARD_ID,"media",id)).catch(()=>{}); return; }
  await setDoc(doc(db,"cards",CARD_ID,"media",id),{data,name,updatedAt:serverTimestamp()},{merge:true});
}

function setInputData(profile){
  const ids=["fullName","position","company","city","state","description","phone","phone2","whatsapp","email","website","facebook","instagram","linkedin","twitter","tiktok","youtube","catalog","customBusinessLabel","customBusinessSubtitle","customBusinessUrl","videoUrl","service1Title","service1Description","service1Icon","service2Title","service2Description","service2Icon","service3Title","service3Description","service3Icon","finalCtaTitle","finalCtaText","finalCtaLabel"];
  ids.forEach(id=>setVal(id,profile[id]));
  updatePreview("profilePreview","profilePlaceholder",profile.profileImage);
  updatePreview("coverPreview","coverPlaceholder",profile.coverImage);
  renderGalleryPreview(profile.galleryImages);
  loadVisibility(profile.visibility);
  setThemeActive(profile.theme||"gold");
}

function buildVisibility(){
  const grid=$id("visibilityGrid"); if(!grid)return; grid.innerHTML="";
  Object.entries(VISIBILITY_LABELS).forEach(([key,label])=>{
    const l=document.createElement("label");l.className="toggle-item";
    l.innerHTML=`<input type="checkbox" data-vis="${key}"><span>${label}</span>`;grid.appendChild(l);
  });
}
function loadVisibility(v){ document.querySelectorAll("[data-vis]").forEach(el=>el.checked=v?.[el.dataset.vis]!==false); }
function readVisibility(){ const out={}; document.querySelectorAll("[data-vis]").forEach(el=>out[el.dataset.vis]=el.checked); return out; }
function setThemeActive(theme){ document.querySelectorAll(".admin-theme").forEach(b=>b.classList.toggle("active",b.dataset.theme===theme)); }
function updatePreview(imgId,phId,src){ const img=$id(imgId),ph=$id(phId); if(!img||!ph)return; if(src){img.src=src;img.style.display="block";ph.style.display="none"}else{img.removeAttribute("src");img.style.display="none";ph.style.display="flex"} }
function renderGalleryPreview(images){ const box=$id("galleryPreview");if(!box)return;box.innerHTML="";(images||[]).forEach(src=>{const img=document.createElement("img");img.src=src;box.appendChild(img)}); }

async function compressImage(file,maxW,maxH,targetBytes=520000){
  if(!file.type.startsWith("image/")) throw new Error("Not an image");
  const bitmap=await createImageBitmap(file);
  let scale=Math.min(1,maxW/bitmap.width,maxH/bitmap.height), quality=.82;
  for(let attempt=0;attempt<8;attempt++){
    const w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale));
    const c=document.createElement("canvas");c.width=w;c.height=h;c.getContext("2d").drawImage(bitmap,0,0,w,h);
    const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",quality));
    if(blob && blob.size<=targetBytes){return await blobToDataURL(blob);}
    if(quality>.45)quality-=.1; else scale*=.82;
  }
  throw new Error("Image is too large after compression");
}
function blobToDataURL(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)});}
function fileToDataURL(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)});}

function collectFormProfile(){
  const p={...currentProfile};
  ["fullName","position","company","city","state","description","phone","phone2","whatsapp","email","facebook","instagram","linkedin","twitter","tiktok","youtube","customBusinessLabel","customBusinessSubtitle","videoUrl","service1Title","service1Description","service1Icon","service2Title","service2Description","service2Icon","service3Title","service3Description","service3Icon","finalCtaTitle","finalCtaText","finalCtaLabel"].forEach(id=>p[id]=getVal(id));
  p.website=normalizeURL(getVal("website")); p.catalog=normalizeURL(getVal("catalog")); p.customBusinessUrl=normalizeURL(getVal("customBusinessUrl"));
  ["facebook","instagram","linkedin","twitter","tiktok","youtube"].forEach(k=>p[k]=normalizeURL(p[k]));
  p.phoneRaw=normalizePhone(p.phone); p.phone2Raw=normalizePhone(p.phone2); p.whatsappRaw=normalizePhone(p.whatsapp);
  p.visibility=readVisibility(); p.theme=document.querySelector(".admin-theme.active")?.dataset.theme||currentProfile.theme||"gold";
  return p;
}

async function loadAdminMeta(){
  try{
    const [cardSnap,ownerSnap]=await Promise.all([getDoc(cardRef),getDoc(ownerRef)]);
    const c=cardSnap.exists()?cardSnap.data():{},o=ownerSnap.exists()?ownerSnap.data():{};
    if(currentRole==="owner"){
      setVal("clientEditorEmail",o.ownerEmail||currentUser?.email||"");
      if($id("clientPlan"))$id("clientPlan").value=c.plan||"Basic"; if($id("complimentaryPremium"))$id("complimentaryPremium").checked=c.complimentaryPremium===true; if($id("subscriptionStatus"))$id("subscriptionStatus").value=c.subscription?.status||"none"; if($id("subscriptionSource"))$id("subscriptionSource").value=c.complimentaryPremium?"complimentary":(c.subscription?.source||"manual");
      if($id("cardStatus"))$id("cardStatus").value=c.status||"activated";
      if($id("nfcStatus"))$id("nfcStatus").value=c.nfcStatus||"programmed";
      return;
    }
    const snap=await getDoc(adminMetaRef),m=snap.exists()?snap.data():{};
    setVal("clientName",m.clientName||currentProfile.fullName||"");setVal("clientEmail",m.clientEmail||o.ownerEmail||"");setVal("clientPhone",m.clientPhone||"");setVal("renewalDate",m.renewalDate||"");setVal("internalNotes",m.notes||"");
    if($id("clientPlan"))$id("clientPlan").value=c.plan||m.plan||"Basic"; if($id("complimentaryPremium"))$id("complimentaryPremium").checked=c.complimentaryPremium===true; if($id("subscriptionStatus"))$id("subscriptionStatus").value=c.subscription?.status||"none"; if($id("subscriptionSource"))$id("subscriptionSource").value=c.complimentaryPremium?"complimentary":(c.subscription?.source||"manual");
    if($id("cardStatus"))$id("cardStatus").value=c.status||"activated";
    if($id("nfcStatus"))$id("nfcStatus").value=c.nfcStatus||m.nfcStatus||"programmed";
    setVal("clientEditorEmail",o.ownerEmail||"");
  }catch(e){console.warn("Admin metadata could not be loaded",e)}
}

async function saveAdminMeta(p){
  if(currentRole!=="admin")return;
  const existing=await getDoc(adminMetaRef);
  const data={clientName:getVal("clientName")||p.fullName||CARD_ID,clientEmail:getVal("clientEmail"),clientPhone:getVal("clientPhone"),company:p.company||"",renewalDate:getVal("renewalDate"),nfcStatus:$id("nfcStatus")?.value||"programmed",notes:getVal("internalNotes"),updatedAt:serverTimestamp()};
  if(!existing.exists())data.createdAt=serverTimestamp();
  await setDoc(adminMetaRef,data,{merge:true});
  const comp=$id("complimentaryPremium")?.checked===true; await setDoc(cardRef,{plan:$id("clientPlan")?.value||currentCardPlan,complimentaryPremium:comp,subscription:{status:comp?"active":($id("subscriptionStatus")?.value||"none"),source:comp?"complimentary":($id("subscriptionSource")?.value||"manual")},status:$id("cardStatus")?.value||"activated",nfcStatus:$id("nfcStatus")?.value||"programmed",updatedAt:serverTimestamp()},{merge:true});
}

async function saveCardAccess(){ return; }

async function saveProfile(){
  if(!currentUser)return setStatus("Sign in first.","error");
  const p=collectFormProfile(); if(!p.fullName)return setStatus("Please enter a name.","error");
  setBusy(true); setStatus("Publishing changes online...","working");
  try{
    await setDoc(profileRef,profileForFirestore(p),{merge:true});
    await saveAdminMeta(p);
    await saveCardAccess();
    for(const [id,m] of pendingMedia.entries()) await saveMediaDoc(id,m.data,m.name||"");
    for(const id of pendingDeletes) await saveMediaDoc(id,"");
    pendingMedia.clear();pendingDeletes.clear();
    currentProfile=p;
    try{localStorage.setItem(LEGACY_STORAGE_KEY,JSON.stringify(p));localStorage.setItem(THEME_KEY,p.theme);}catch{}
    setStatus("Changes published successfully. They are now visible on every device.","ok");
  }catch(e){ console.error(e); setStatus(firebaseMessage(e),"error"); }
  finally{setBusy(false);}
}

async function resetAll(){
  if(!currentUser)return;
  if(!confirm("Reset this card to defaults and publish the reset?"))return;
  setBusy(true);
  try{
    currentProfile=structuredCloneSafe(defaults); setInputData(currentProfile);
    await setDoc(profileRef,profileForFirestore(currentProfile));
    const media=await getDocs(mediaCol); await Promise.all(media.docs.map(d=>deleteDoc(d.ref)));
    pendingMedia.clear();pendingDeletes.clear();
    setStatus("Card reset and published.");
  }catch(e){setStatus(firebaseMessage(e),"error");}finally{setBusy(false);}
}

function firebaseMessage(e){
  const code=e?.code||"";
  if(code.includes("permission-denied"))return "Firebase blocked the change. Check Firestore rules and that you are signed in.";
  if(code.includes("not-found")||code.includes("failed-precondition"))return "Firestore is not ready yet. Create the Firestore database in Firebase Console.";
  if(code.includes("auth/invalid-credential"))return "Email or password is incorrect.";
  return "Could not save online: "+(e?.message||"Unknown Firebase error");
}

async function stageImage(inputId,field,imgId,phId,maxW,maxH,mediaId){
  const input=$id(inputId); if(!input)return;
  input.addEventListener("change",async e=>{
    const f=e.target.files?.[0];if(!f)return;
    setStatus("Preparing image...","working");
    try{
      const data=await compressImage(f,maxW,maxH); currentProfile[field]=data;
      pendingMedia.set(mediaId,{data,name:f.name});pendingDeletes.delete(mediaId);
      updatePreview(imgId,phId,data);setStatus("Image ready. Press Save Changes to publish it.");
    }catch(err){setStatus("Could not process that image. Try a smaller image.","error")}
  });
}

async function handleGallery(files){
  const chosen=[...files].slice(0,6);if(!chosen.length)return;
  setStatus("Preparing gallery...","working");
  try{
    const images=[];
    for(let i=0;i<chosen.length;i++){
      const data=await compressImage(chosen[i],1200,900,500000);images.push(data);
      pendingMedia.set(`gallery-${i}`,{data,name:chosen[i].name});pendingDeletes.delete(`gallery-${i}`);
    }
    for(let i=chosen.length;i<6;i++){pendingDeletes.add(`gallery-${i}`);pendingMedia.delete(`gallery-${i}`);}
    currentProfile.galleryImages=images;renderGalleryPreview(images);setStatus("Gallery ready. Press Save Changes to publish it.");
  }catch(e){setStatus("Could not process one of the gallery images. Try smaller photos.","error")}
}

async function handleCatalog(file){
  if(!file)return;if(file.type!=="application/pdf")return setStatus("Please choose a PDF.","error");
  if(file.size>600000)return setStatus("For online storage, this PDF must be under 600 KB. For larger catalogs, use Catalog URL.","error");
  try{const data=await fileToDataURL(file);currentProfile.catalogFile=data;currentProfile.catalogFileName=file.name;pendingMedia.set("catalog",{data,name:file.name});pendingDeletes.delete("catalog");setStatus("PDF ready. Press Save Changes to publish it.");}catch{setStatus("Could not read that PDF.","error")}
}

function configureEditorEvents(){
  stageImage("profileUpload","profileImage","profilePreview","profilePlaceholder",700,700,"profile");
  stageImage("coverUpload","coverImage","coverPreview","coverPlaceholder",1600,900,"cover");
  $id("galleryUpload")?.addEventListener("change",e=>handleGallery(e.target.files));
  $id("clearGallery")?.addEventListener("click",()=>{currentProfile.galleryImages=[];renderGalleryPreview([]);for(let i=0;i<6;i++){pendingDeletes.add(`gallery-${i}`);pendingMedia.delete(`gallery-${i}`)}setStatus("Gallery will be removed when you press Save Changes.")});
  $id("catalogUpload")?.addEventListener("change",e=>handleCatalog(e.target.files?.[0]));
  document.querySelectorAll("[data-clear-image]").forEach(b=>b.addEventListener("click",()=>{const field=b.dataset.clearImage;const map={profileImage:["profilePreview","profilePlaceholder","profile"],coverImage:["coverPreview","coverPlaceholder","cover"]};const m=map[field];if(!m)return;currentProfile[field]="";pendingDeletes.add(m[2]);pendingMedia.delete(m[2]);updatePreview(m[0],m[1],"");setStatus("Image will be removed when you press Save Changes.")}));
  document.querySelectorAll(".admin-theme").forEach(b=>b.addEventListener("click",()=>setThemeActive(b.dataset.theme)));
  $id("saveProfile")?.addEventListener("click",saveProfile);$id("resetProfile")?.addEventListener("click",resetAll);
  const view=$id("viewCardButton");if(view)view.href=publicCardURL(); setCardIdentity();
}

async function signIn(){
  const email=getVal("adminEmail"),password=$id("adminPassword")?.value||"";
  if(!email||!password)return setAuthStatus("Enter your Firebase admin email and password.","error");
  setAuthStatus("Signing in...","working");
  try{await signInWithEmailAndPassword(auth,email,password);}catch(e){setAuthStatus(firebaseMessage(e),"error");}
}

async function loadAfterAuth(){
  setBusy(true);setStatus("Loading online card...","working");
  try{
    let remote=await loadRemoteProfile();
    if(!remote){
      remote=getLegacyProfile()||structuredCloneSafe(defaults);
      pendingMedia.clear(); pendingDeletes.clear();
      if(remote.logoImage) pendingMedia.set("logo",{data:remote.logoImage,name:"legacy-logo"});
      if(remote.profileImage) pendingMedia.set("profile",{data:remote.profileImage,name:"legacy-profile"});
      if(remote.coverImage) pendingMedia.set("cover",{data:remote.coverImage,name:"legacy-cover"});
      (remote.galleryImages||[]).slice(0,6).forEach((data,i)=>{if(data)pendingMedia.set(`gallery-${i}`,{data,name:`legacy-gallery-${i+1}`})});
      if(remote.catalogFile) pendingMedia.set("catalog",{data:remote.catalogFile,name:remote.catalogFileName||"catalog.pdf"});
      setStatus("No online card exists yet. Your current browser copy is loaded; press Save Changes once to publish it.","working");
    }else{
      pendingMedia.clear(); pendingDeletes.clear();
      setStatus("Online card loaded.");
    }
    currentProfile=remote;setInputData(currentProfile);await loadAdminMeta();
  }catch(e){console.error(e);currentProfile=getLegacyProfile()||structuredCloneSafe(defaults);setInputData(currentProfile);setStatus(firebaseMessage(e),"error");}
  finally{setBusy(false);}
}


function statMonthKey(offset=0){const d=new Date();d.setMonth(d.getMonth()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`}
function statDayKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function prettyAction(name){return ({whatsapp:"WhatsApp",phone:"Phone",email:"Email",website:"Website",facebook:"Facebook",instagram:"Instagram",linkedin:"LinkedIn",twitter:"X / Twitter",tiktok:"TikTok",youtube:"YouTube",catalog:"Catalog",saveContact:"Save Contact",share:"Share",text:"Text Message",customLink:"Business Link",cta:"Contact Button"})[name]||name||"—"}
async function loadPremiumOwnerStats(){
  const section=$id("premiumStatsSection");if(!section)return;
  const show=currentRole==="owner"&&String(currentCardPlan).toLowerCase()==="premium";section.hidden=!show;if(!show)return;
  try{
    const [totalSnap,monthSnap,prevSnap]=await Promise.all([getDoc(doc(db,"cardStats",CARD_ID)),getDoc(doc(db,"monthlyStats",`${CARD_ID}_${statMonthKey(0)}`)),getDoc(doc(db,"monthlyStats",`${CARD_ID}_${statMonthKey(-1)}`))]);
    const total=totalSnap.exists()?totalSnap.data():{},month=monthSnap.exists()?monthSnap.data():{},prev=prevSnap.exists()?prevSnap.data():{};
    $id("ownerMonthViews").textContent=Number(month.views||0).toLocaleString();$id("ownerTotalViews").textContent=Number(total.views||0).toLocaleString();$id("ownerPreviousViews").textContent=Number(prev.views||0).toLocaleString();
    const pv=Number(prev.views||0),mv=Number(month.views||0);$id("ownerMonthCompare").textContent=pv?`${mv>=pv?"+":""}${Math.round((mv-pv)/pv*100)}% vs previous month`:(mv?"New activity this month":"No previous-month data");
    const actions=month.actions||{};const top=Object.entries(actions).sort((a,b)=>Number(b[1])-Number(a[1]))[0];$id("ownerTopAction").textContent=top?prettyAction(top[0]):"—";$id("ownerTopActionCount").textContent=top?`${Number(top[1]).toLocaleString()} clicks this month`:"No clicks yet";
    const days=[];for(let i=29;i>=0;i--){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-i);days.push({d,key:statDayKey(d),v:0})}
    await Promise.all(days.map(async x=>{const snap=await getDoc(doc(db,"dailyStats",`${CARD_ID}_${x.key}`));x.v=snap.exists()?Number(snap.data().views||0):0}));
    const max=Math.max(1,...days.map(x=>x.v)),chart=$id("owner30DayChart");chart.innerHTML=days.map(x=>`<span class="mini-bar" style="height:${Math.max(4,Math.round(x.v/max*100))}%" title="${x.key}: ${x.v} opens"></span>`).join("");
  }catch(e){console.warn("Premium owner stats unavailable",e)}
}
const PREMIUM_ONLY_IDS=new Set(["phone2","website","instagram","linkedin","twitter","tiktok","youtube","catalog","catalogUpload","customBusinessLabel","customBusinessSubtitle","customBusinessUrl","videoUrl","service1Title","service1Description","service1Icon","service2Title","service2Description","service2Icon","service3Title","service3Description","service3Icon","galleryUpload","clearGallery","finalCtaTitle","finalCtaText","finalCtaLabel"]);
function applyPlanLocks(){
  const basic=currentCardPlan.toLowerCase()==="basic"&&currentRole==="owner";
  document.querySelectorAll("input,textarea,select,button").forEach(el=>{if(PREMIUM_ONLY_IDS.has(el.id))el.disabled=basic});
  const basicVisibility=new Set(["description","saveContact","quickActions","phone","whatsapp","email","location","facebook","qr"]);
  document.querySelectorAll("[data-vis]").forEach(el=>{if(basic&&!basicVisibility.has(el.dataset.vis))el.disabled=true});
  let note=$id("planAccessNote");if(!note){note=document.createElement("div");note.id="planAccessNote";note.className="admin-note";document.querySelector(".card-management-section")?.after(note)}
  note.innerHTML=`<strong>Plan:</strong> ${currentCardPlan}. ${basic?"Premium-only fields are locked for this owner account.":"All enabled plan features are available."}`;
}

document.addEventListener("DOMContentLoaded",()=>{
  buildVisibility();configureEditorEvents();setCardIdentity();
  $id("adminLogin")?.addEventListener("click",signIn);
  $id("adminPassword")?.addEventListener("keydown",e=>{if(e.key==="Enter")signIn()});
  $id("adminLogout")?.addEventListener("click",()=>signOut(auth));
  onAuthStateChanged(auth,async user=>{
    currentUser=user||null;document.body.classList.toggle("admin-authenticated",Boolean(user));
    if(!user){currentRole="none";setAuthStatus("Sign in to edit your JMX Digital Card.");$id("adminUserEmail").textContent="";return;}
    try{
      const [cfg,ownerSnap,cardSnap]=await Promise.all([getDoc(platformRef),getDoc(ownerRef),getDoc(cardRef)]);
      let adminUser=cfg.exists()&&cfg.data().adminUid===user.uid;
      if(!cfg.exists()&&cardSnap.exists()&&cardSnap.data().ownerUid===user.uid){await setDoc(platformRef,{adminUid:user.uid,adminEmail:user.email||"",createdAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});adminUser=true;}
      const ownerUser=ownerSnap.exists()&&ownerSnap.data().ownerUid===user.uid;
      if(!adminUser&&!ownerUser){await signOut(auth);return setAuthStatus("This account does not own this card.","error");}
      currentRole=adminUser?"admin":"owner";currentCardOwnerUid=ownerSnap.exists()?ownerSnap.data().ownerUid:null;
      document.body.classList.toggle("client-owner-mode",currentRole==="owner");
      setAuthStatus(`Signed in as ${user.email||currentRole}. ${currentRole==="admin"?"JMX administrator":"Card owner"}.`,"ok");$id("adminUserEmail").textContent=user.email||currentRole;
      await loadAfterAuth();applyPlanLocks();await loadPremiumOwnerStats();
    }catch(e){console.error(e);setAuthStatus(firebaseMessage(e),"error");}
  });
});
