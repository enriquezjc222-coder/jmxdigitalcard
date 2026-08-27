import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  deleteDoc,
  serverTimestamp,
  deleteField
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
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
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const functions = getFunctions(app);

const LEGACY_STORAGE_KEY = "premiumDigitalCardProfile";
const THEME_KEY = "digitalCardTheme";
const CARD_ID = sanitizeCardId(new URLSearchParams(location.search).get("card") || "main");
const cardRef = doc(db, "cards", CARD_ID);
const profileRef = doc(db, "profiles", CARD_ID);
const ownerRef = doc(db, "cardOwners", CARD_ID);
const platformRef = doc(db, "platform", "config");
const mediaCol = collection(db, "cards", CARD_ID, "media");
const adminMetaRef = doc(db, "cardAdmin", CARD_ID);
const publicSettingsRef = doc(db, "platform", "publicSettings");

const VISIBILITY_LABELS = {
  description:"Description", saveContact:"Save Contact button", quickActions:"Quick action buttons",
  phone:"Phone 1", phone2:"Phone 2", whatsapp:"WhatsApp", email:"Email", website:"Website",
  location:"Location", facebook:"Facebook", instagram:"Instagram", linkedin:"LinkedIn",
  twitter:"X / Twitter", tiktok:"TikTok", youtube:"YouTube", businessLinks:"Business Links",
  catalog:"Catalog", customBusiness:"Extra business link", services:"Services", gallery:"Gallery",
  video:"Video", qr:"QR code", finalCTA:"Final contact button",
  aiScanner:"AI Business Card Scanner", leads:"Leads / My Contacts", googleWalletThemes:"Google Wallet Themes", qrCardThemes:"QR Card Themes"
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
  finalCtaLabel:"Contact Now", theme:"gold", qrCardTheme:"default", qrDarkColor:"#111111", qrLightColor:"#ffffff", removeJmxBranding:false,
  visibility:Object.fromEntries(Object.keys(VISIBILITY_LABELS).map(k=>[k,true]))
};

let currentProfile = structuredCloneSafe(defaults);
let currentUser = null;
let currentCardOwnerUid = null;
let currentCardPlan = "Premium";
let currentCardFeatureOverrides = {};
let currentRole = "none";
let pendingMedia = new Map();
let pendingDeletes = new Set();
const BASIC_FEATURE_DEFAULTS=new Set(["description","saveContact","quickActions","phone","whatsapp","email","location","facebook","qr"]);
const BUSINESS_ONLY_FEATURES=new Set(["customQR","qrDownload","advancedAnalytics","quickCapture","leads","contactNotes","meetingNotes","followUp","csvExport","vcfDownload","contactMap","aiScanner","autoIntroEmail","appleWallet","googleWallet","googleWalletThemes","qrCardThemes","brandingRemoval","advancedNetworkingInsights"]);
const FEATURE_KEYS=[...new Set([...Object.keys(VISIBILITY_LABELS),"customQR","qrDownload","analytics","advancedAnalytics","quickCapture","leads","contactNotes","meetingNotes","followUp","csvExport","vcfDownload","contactMap","aiScanner","autoIntroEmail","appleWallet","googleWallet","googleWalletThemes","qrCardThemes","brandingRemoval","advancedNetworkingInsights"])];
function defaultFeatureControls(){const global={},Basic={},Premium={},Business={};FEATURE_KEYS.forEach(k=>{global[k]=true;Basic[k]=BASIC_FEATURE_DEFAULTS.has(k);Premium[k]=!BUSINESS_ONLY_FEATURES.has(k);Business[k]=true});return{enabled:true,global,Basic,Premium,Business}}
function mergeFeatureControls(raw={}){const d=defaultFeatureControls();return{enabled:raw.enabled!==false,global:{...d.global,...(raw.global||{})},Basic:{...d.Basic,...(raw.Basic||{})},Premium:{...d.Premium,...(raw.Premium||{})},Business:{...d.Business,...(raw.Business||{})}}}
let platformFeatureControls=defaultFeatureControls();
function featureEnabledForPlan(feature){
  // Google Wallet supports an explicit per-client admin override. A stored true/false
  // wins over Global/Plan; an absent value inherits the platform controls.
  if(["googleWallet","googleWalletThemes","qrCardThemes"].includes(feature) && typeof currentCardFeatureOverrides?.[feature]==="boolean") return currentCardFeatureOverrides[feature];
  if(platformFeatureControls.enabled===false){const base=["premium","business"].includes(currentCardPlan.toLowerCase())||BASIC_FEATURE_DEFAULTS.has(feature);return base&&currentCardFeatureOverrides?.[feature]!==false}
  if(platformFeatureControls.global?.[feature]===false)return false;
  const group=currentCardPlan.toLowerCase()==="basic"?platformFeatureControls.Basic:currentCardPlan.toLowerCase()==="business"?platformFeatureControls.Business:platformFeatureControls.Premium;
  return group?.[feature]!==false && currentCardFeatureOverrides?.[feature]!==false;
}
const FEATURE_INPUT_IDS={description:["description"],phone:["phone"],phone2:["phone2"],whatsapp:["whatsapp"],email:["email"],website:["website"],facebook:["facebook"],instagram:["instagram"],linkedin:["linkedin"],twitter:["twitter"],tiktok:["tiktok"],youtube:["youtube"],catalog:["catalog","catalogUpload"],customBusiness:["customBusinessLabel","customBusinessSubtitle","customBusinessUrl"],video:["videoUrl"],services:["service1Title","service1Description","service1Icon","service2Title","service2Description","service2Icon","service3Title","service3Description","service3Icon"],gallery:["galleryUpload","clearGallery"],finalCTA:["finalCtaTitle","finalCtaText","finalCtaLabel"],customQR:["qrDarkColor","qrLightColor"],brandingRemoval:["removeJmxBranding"]};


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
  currentCardPlan=meta.complimentaryBusiness===true?"Business":(meta.complimentaryPremium===true?"Premium":(meta.plan||"Premium"));
  currentCardFeatureOverrides=(meta.featureOverrides&&typeof meta.featureOverrides==="object")?meta.featureOverrides:{};
  currentCardOwnerUid=ownerSnap.exists()?ownerSnap.data().ownerUid:(meta.ownerUid||null);
  const data=profileSnap.exists()?profileSnap.data():meta;
  const p={...structuredCloneSafe(defaults),...data,visibility:{...defaults.visibility,...(data.visibility||{})},galleryImages:[]};
  ["ownerUid","createdAt","updatedAt","plan","status"].forEach(k=>delete p[k]);
  const gallery=[];
  const manifest=(data.media&&typeof data.media==="object")?data.media:{};
  const applyMedia=(id,m={})=>{const url=m.url||m.data||"";if(!url)return;if(id==="logo")p.logoImage=url;else if(id==="profile")p.profileImage=url;else if(id==="cover")p.coverImage=url;else if(id==="catalog"){p.catalogFile=url;p.catalogFileName=m.name||p.catalogFileName||"";}else if(id.startsWith("gallery-")){const i=Number(id.split("-")[1]);if(Number.isInteger(i))gallery[i]=url;}};
  Object.entries(manifest).forEach(([id,m])=>applyMedia(id,m));
  // Backward compatibility: legacy cards may still keep Base64/data URLs in cards/{cardId}/media.
  // New cards use mediaStorageVersion 2 and skip this collection query entirely.
  if(Number(data.mediaStorageVersion||0)<2){
    const mediaSnap=await getDocs(mediaCol);
    mediaSnap.forEach(d=>{if(!manifest[d.id]?.url)applyMedia(d.id,d.data())});
  }
  p.galleryImages=gallery.filter(Boolean);p.media={...manifest};p.mediaStorageVersion=Number(data.mediaStorageVersion||0);return p;
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

function dataUrlToBlob(dataUrl){
  const [head,body]=String(dataUrl||"").split(",",2);
  const mime=(head.match(/^data:([^;]+)/)||[])[1]||"application/octet-stream";
  const bytes=atob(body||"");const arr=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)arr[i]=bytes.charCodeAt(i);
  return new Blob([arr],{type:mime});
}
function safeStorageName(name,mime){
  const base=String(name||"file").replace(/[^a-zA-Z0-9._-]+/g,"-").slice(-90)||"file";
  if(base.includes("."))return base;
  const ext=mime==="application/pdf"?"pdf":mime==="image/png"?"png":mime==="image/webp"?"webp":"jpg";return `${base}.${ext}`;
}
async function deleteStorageMediaEntry(entry){
  if(entry?.storagePath){try{await deleteObject(storageRef(storage,entry.storagePath))}catch(e){if(!String(e?.code||"").includes("object-not-found"))console.warn("Could not remove previous Storage object",e)}}
}
async function uploadMediaToStorage(id,data,name=""){
  const blob=dataUrlToBlob(data),fileName=safeStorageName(name,blob.type);
  const path=`cards/${CARD_ID}/${id}/${Date.now()}-${crypto.randomUUID().slice(0,8)}-${fileName}`;
  const r=storageRef(storage,path);
  await uploadBytes(r,blob,{contentType:blob.type,customMetadata:{cardId:CARD_ID,mediaId:id,ownerUid:currentCardOwnerUid||currentUser?.uid||""}});
  const url=await getDownloadURL(r);
  return {url,storagePath:path,name:fileName,contentType:blob.type,size:blob.size,updatedAtMillis:Date.now()};
}
async function savePendingMediaToStorage(profile){
  const manifest={...((profile.media&&typeof profile.media==="object")?profile.media:{})};
  for(const [id,m] of pendingMedia.entries()){
    const previous=manifest[id];
    const next=await uploadMediaToStorage(id,m.data,m.name||"");
    manifest[id]=next;
    await deleteStorageMediaEntry(previous);
    // Explicit replacement: remove only the replaced legacy media doc after the Storage upload succeeds.
    await deleteDoc(doc(db,"cards",CARD_ID,"media",id)).catch(()=>{});
  }
  for(const id of pendingDeletes){
    await deleteStorageMediaEntry(manifest[id]);delete manifest[id];
    await deleteDoc(doc(db,"cards",CARD_ID,"media",id)).catch(()=>{});
  }
  profile.media=manifest;
  // Only cards already on v2 stay v2. New cards are created v2 by the dashboard.
  if(Number(profile.mediaStorageVersion||0)>=2)profile.mediaStorageVersion=2;
}

function setInputData(profile){
  const ids=["fullName","position","company","city","state","description","phone","phone2","whatsapp","email","website","facebook","instagram","linkedin","twitter","tiktok","youtube","catalog","customBusinessLabel","customBusinessSubtitle","customBusinessUrl","videoUrl","service1Title","service1Description","service1Icon","service2Title","service2Description","service2Icon","service3Title","service3Description","service3Icon","finalCtaTitle","finalCtaText","finalCtaLabel","qrDarkColor","qrLightColor"];
  ids.forEach(id=>setVal(id,profile[id]));
  updatePreview("profilePreview","profilePlaceholder",profile.profileImage);
  updatePreview("coverPreview","coverPlaceholder",profile.coverImage);
  renderGalleryPreview(profile.galleryImages);
  loadVisibility(profile.visibility);
  setThemeActive(profile.theme||"gold"); if($id("removeJmxBranding"))$id("removeJmxBranding").checked=profile.removeJmxBranding===true;
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
  p.visibility=readVisibility(); p.theme=document.querySelector(".admin-theme.active")?.dataset.theme||currentProfile.theme||"gold"; p.qrDarkColor=getVal("qrDarkColor")||"#111111"; p.qrLightColor=getVal("qrLightColor")||"#ffffff"; p.removeJmxBranding=$id("removeJmxBranding")?.checked===true; p.qrCardTheme=selectedQrCardTheme||currentProfile.qrCardTheme||"default";
  return p;
}

async function loadAdminMeta(){
  try{
    const [cardSnap,ownerSnap]=await Promise.all([getDoc(cardRef),getDoc(ownerRef)]);
    const c=cardSnap.exists()?cardSnap.data():{},o=ownerSnap.exists()?ownerSnap.data():{};
    selectedWalletTheme=c.googleWalletTheme||selectedWalletTheme||"default"; selectedQrCardTheme=currentProfile.qrCardTheme||selectedQrCardTheme||"default";
    if(currentRole==="owner"){
      setVal("clientEditorEmail",o.ownerEmail||currentUser?.email||"");
      if($id("clientPlan"))$id("clientPlan").value=c.plan||"Basic"; if($id("complimentaryPremium"))$id("complimentaryPremium").checked=c.complimentaryPremium===true; if($id("complimentaryBusiness"))$id("complimentaryBusiness").checked=c.complimentaryBusiness===true; if($id("subscriptionStatus"))$id("subscriptionStatus").value=c.subscription?.status||"none"; if($id("subscriptionSource"))$id("subscriptionSource").value=(c.complimentaryBusiness||c.complimentaryPremium)?"complimentary":(c.subscription?.source||"manual");
      if($id("cardStatus"))$id("cardStatus").value=c.status||"activated";
      if($id("nfcStatus"))$id("nfcStatus").value=c.nfcStatus||"programmed";
      return;
    }
    const snap=await getDoc(adminMetaRef),m=snap.exists()?snap.data():{};
    setVal("clientName",m.clientName||currentProfile.fullName||"");setVal("clientEmail",m.clientEmail||o.ownerEmail||"");setVal("clientPhone",m.clientPhone||"");setVal("renewalDate",m.renewalDate||"");setVal("internalNotes",m.notes||"");
    if($id("clientPlan"))$id("clientPlan").value=c.plan||m.plan||"Basic"; if($id("complimentaryPremium"))$id("complimentaryPremium").checked=c.complimentaryPremium===true; if($id("complimentaryBusiness"))$id("complimentaryBusiness").checked=c.complimentaryBusiness===true; if($id("subscriptionStatus"))$id("subscriptionStatus").value=c.subscription?.status||"none"; if($id("subscriptionSource"))$id("subscriptionSource").value=(c.complimentaryBusiness||c.complimentaryPremium)?"complimentary":(c.subscription?.source||"manual");
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
  const comp=$id("complimentaryPremium")?.checked===true,compBusiness=$id("complimentaryBusiness")?.checked===true; const selectedPlan=$id("clientPlan")?.value||currentCardPlan||"Basic"; const existingSnap=await getDoc(cardRef); const existingMeta=existingSnap.exists()?existingSnap.data():{}; const hadGift=existingMeta.complimentaryPremium===true||existingMeta.complimentaryBusiness===true; const previousStatus=hadGift?(existingMeta.preGiftSubscriptionStatus||"none"):(existingMeta.subscription?.status||$id("subscriptionStatus")?.value||"none"); const previousSource=hadGift?(existingMeta.preGiftSubscriptionSource||"manual"):(existingMeta.subscription?.source||$id("subscriptionSource")?.value||"manual"); const hasGift=comp||compBusiness; await setDoc(cardRef,{plan:selectedPlan,complimentaryPremium:comp&&!compBusiness,complimentaryBusiness:compBusiness,complimentaryBasePlan:hasGift?selectedPlan:deleteField(),preGiftSubscriptionStatus:hasGift?previousStatus:deleteField(),preGiftSubscriptionSource:hasGift?previousSource:deleteField(),subscription:{status:hasGift?"active":($id("subscriptionStatus")?.value||previousStatus||"none"),source:hasGift?"complimentary":($id("subscriptionSource")?.value||previousSource||"manual"),complimentaryTier:hasGift?(compBusiness?"Business":"Premium"):deleteField()},status:$id("cardStatus")?.value||"activated",nfcStatus:$id("nfcStatus")?.value||"programmed",updatedAt:serverTimestamp()},{merge:true}); await setDoc(doc(db,"inventory",CARD_ID),{plan:selectedPlan,updatedAt:serverTimestamp()},{merge:true});
}

async function saveCardAccess(){ return; }

async function saveProfile(){
  if(!currentUser)return setStatus("Sign in first.","error");
  const p=collectFormProfile(); if(!p.fullName)return setStatus("Please enter a name.","error");
  setBusy(true); setStatus("Publishing changes online...","working");
  try{
    await savePendingMediaToStorage(p);
    await setDoc(profileRef,profileForFirestore(p),{merge:true});
    await saveAdminMeta(p);
    await saveCardAccess();
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
    const oldProfile=await getDoc(profileRef);const oldManifest=oldProfile.exists()?(oldProfile.data().media||{}):{};
    await Promise.all(Object.values(oldManifest).map(entry=>deleteStorageMediaEntry(entry)));
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
  if(code.includes("auth/popup-closed-by-user"))return "Google sign-in was canceled before it finished.";
  if(code.includes("auth/popup-blocked"))return "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.";
  if(code.includes("auth/unauthorized-domain"))return "This domain is not authorized for Google sign-in in Firebase Authentication.";
  if(code.includes("auth/operation-not-allowed"))return "Google sign-in is not enabled yet in Firebase Authentication.";
  return "Could not complete the request: "+(e?.message||"Unknown Firebase error");
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
  if(file.size>10*1024*1024)return setStatus("This PDF must be under 10 MB. For larger catalogs, use Catalog URL.","error");
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

async function signInWithGoogle(){
  setAuthStatus("Opening Google sign-in...","working");
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({prompt:"select_account"});
  try{
    await signInWithPopup(auth,provider);
  }catch(e){
    console.error(e);
    setAuthStatus(firebaseMessage(e),"error");
  }
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
    currentProfile=remote;selectedWalletTheme=remote.googleWalletTheme||"default";selectedQrCardTheme=remote.qrCardTheme||"default";setInputData(currentProfile);await loadAdminMeta();
    try{const settingsSnap=await getDoc(publicSettingsRef);platformFeatureControls=mergeFeatureControls(settingsSnap.exists()?(settingsSnap.data().featureControls||{}):{});}catch(e){console.warn("Feature controls unavailable",e);platformFeatureControls=defaultFeatureControls();}
  }catch(e){console.error(e);currentProfile=getLegacyProfile()||structuredCloneSafe(defaults);setInputData(currentProfile);setStatus(firebaseMessage(e),"error");}
  finally{setBusy(false);}
}


function prettyAction(name){return ({whatsapp:"WhatsApp",phone:"Phone",email:"Email",website:"Website",facebook:"Facebook",instagram:"Instagram",linkedin:"LinkedIn",twitter:"X / Twitter",tiktok:"TikTok",youtube:"YouTube",catalog:"Catalog",saveContact:"Save Contact",share:"Share",text:"Text Message",customLink:"Business Link",cta:"Contact Button",quickCapture:"Quick Capture",leadReceived:"Leads Received",qrVisit:"QR Visits",qrDownload:"QR Download"})[name]||name||"—"}
function sumOwnerActions(actions={}){return Object.values(actions||{}).reduce((sum,value)=>sum+Number(value||0),0)}
async function loadPremiumOwnerStats(){
  const section=$id("premiumStatsSection");if(!section)return;
  const show=currentRole==="owner"&&["premium","business"].includes(String(currentCardPlan).toLowerCase())&&featureEnabledForPlan("analytics");section.hidden=!show;
  const planLower=String(currentCardPlan).toLowerCase();
  const advanced=planLower==="business"&&featureEnabledForPlan("advancedAnalytics");document.querySelectorAll("[data-advanced-analytics]").forEach(el=>el.hidden=!advanced);
  document.querySelectorAll("[data-premium-retired-counter]").forEach(el=>{el.hidden=planLower==="premium"});
  const net=$id("businessNetworkingSection"); if(net){const networkingAllowed=featureEnabledForPlan("qrCardThemes")||(String(currentCardPlan).toLowerCase()==="business"&&(featureEnabledForPlan("customQR")||featureEnabledForPlan("brandingRemoval")));net.hidden=!networkingAllowed;} if(!show)return;
  try{
    const totalSnap=await getDoc(doc(db,"cardStats",CARD_ID));
    const total=totalSnap.exists()?totalSnap.data():{},actions=total.actions||{};
    $id("ownerHistoricalViews").textContent=Number(total.views||0).toLocaleString();
    $id("ownerTrackedActions").textContent=sumOwnerActions(actions).toLocaleString();
    const top=Object.entries(actions).sort((a,b)=>Number(b[1])-Number(a[1]))[0];
    $id("ownerTopAction").textContent=top?prettyAction(top[0]):"—";
    $id("ownerTopActionCount").textContent=top?`${Number(top[1]).toLocaleString()} tracked actions`:"No actions yet";
  }catch(e){console.warn("Owner action analytics unavailable",e)}
}
const PREMIUM_ONLY_IDS=new Set(["phone2","website","instagram","linkedin","twitter","tiktok","youtube","catalog","catalogUpload","customBusinessLabel","customBusinessSubtitle","customBusinessUrl","videoUrl","service1Title","service1Description","service1Icon","service2Title","service2Description","service2Icon","service3Title","service3Description","service3Icon","galleryUpload","clearGallery","finalCtaTitle","finalCtaText","finalCtaLabel"]);
function featureWrappers(feature){
  const ids=FEATURE_INPUT_IDS[feature]||[],nodes=[];
  ids.forEach(id=>{const el=$id(id);if(!el)return;const wrap=el.closest(".form-group,.upload-card,.editor-card")||el; if(!nodes.includes(wrap))nodes.push(wrap)});
  const sectionFeature={services:"service1Title",gallery:"galleryUpload",video:"videoUrl",finalCTA:"finalCtaTitle"}[feature];
  if(sectionFeature){const sec=$id(sectionFeature)?.closest(".admin-section");if(sec&&!nodes.includes(sec))nodes.push(sec)}
  if(feature==="customQR")[$id("qrDarkColor"),$id("qrLightColor")].forEach(el=>{const w=el?.closest(".form-group");if(w&&!nodes.includes(w))nodes.push(w)});
  if(feature==="brandingRemoval"){const w=$id("removeJmxBranding")?.closest(".form-group");if(w&&!nodes.includes(w))nodes.push(w)}
  if(feature==="analytics"){const sec=$id("premiumStatsSection");if(sec&&!nodes.includes(sec))nodes.push(sec)}
  if(feature==="leads"){const sec=$id("businessLeadsSection");if(sec&&!nodes.includes(sec))nodes.push(sec)}
  if(feature==="aiScanner"){const sec=$id("aiScannerSection");if(sec&&!nodes.includes(sec))nodes.push(sec)}
  if(feature==="googleWallet"){const sec=$id("googleWalletSection");if(sec&&!nodes.includes(sec))nodes.push(sec)}
  if(feature==="googleWalletThemes"){const sec=$id("googleWalletThemesSection");if(sec&&!nodes.includes(sec))nodes.push(sec)}
  if(feature==="qrCardThemes"){const sec=$id("qrCardThemesControl");if(sec&&!nodes.includes(sec))nodes.push(sec)}
  return nodes;
}
function setOwnerFeatureVisibility(feature,allowed){
  featureWrappers(feature).forEach(node=>{node.hidden=!allowed;node.dataset.adminFeatureHidden=allowed?"false":"true"});
  document.querySelectorAll(`[data-vis="${feature}"]`).forEach(el=>{const wrap=el.closest(".toggle-item")||el;wrap.hidden=!allowed;el.disabled=!allowed});
}
function collapseEmptyEditorSections(){
  const candidates=["phone","facebook","catalog"];
  candidates.forEach(id=>{const sec=$id(id)?.closest(".admin-section");if(!sec)return;const visible=[...sec.querySelectorAll(".form-group,.upload-card,.editor-card")].some(x=>!x.hidden);sec.hidden=!visible});
  const visSec=$id("visibilityGrid")?.closest(".admin-section");if(visSec)visSec.hidden=![...visSec.querySelectorAll(".toggle-item")].some(x=>!x.hidden);
  const net=$id("businessNetworkingSection");if(net&&currentRole==="owner"){const visible=[...net.querySelectorAll(".form-group,#qrCardThemesControl")].some(x=>!x.hidden);net.hidden=!visible}
}
function applyPlanLocks(){
  const owner=currentRole==="owner";
  document.querySelectorAll("[data-admin-feature-hidden]").forEach(el=>{el.hidden=false;delete el.dataset.adminFeatureHidden});
  document.querySelectorAll("input,textarea,select,button").forEach(el=>{if(PREMIUM_ONLY_IDS.has(el.id))el.disabled=false});
  document.querySelectorAll("[data-vis]").forEach(el=>{el.disabled=false;(el.closest(".toggle-item")||el).hidden=false});
  if(owner){
    FEATURE_KEYS.forEach(feature=>setOwnerFeatureVisibility(feature,featureEnabledForPlan(feature)));
    renderWalletThemes(); renderQrCardThemes();
    Object.entries(FEATURE_INPUT_IDS).forEach(([feature,ids])=>ids.forEach(id=>{const el=$id(id);if(el)el.disabled=!featureEnabledForPlan(feature)}));
    const catalogUpload=$id("catalogUpload");
    if(catalogUpload){const uploadWrap=catalogUpload.closest(".form-group")||catalogUpload;const premiumOwner=String(currentCardPlan).toLowerCase()==="premium";uploadWrap.hidden=premiumOwner;catalogUpload.disabled=premiumOwner||!featureEnabledForPlan("catalog");}
    collapseEmptyEditorSections();
  } else {
    // Add to Google Wallet is an owner-only action; administrators control access
    // from the main dashboard instead of receiving an owner Wallet button here.
    const walletSection=$id("googleWalletSection");if(walletSection)walletSection.hidden=true;
  }
  let note=$id("planAccessNote");if(!note){note=document.createElement("div");note.id="planAccessNote";note.className="admin-note";document.querySelector(".card-management-section")?.after(note)}
  const disabled=FEATURE_KEYS.filter(k=>!featureEnabledForPlan(k)).map(k=>VISIBILITY_LABELS[k]||({customQR:"Custom QR",qrDownload:"QR Download",analytics:"Analytics",advancedAnalytics:"Advanced Analytics",quickCapture:"Quick Capture",leads:"Leads",contactNotes:"Contact Notes",meetingNotes:"Meeting Notes",followUp:"Follow-Up",csvExport:"CSV Export",vcfDownload:"VCF Download",contactMap:"Contact Map",aiScanner:"AI Scanner",autoIntroEmail:"Auto-Intro Email",appleWallet:"Apple Wallet",googleWallet:"Google Wallet",googleWalletThemes:"Google Wallet Themes",brandingRemoval:"Branding Removal",advancedNetworkingInsights:"Advanced Networking Insights"}[k])).filter(Boolean);
  note.innerHTML=`<strong>Plan:</strong> ${currentCardPlan}. ${owner?(disabled.length?`Features disabled by JMX administration are hidden from this editor and from the public card.`:`All available ${currentCardPlan} modules are enabled by JMX administration.`):"Administrator view: all profile fields remain editable; public visibility follows the Feature Control Center."}`;
}





const WALLET_THEMES=[
 {id:"default",name:"JMX Classic",hex:"#1f2937",plans:["Basic","Premium","Business"],css:"linear-gradient(135deg,#111827,#374151)"},
 {id:"silver_uv",name:"Silver UV",hex:"#64748b",plans:["Basic","Premium","Business"],css:"linear-gradient(135deg,#dbeafe 0%,#64748b 32%,#7c3aed 68%,#14b8a6 100%)"},
 {id:"black_gold",name:"Black Gold",hex:"#171717",plans:["Premium","Business"],css:"linear-gradient(135deg,#050505 0%,#262626 55%,#d4af37 100%)"},
 {id:"black_matte",name:"Black Matte Glow",hex:"#111827",plans:["Basic","Premium","Business"],css:"linear-gradient(135deg,#030712,#111827 60%,#22d3ee)"},
 {id:"electric_blue",name:"Electric Blue",hex:"#075985",plans:["Basic","Premium","Business"],css:"linear-gradient(135deg,#020617,#075985 55%,#38bdf8)"},
 {id:"deep_navy",name:"Deep Navy",hex:"#172554",plans:["Premium","Business"],css:"linear-gradient(135deg,#020617,#172554 58%,#6366f1)"},
 {id:"emerald",name:"Emerald",hex:"#065f46",plans:["Basic","Premium","Business"],css:"linear-gradient(135deg,#022c22,#065f46 55%,#34d399)"},
 {id:"teal",name:"Teal Aurora",hex:"#115e59",plans:["Premium","Business"],css:"linear-gradient(135deg,#042f2e,#115e59 55%,#2dd4bf)"},
 {id:"purple",name:"Royal Purple",hex:"#581c87",plans:["Basic","Premium","Business"],css:"linear-gradient(135deg,#1e1b4b,#581c87 55%,#c084fc)"},
 {id:"violet",name:"Violet Beam",hex:"#5b21b6",plans:["Premium","Business"],css:"linear-gradient(135deg,#2e1065,#5b21b6 55%,#a78bfa)"},
 {id:"aurora",name:"Aurora",hex:"#0f766e",plans:["Business"],css:"linear-gradient(135deg,#164e63,#0f766e 42%,#7c3aed 72%,#22d3ee)"},
 {id:"red_matte",name:"Red Matte Glow",hex:"#991b1b",plans:["Basic","Premium","Business"],css:"linear-gradient(135deg,#450a0a,#991b1b 58%,#f87171)"},
 {id:"red_gold",name:"Red Gold",hex:"#9f1239",plans:["Premium","Business"],css:"linear-gradient(135deg,#4c0519,#9f1239 58%,#fbbf24)"},
 {id:"rose_gold",name:"Rose Gold",hex:"#9f5f67",plans:["Premium","Business"],css:"linear-gradient(135deg,#4c1d2f,#9f5f67 55%,#f9a8d4)"},
 {id:"copper",name:"Copper",hex:"#9a3412",plans:["Business"],css:"linear-gradient(135deg,#431407,#9a3412 55%,#fb923c)"},
 {id:"carbon_red",name:"Carbon Red",hex:"#27272a",plans:["Business"],css:"linear-gradient(135deg,#09090b,#27272a 62%,#dc2626)"},
 {id:"gold",name:"Liquid Gold",hex:"#854d0e",plans:["Premium","Business"],css:"linear-gradient(135deg,#422006,#854d0e 52%,#fde047)"},
 {id:"cyan",name:"Electric Cyan",hex:"#0e7490",plans:["Business"],css:"linear-gradient(135deg,#083344,#0e7490 55%,#67e8f9)"},
 // Premium Collection — additive IDs; existing 18 above remain unchanged.
 {id:"platinum_prism",name:"Platinum Prism",hex:"#6b7280",plans:["Business"],tier:"Premium",css:"linear-gradient(125deg,#0b0f17 0%,#cbd5e1 20%,#f8fafc 34%,#8b5cf6 53%,#22d3ee 69%,#64748b 86%,#111827 100%)"},
 {id:"obsidian_chrome",name:"Obsidian Chrome",hex:"#18181b",plans:["Business"],tier:"Premium",css:"linear-gradient(145deg,#020204 0%,#09090b 32%,#52525b 48%,#0a0a0b 62%,#a1a1aa 72%,#09090b 100%)"},
 {id:"midnight_spectrum",name:"Midnight Spectrum",hex:"#111827",plans:["Business"],tier:"Premium",css:"linear-gradient(120deg,#020617 0%,#111827 38%,#312e81 53%,#7c3aed 66%,#059669 80%,#020617 100%)"},
 {id:"ultraviolet_titanium",name:"Ultraviolet Titanium",hex:"#4c1d95",plans:["Business"],tier:"Premium",css:"linear-gradient(135deg,#111827 0%,#71717a 28%,#c4b5fd 43%,#7c3aed 58%,#312e81 74%,#18181b 100%)"},
 {id:"emerald_amethyst",name:"Emerald Amethyst",hex:"#065f46",plans:["Business"],tier:"Premium",css:"linear-gradient(125deg,#022c22 0%,#059669 32%,#34d399 45%,#6d28d9 66%,#c084fc 80%,#111827 100%)"},
 {id:"sapphire_violet",name:"Sapphire Violet",hex:"#1e3a8a",plans:["Business"],tier:"Premium",css:"linear-gradient(130deg,#020617 0%,#1d4ed8 34%,#38bdf8 48%,#7c3aed 67%,#c084fc 82%,#111827 100%)"},
 {id:"crimson_solar",name:"Crimson Solar",hex:"#991b1b",plans:["Business"],tier:"Premium",css:"linear-gradient(135deg,#260303 0%,#7f1d1d 32%,#dc2626 52%,#f59e0b 73%,#fde047 86%,#3f0808 100%)"},
 {id:"ruby_chrome",name:"Ruby Chrome",hex:"#9f1239",plans:["Business"],tier:"Premium",css:"linear-gradient(145deg,#190307 0%,#881337 28%,#fb7185 44%,#e11d48 58%,#fecdd3 72%,#4c0519 100%)"},
 {id:"champagne_metal",name:"Champagne Metal",hex:"#a16207",plans:["Business"],tier:"Premium",css:"linear-gradient(125deg,#422006 0%,#a16207 27%,#fef3c7 44%,#d6a84b 59%,#fff7d6 75%,#713f12 100%)"},
 {id:"rose_platinum",name:"Rose Platinum",hex:"#9d6b75",plans:["Business"],tier:"Premium",css:"linear-gradient(130deg,#3f2028 0%,#9d6b75 28%,#fce7f3 44%,#c4b5bd 58%,#f9a8d4 76%,#4c1d2f 100%)"},
 {id:"molten_copper",name:"Molten Copper",hex:"#9a3412",plans:["Business"],tier:"Premium",css:"linear-gradient(135deg,#2a0d05 0%,#7c2d12 28%,#f97316 47%,#fed7aa 59%,#c2410c 76%,#431407 100%)"},
 {id:"titanium_ice",name:"Titanium Ice",hex:"#475569",plans:["Business"],tier:"Premium",css:"linear-gradient(130deg,#0f172a 0%,#64748b 28%,#e2e8f0 44%,#67e8f9 57%,#94a3b8 73%,#1e293b 100%)"},
 {id:"graphite_laser",name:"Graphite Laser",hex:"#27272a",plans:["Business"],tier:"Premium",css:"linear-gradient(120deg,#09090b 0%,#27272a 36%,#52525b 48%,#22d3ee 56%,#8b5cf6 64%,#18181b 100%)"},
 {id:"opal_shift",name:"Opal Shift",hex:"#94a3b8",plans:["Business"],tier:"Premium",css:"linear-gradient(125deg,#e2e8f0 0%,#f8fafc 24%,#a7f3d0 41%,#bfdbfe 56%,#ddd6fe 70%,#fbcfe8 84%,#cbd5e1 100%)"},
 {id:"arctic_hologram",name:"Arctic Hologram",hex:"#0891b2",plans:["Business"],tier:"Premium",css:"linear-gradient(135deg,#0c4a6e 0%,#22d3ee 25%,#a5f3fc 38%,#c4b5fd 54%,#f0abfc 67%,#34d399 82%,#164e63 100%)"},
 {id:"black_neon_flux",name:"Black Neon Flux",hex:"#09090b",plans:["Business"],tier:"Premium",css:"linear-gradient(120deg,#000 0%,#09090b 38%,#06b6d4 49%,#8b5cf6 58%,#22c55e 68%,#09090b 79%,#000 100%)"},
 {id:"scarlet_noir",name:"Scarlet Noir",hex:"#7f1d1d",plans:["Business"],tier:"Premium",css:"linear-gradient(135deg,#09090b 0%,#450a0a 34%,#b91c1c 52%,#fb7185 62%,#f59e0b 73%,#18181b 100%)"},
 {id:"cosmic_pearl",name:"Cosmic Pearl",hex:"#6366f1",plans:["Business"],tier:"Premium",css:"linear-gradient(125deg,#172554 0%,#6366f1 24%,#a78bfa 39%,#f0abfc 53%,#5eead4 68%,#f8fafc 82%,#312e81 100%)"}
];
let selectedWalletTheme="default";
let selectedQrCardTheme="default";
const saveGoogleWalletThemeCall=httpsCallable(functions,"saveGoogleWalletTheme");
function walletThemeAllowed(t){return t.plans.includes(currentCardPlan)&&featureEnabledForPlan("googleWallet")&&featureEnabledForPlan("googleWalletThemes")}
function renderWalletThemes(){
 const sec=$id("googleWalletThemesSection"),grid=$id("walletThemeGrid");if(!sec||!grid)return;
 const allowed=featureEnabledForPlan("googleWallet")&&featureEnabledForPlan("googleWalletThemes")&&currentRole==="owner";sec.hidden=!allowed;if(!allowed)return;
 const available=WALLET_THEMES.filter(walletThemeAllowed);if(!available.some(t=>t.id===selectedWalletTheme))selectedWalletTheme=available[0]?.id||"default";
 const tile=t=>`<button type="button" class="wallet-theme-tile ${t.id===selectedWalletTheme?"selected":""}" data-wallet-theme="${t.id}" aria-pressed="${t.id===selectedWalletTheme}"><span class="wallet-theme-swatch" style="background:${t.css}"></span><strong>${t.name}</strong></button>`;
 const classic=available.filter(t=>t.tier!=="Premium"),premium=available.filter(t=>t.tier==="Premium");
 grid.innerHTML=`<div class="wallet-theme-collection"><div class="wallet-theme-collection-title"><span>Classic Themes</span><small>${classic.length}</small></div><div class="wallet-theme-collection-grid">${classic.map(tile).join("")}</div></div>${premium.length?`<div class="wallet-theme-collection premium"><div class="wallet-theme-collection-title"><span>Premium Themes</span><small>${premium.length}</small></div><div class="wallet-theme-collection-grid">${premium.map(tile).join("")}</div></div>`:""}`;updateWalletThemePreview();
}
function updateWalletThemePreview(){const t=WALLET_THEMES.find(x=>x.id===selectedWalletTheme)||WALLET_THEMES[0],card=$id("walletThemePreview");if(!card)return;card.style.background=t.css;$id("walletPreviewCompany").textContent=currentProfile.company||"JMX DIGITAL CARD";$id("walletPreviewName").textContent=currentProfile.fullName||"Card Owner";$id("walletPreviewPosition").textContent=currentProfile.position||"Digital Business Card";$id("walletThemeSelectedName").textContent=t.name;document.querySelectorAll("[data-wallet-theme]").forEach(b=>{const on=b.dataset.walletTheme===selectedWalletTheme;b.classList.toggle("selected",on);b.setAttribute("aria-pressed",String(on))})}
async function saveWalletTheme(){const status=$id("walletThemeStatus"),btn=$id("saveWalletTheme");if(btn)btn.disabled=true;if(status)status.textContent="Saving theme…";try{const r=(await saveGoogleWalletThemeCall({cardId:CARD_ID,themeId:selectedWalletTheme})).data;if(status){status.textContent=`${r?.themeName||"Theme"} saved. Your existing Wallet pass will be updated when you use Add to Google Wallet.`;status.className="save-status ok";}}catch(e){console.error(e);if(status){status.textContent=e?.message||"Could not save Wallet theme.";status.className="save-status error";}}finally{if(btn)btn.disabled=false}}


function renderQrCardThemes(){
 const box=$id("qrCardThemesControl"),grid=$id("qrCardThemeGrid"); if(!box||!grid)return;
 const allowed=featureEnabledForPlan("qrCardThemes")&&currentRole==="owner"; box.hidden=!allowed; if(!allowed)return;
 if(!WALLET_THEMES.some(t=>t.id===selectedQrCardTheme))selectedQrCardTheme="default";
 const tile=t=>`<button type="button" class="wallet-theme-tile ${t.id===selectedQrCardTheme?"selected":""}" data-qr-card-theme="${t.id}" aria-pressed="${t.id===selectedQrCardTheme}"><span class="wallet-theme-swatch" style="background:${t.css}"></span><strong>${t.name}</strong></button>`;
 const classic=WALLET_THEMES.filter(t=>t.tier!=="Premium"),premium=WALLET_THEMES.filter(t=>t.tier==="Premium");
 grid.innerHTML=`<div class="wallet-theme-collection"><div class="wallet-theme-collection-title"><span>Classic Themes</span><small>${classic.length}</small></div><div class="wallet-theme-collection-grid">${classic.map(tile).join("")}</div></div><div class="wallet-theme-collection premium"><div class="wallet-theme-collection-title"><span>Premium Themes</span><small>${premium.length}</small></div><div class="wallet-theme-collection-grid">${premium.map(tile).join("")}</div></div>`; updateQrCardThemePreview();
}
function updateQrCardThemePreview(){const t=WALLET_THEMES.find(x=>x.id===selectedQrCardTheme)||WALLET_THEMES[0],card=$id("qrCardThemePreview");if(!card)return;card.style.background=t.css;$id("qrCardThemeSelectedName").textContent=t.name;document.querySelectorAll("[data-qr-card-theme]").forEach(b=>{const on=b.dataset.qrCardTheme===selectedQrCardTheme;b.classList.toggle("selected",on);b.setAttribute("aria-pressed",String(on))})}

const createGoogleWalletPassCall=httpsCallable(functions,"createGoogleWalletPass");
async function addToGoogleWallet(){
  const button=$id("addGoogleWallet"),status=$id("googleWalletStatus");if(button)button.disabled=true;if(status){status.textContent="Preparing Google Wallet pass…";status.className="save-status";}
  try{const result=(await createGoogleWalletPassCall({cardId:CARD_ID})).data;if(!result?.saveUrl)throw new Error("No Google Wallet URL was returned.");if(status){status.textContent=result.action==="created"?"Google Wallet pass created. Opening Google Wallet…":"Google Wallet pass updated. Opening Google Wallet…";status.className="save-status ok";}window.open(result.saveUrl,"_blank","noopener,noreferrer");}
  catch(e){console.error("Google Wallet",e);if(status){status.textContent=e?.message||"Google Wallet is unavailable. Check the setup and try again.";status.className="save-status error";}}finally{if(button)button.disabled=false;}
}

const aiScannerStatusCall=httpsCallable(functions,"aiScannerClientStatus");
const scanBusinessCardCall=httpsCallable(functions,"scanBusinessCard");
const saveAiScannerRecordCall=httpsCallable(functions,"saveAiScannerRecord");
let scannerSelectedFile=null,scannerContact=null,scannerDuplicates=[],scannerAllowDuplicateNew=false,scannerEditMode=false;
const SCANNER_FIELDS={firstName:"scanFirstName",lastName:"scanLastName",fullName:"scanFullName",company:"scanCompany",jobTitle:"scanJobTitle",mobilePhone:"scanMobilePhone",officePhone:"scanOfficePhone",additionalPhone:"scanAdditionalPhone",email:"scanEmail",website:"scanWebsite",address:"scanAddress",city:"scanCity",state:"scanState",zipCode:"scanZipCode",whatsapp:"scanWhatsapp",linkedin:"scanLinkedin",facebook:"scanFacebook",instagram:"scanInstagram",notes:"scanNotes",category:"scanCategory",whereMet:"scanWhereMet",dateMet:"scanDateMet"};
function scannerSetProgress(text="",show=true){const box=$id("aiScannerProgress"),t=$id("aiScannerProgressText");if(box)box.hidden=!show;if(t)t.textContent=text;}
function scannerError(message=""){const box=$id("aiScannerError"),actions=$id("aiScannerErrorActions");if(!box)return;box.hidden=!message;box.textContent=message;if(actions)actions.hidden=!message;}
function resetScannerUi(){scannerSelectedFile=null;scannerContact=null;scannerDuplicates=[];scannerAllowDuplicateNew=false;[$id("aiScannerCameraInput"),$id("aiScannerUploadInput")].forEach(i=>{if(i)i.value=""});if($id("aiScannerImageBox"))$id("aiScannerImageBox").hidden=true;if($id("aiScannerPreviewPanel"))$id("aiScannerPreviewPanel").hidden=true;if($id("aiScannerErrorActions"))$id("aiScannerErrorActions").hidden=true;if($id("scannerDuplicatePanel"))$id("scannerDuplicatePanel").hidden=true;scannerSetProgress("",false);scannerError("");if($id("aiScannerSaveStatus"))$id("aiScannerSaveStatus").textContent="";}
function scannerImageBase64(file,maxW=1600,maxH=1100,quality=.82){return new Promise((resolve,reject)=>{if(!file||!/^image\/(jpeg|png|webp)$/i.test(file.type))return reject(new Error("Choose a JPG, PNG, or WebP image."));if(file.size>12*1024*1024)return reject(new Error("Image must be under 12 MB."));const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{if(img.naturalWidth<300||img.naturalHeight<180){URL.revokeObjectURL(url);return reject(new Error("Image resolution is too low. Take a clearer photo."));}const scale=Math.min(1,maxW/img.naturalWidth,maxH/img.naturalHeight),c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);resolve(c.toDataURL("image/jpeg",quality).split(",")[1]);};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("The image appears corrupt or unsupported."));};img.src=url;});}
function scannerPickFile(file){if(!file)return;scannerSelectedFile=file;scannerContact=null;scannerDuplicates=[];scannerAllowDuplicateNew=false;scannerError("");const img=$id("aiScannerImagePreview"),box=$id("aiScannerImageBox");if(img){img.src=URL.createObjectURL(file);img.onload=()=>URL.revokeObjectURL(img.src)}if(box)box.hidden=false;if($id("aiScannerPreviewPanel"))$id("aiScannerPreviewPanel").hidden=true;}
function setScannerEditMode(editing){scannerEditMode=editing;Object.values(SCANNER_FIELDS).forEach(id=>{const el=$id(id);if(!el)return;if(el.tagName==="SELECT")el.disabled=!editing;else el.readOnly=!editing;});const b=$id("aiScannerEditToggle");if(b)b.textContent=editing?"Done Editing":"Edit";}
function fillScannerContact(contact={}){scannerContact={...contact};Object.entries(SCANNER_FIELDS).forEach(([key,id])=>{const el=$id(id);if(el)el.value=contact[key]||((key==="category")?"Networking":"")});if($id("aiScannerPreviewPanel"))$id("aiScannerPreviewPanel").hidden=false;setScannerEditMode(false);}
function collectScannerContact(){const data={};Object.entries(SCANNER_FIELDS).forEach(([key,id])=>data[key]=($id(id)?.value||"").trim());if(!data.fullName)data.fullName=[data.firstName,data.lastName].filter(Boolean).join(" ");return data;}
function renderScannerDuplicates(){const panel=$id("scannerDuplicatePanel"),text=$id("scannerDuplicateText");if(!panel)return;panel.hidden=scannerDuplicates.length===0;if(text&&scannerDuplicates.length){const d=scannerDuplicates[0];text.textContent=`Possible ${d.type}: ${d.name||"Unnamed"}${d.company?` — ${d.company}`:""}${d.email?` — ${d.email}`:""}`;}}
async function runScanner(){if(!scannerSelectedFile)return scannerError("Choose or take a business card photo first.");scannerError("");scannerSetProgress("Uploading image...",true);if($id("aiScannerScanButton"))$id("aiScannerScanButton").disabled=true;try{const imageBase64=await scannerImageBase64(scannerSelectedFile);scannerSetProgress("Scanning business card...",true);const result=(await scanBusinessCardCall({cardId:CARD_ID,imageBase64})).data;scannerSetProgress("Analyzing card...",true);scannerContact=result.contact||{};scannerDuplicates=result.duplicates||[];scannerAllowDuplicateNew=scannerDuplicates.length===0;fillScannerContact(scannerContact);renderScannerDuplicates();scannerSetProgress("Contact ready for review",true);setTimeout(()=>scannerSetProgress("",false),700);await loadAiScannerStatus();await loadScannerHistory();}catch(e){console.error("AI scan failed",e);scannerSetProgress("",false);scannerError(scannerFriendlyError(e));}finally{if($id("aiScannerScanButton"))$id("aiScannerScanButton").disabled=false;}}
function scannerFriendlyError(e){const m=String(e?.message||"");if(m.includes("Kill Switch"))return"AI services are temporarily unavailable.";if(m.toLowerCase().includes("limit"))return"Your monthly AI Card Scanner limit has been reached.";if(m.toLowerCase().includes("permission"))return"AI Card Scanner is not enabled for this account.";return m||"We couldn't fully read this card. Try a clearer image or another photo.";}
async function saveScannerRecord(target,duplicateAction="new",dup=null){const status=$id("aiScannerSaveStatus"),contact=collectScannerContact();if(scannerDuplicates.length&&!scannerAllowDuplicateNew&&duplicateAction==="new"){if(status)status.textContent="Duplicate detected. Choose View, Update Existing, or Save as New Anyway first.";return;}if(status)status.textContent=target==="lead"?"Saving Lead...":"Saving Contact...";try{const payload={cardId:CARD_ID,target,contact,duplicateAction,existingType:dup?.type||"",existingId:dup?.id||""};const r=(await saveAiScannerRecordCall(payload)).data;if(status){status.textContent=target==="lead"?"Lead saved successfully.":"Contact saved successfully.";status.className="save-status success";}if(target==="lead")await loadBusinessLeads();await loadScannerHistory();await loadScannerContacts();scannerAllowDuplicateNew=false;return r;}catch(e){console.error(e);if(status){status.textContent="Unable to save the scanned contact. Please try again.";status.className="save-status error";}}}
async function loadAiScannerStatus(){const sec=$id("aiScannerSection");if(!sec)return;const ownerChoice=currentRole!=="owner"||currentProfile.visibility?.aiScanner!==false;const allowed=currentRole!=="none"&&featureEnabledForPlan("aiScanner")&&ownerChoice;sec.hidden=!allowed;if(!allowed)return;const badge=$id("aiScannerAvailability"),usage=$id("aiScannerUsageText");try{const r=(await aiScannerStatusCall({cardId:CARD_ID})).data;if(r.externalServicesAllowed!==true){sec.hidden=true;scannerError("");return;}const ready=!r.limitReached;if(badge){badge.textContent=ready?"Ready":"Monthly limit reached";badge.className="scanner-badge "+(ready?"ready":"blocked");}if(usage){const lim=r.limit?.mode==="number"?` / ${r.limit.count}`:"";usage.textContent=`${r.scansThisMonth||0}${lim} scans this month • ${Number(r.allTime?.totalScans||0)} all time • ${r.plan}`;}const saveLead=$id("scannerSaveLead");if(saveLead)saveLead.hidden=!featureEnabledForPlan("leads");document.querySelectorAll(".scanner-capture-button input").forEach(i=>i.disabled=!ready);if(!ready)scannerError("Monthly AI Card Scanner limit reached.");else scannerError("");}catch(e){console.warn("Scanner status unavailable",e);if(badge){badge.textContent="Temporarily unavailable";badge.className="scanner-badge blocked";}scannerError("AI Card Scanner service is temporarily unavailable. Please try again later.");}}
async function loadScannerHistory(){const list=$id("aiScannerHistoryList"),empty=$id("aiScannerHistoryEmpty");if(!list||!featureEnabledForPlan("aiScanner"))return;try{const snap=await getDocs(collection(db,"aiScannerHistory",CARD_ID,"items"));const rows=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).slice(0,20);empty.hidden=rows.length>0;list.innerHTML=rows.map(r=>`<article><div><strong>${escapeLead(r.name||"Unnamed")}</strong><small>${escapeLead(r.company||"")}</small></div><span>${escapeLead(String(r.status||"scanned").replaceAll("_"," "))}</span><time>${formatLeadDate(r.createdAt)}</time></article>`).join("");}catch(e){console.warn("Scanner history unavailable",e);}}
async function loadScannerContacts(){const list=$id("aiScannerContactsList"),empty=$id("aiScannerContactsEmpty");if(!list||!featureEnabledForPlan("aiScanner"))return;try{const snap=await getDocs(collection(db,"contacts",CARD_ID,"items"));const rows=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.updatedAt?.seconds||b.createdAt?.seconds||0)-(a.updatedAt?.seconds||a.createdAt?.seconds||0)).slice(0,50);empty.hidden=rows.length>0;list.innerHTML=rows.map(r=>`<article><div><strong>${escapeLead(r.name||r.fullName||"Unnamed")}</strong><small>${escapeLead(r.company||"")}${r.email?` • ${escapeLead(r.email)}`:""}</small></div><span>${escapeLead(r.category||"Contact")}</span><time>${formatLeadDate(r.updatedAt||r.createdAt)}</time></article>`).join("");}catch(e){console.warn("Scanner contacts unavailable",e);}}
function initAiScannerUi(){
  $id("aiScannerCameraInput")?.addEventListener("change",e=>scannerPickFile(e.target.files?.[0]));$id("aiScannerUploadInput")?.addEventListener("change",e=>scannerPickFile(e.target.files?.[0]));$id("aiScannerScanButton")?.addEventListener("click",runScanner);$id("aiScannerRetakeButton")?.addEventListener("click",resetScannerUi);$id("aiScannerCancelButton")?.addEventListener("click",resetScannerUi);$id("scannerPreviewCancel")?.addEventListener("click",resetScannerUi);$id("scannerSaveLead")?.addEventListener("click",()=>saveScannerRecord("lead"));$id("scannerAddContact")?.addEventListener("click",()=>saveScannerRecord("contact"));$id("refreshScannerHistory")?.addEventListener("click",loadScannerHistory);$id("refreshScannerContacts")?.addEventListener("click",loadScannerContacts);$id("aiScannerEditToggle")?.addEventListener("click",()=>setScannerEditMode(!scannerEditMode));$id("scannerTryAgain")?.addEventListener("click",runScanner);$id("scannerUploadAnother")?.addEventListener("click",()=>{$id("aiScannerUploadInput")?.click()});$id("scannerEnterManual")?.addEventListener("click",()=>{scannerError("");fillScannerContact({category:"Networking"});setScannerEditMode(true);});
  $id("scannerViewExisting")?.addEventListener("click",()=>{const d=scannerDuplicates[0],st=$id("aiScannerSaveStatus");if(st&&d)st.textContent=`Existing ${d.type}: ${d.name||"Unnamed"}${d.email?` • ${d.email}`:""}${d.phone?` • ${d.phone}`:""}`;});
  $id("scannerUpdateExisting")?.addEventListener("click",()=>{const d=scannerDuplicates[0];if(d)saveScannerRecord(d.type==="lead"?"lead":"contact","update",d)});
  $id("scannerSaveNewAnyway")?.addEventListener("click",()=>{scannerAllowDuplicateNew=true;const p=$id("scannerDuplicatePanel");if(p)p.hidden=true;const st=$id("aiScannerSaveStatus");if(st)st.textContent="Duplicate warning acknowledged. Choose Save Lead or Add to Contacts.";});
}

function formatLeadDate(ts){try{return ts?.toDate?ts.toDate().toLocaleDateString():"—"}catch{return"—"}}
function daysRemaining(ts){if(!ts?.toMillis)return 0;return Math.max(0,Math.ceil((ts.toMillis()-Date.now())/86400000))}
function escapeLead(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
let currentLeads=[];
async function loadBusinessLeads(){
  const section=$id("businessLeadsSection");if(!section)return;
  const ownerChoice=currentRole!=="owner"||currentProfile.visibility?.leads!==false;
  const show=currentRole!=="none"&&String(currentCardPlan).toLowerCase()==="business"&&featureEnabledForPlan("leads")&&ownerChoice;
  section.hidden=!show;if(!show)return;
  try{
    const snap=await getDocs(collection(db,"leads",CARD_ID,"items"));
    currentLeads=snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>!x.expiresAt?.toMillis||x.expiresAt.toMillis()>Date.now()).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    renderBusinessLeads();
  }catch(e){console.warn("Leads unavailable",e);const st=$id("leadsStatus");if(st)st.textContent="Could not load Leads."}
}
function leadVcf(lead){const escv=v=>String(v||"").replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");return ["BEGIN:VCARD","VERSION:3.0",`FN:${escv(lead.name)}`,lead.company?`ORG:${escv(lead.company)}`:"",lead.phone?`TEL;TYPE=CELL:${escv(lead.phone)}`:"",lead.email?`EMAIL;TYPE=INTERNET:${escv(lead.email)}`:"","END:VCARD"].filter(Boolean).join("\r\n")}
function downloadText(name,text,type){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
function renderBusinessLeads(){
  const list=$id("businessLeadsList"),empty=$id("businessLeadsEmpty");if(!list)return;empty.hidden=currentLeads.length>0;
  const notesOn=featureEnabledForPlan("contactNotes"),meetingOn=featureEnabledForPlan("meetingNotes"),followOn=featureEnabledForPlan("followUp"),vcfOn=featureEnabledForPlan("vcfDownload"),csvOn=featureEnabledForPlan("csvExport");
  const csv=$id("exportLeadsCsv");if(csv)csv.hidden=!csvOn;
  list.innerHTML=currentLeads.map(l=>{const days=daysRemaining(l.expiresAt),remaining=days===0?"Expires today":`${days} day${days===1?"":"s"} remaining`;return `<article class="lead-card" data-lead-id="${escapeLead(l.id)}"><div class="lead-card-head"><div><strong>${escapeLead(l.name||"Unnamed")}</strong><small>${escapeLead(l.company||"")}</small></div><span>${remaining}</span></div><div class="lead-meta"><span>${escapeLead(l.phone||"—")}</span><span>${escapeLead(l.email||"—")}</span><span>Received ${formatLeadDate(l.createdAt)}</span></div><label>Status <select data-lead-field="status"><option ${l.status==="New"?"selected":""}>New</option><option ${l.status==="Contacted"?"selected":""}>Contacted</option><option ${l.status==="Follow Up"?"selected":""}>Follow Up</option><option ${l.status==="Qualified"?"selected":""}>Qualified</option><option ${l.status==="Customer"?"selected":""}>Customer</option><option ${l.status==="Archived"?"selected":""}>Archived</option></select></label>${notesOn?`<label>Contact Notes<textarea data-lead-field="notes" rows="2">${escapeLead(l.notes||"")}</textarea></label>`:""}${meetingOn?`<label>Meeting Notes<textarea data-lead-field="meetingNotes" rows="2">${escapeLead(l.meetingNotes||"")}</textarea></label>`:""}${followOn?`<label>Follow-Up Date<input data-lead-field="followUpDate" type="date" value="${escapeLead(l.followUpDate||"")}"></label>`:""}<div class="lead-actions"><button type="button" class="mini-button" data-lead-action="save">Save</button>${vcfOn?'<button type="button" class="mini-button" data-lead-action="vcf">Save Contact</button>':""}<button type="button" class="mini-button danger" data-lead-action="delete">Delete</button></div></article>`}).join("");
}
async function handleLeadAction(event){const btn=event.target.closest("[data-lead-action]");if(!btn)return;const card=btn.closest("[data-lead-id]"),id=card?.dataset.leadId,lead=currentLeads.find(x=>x.id===id);if(!lead)return;const action=btn.dataset.leadAction;if(action==="vcf")return downloadText((lead.name||"contact").replace(/[^a-z0-9]+/gi,"-")+".vcf",leadVcf(lead),"text/vcard;charset=utf-8");if(action==="delete"){if(!confirm(`Delete lead ${lead.name||id}?`))return;await deleteDoc(doc(db,"leads",CARD_ID,"items",id));return loadBusinessLeads()}if(action==="save"){const payload={status:card.querySelector('[data-lead-field="status"]').value,updatedAt:serverTimestamp()};const notes=card.querySelector('[data-lead-field="notes"]'),meeting=card.querySelector('[data-lead-field="meetingNotes"]'),follow=card.querySelector('[data-lead-field="followUpDate"]');if(notes)payload.notes=notes.value.trim();if(meeting)payload.meetingNotes=meeting.value.trim();if(follow)payload.followUpDate=follow.value||null;await setDoc(doc(db,"leads",CARD_ID,"items",id),payload,{merge:true});const st=$id("leadsStatus");if(st)st.textContent="Lead updated.";return loadBusinessLeads()}}
function exportLeadsCsv(){const rows=[["Name","Phone","Email","Company","Message","Date Received","Expiration Date","Days Remaining","Status","Notes","Meeting Notes","Follow-Up Date"],...currentLeads.map(l=>[l.name,l.phone,l.email,l.company,l.message,formatLeadDate(l.createdAt),formatLeadDate(l.expiresAt),daysRemaining(l.expiresAt),l.status,l.notes,l.meetingNotes,l.followUpDate])];const csv=rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");downloadText(`JMX-${CARD_ID}-Leads.csv`,csv,"text/csv;charset=utf-8")}

document.addEventListener("DOMContentLoaded",()=>{
  buildVisibility();configureEditorEvents();initAiScannerUi();setCardIdentity();
  $id("adminGoogleLogin")?.addEventListener("click",signInWithGoogle);
  $id("adminLogin")?.addEventListener("click",signIn);
  $id("adminPassword")?.addEventListener("keydown",e=>{if(e.key==="Enter")signIn()});
  $id("adminLogout")?.addEventListener("click",()=>signOut(auth));
  $id("businessLeadsList")?.addEventListener("click",handleLeadAction);
  $id("exportLeadsCsv")?.addEventListener("click",exportLeadsCsv);
  $id("addGoogleWallet")?.addEventListener("click",addToGoogleWallet);
  $id("qrCardThemesToggle")?.addEventListener("click",()=>{const panel=$id("qrCardThemesPanel");if(panel){panel.hidden=!panel.hidden;$id("qrCardThemesToggle").setAttribute("aria-expanded",String(!panel.hidden))}});
  $id("qrCardThemeGrid")?.addEventListener("click",e=>{const b=e.target.closest("[data-qr-card-theme]");if(!b)return;selectedQrCardTheme=b.dataset.qrCardTheme;updateQrCardThemePreview();setStatus("QR Card Theme selected. Press Save Changes to publish it.")});
  $id("walletThemeGrid")?.addEventListener("click",e=>{const b=e.target.closest("[data-wallet-theme]");if(!b)return;selectedWalletTheme=b.dataset.walletTheme;updateWalletThemePreview()});
  $id("saveWalletTheme")?.addEventListener("click",saveWalletTheme);
  onAuthStateChanged(auth,async user=>{
    currentUser=user||null;document.body.classList.toggle("admin-authenticated",Boolean(user));
    if(!user){currentRole="none";setAuthStatus("Sign in to edit your JMX Digital Card.");$id("adminUserEmail").textContent="";return;}
    try{
      const [cfg,ownerSnap,cardSnap]=await Promise.all([getDoc(platformRef),getDoc(ownerRef),getDoc(cardRef)]);
      let adminUser=cfg.exists()&&cfg.data().adminUid===user.uid;
      if(!cfg.exists()&&cardSnap.exists()&&cardSnap.data().ownerUid===user.uid){await setDoc(platformRef,{adminUid:user.uid,adminEmail:user.email||"",createdAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});adminUser=true;}
      const ownerUser=ownerSnap.exists()&&ownerSnap.data().ownerUid===user.uid;
      if(!adminUser&&!ownerUser){
        await signOut(auth);
        return setAuthStatus(CARD_ID==="main"?"This Google account is not authorized as the JMX administrator.":"This account is not authorized to edit this card.","error");
      }
      currentRole=adminUser?"admin":"owner";currentCardOwnerUid=ownerSnap.exists()?ownerSnap.data().ownerUid:null;
      document.body.classList.toggle("client-owner-mode",currentRole==="owner");
      setAuthStatus(`Signed in as ${user.email||currentRole}. ${currentRole==="admin"?"JMX administrator":"Card owner"}.`,"ok");$id("adminUserEmail").textContent=user.email||currentRole;
      await loadAfterAuth();applyPlanLocks();await loadPremiumOwnerStats();await loadBusinessLeads();await loadAiScannerStatus();await loadScannerHistory();await loadScannerContacts();
    }catch(e){console.error(e);setAuthStatus(firebaseMessage(e),"error");}
  });
});
