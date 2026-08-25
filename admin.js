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
  finalCtaLabel:"Contact Now", theme:"gold", qrDarkColor:"#111111", qrLightColor:"#ffffff", removeJmxBranding:false,
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
const BUSINESS_ONLY_FEATURES=new Set(["customQR","qrDownload","advancedAnalytics","quickCapture","leads","contactNotes","meetingNotes","followUp","csvExport","vcfDownload","contactMap","aiScanner","autoIntroEmail","appleWallet","googleWallet","brandingRemoval","advancedNetworkingInsights"]);
const FEATURE_KEYS=[...new Set([...Object.keys(VISIBILITY_LABELS),"customQR","qrDownload","analytics","advancedAnalytics","quickCapture","leads","contactNotes","meetingNotes","followUp","csvExport","vcfDownload","contactMap","aiScanner","autoIntroEmail","appleWallet","googleWallet","brandingRemoval","advancedNetworkingInsights"])];
function defaultFeatureControls(){const global={},Basic={},Premium={},Business={};FEATURE_KEYS.forEach(k=>{global[k]=true;Basic[k]=BASIC_FEATURE_DEFAULTS.has(k);Premium[k]=!BUSINESS_ONLY_FEATURES.has(k);Business[k]=true});return{enabled:true,global,Basic,Premium,Business}}
function mergeFeatureControls(raw={}){const d=defaultFeatureControls();return{enabled:raw.enabled!==false,global:{...d.global,...(raw.global||{})},Basic:{...d.Basic,...(raw.Basic||{})},Premium:{...d.Premium,...(raw.Premium||{})},Business:{...d.Business,...(raw.Business||{})}}}
let platformFeatureControls=defaultFeatureControls();
function featureEnabledForPlan(feature){
  if(platformFeatureControls.enabled===false){const base=["premium","business"].includes(currentCardPlan.toLowerCase())||BASIC_FEATURE_DEFAULTS.has(feature);return base&&currentCardFeatureOverrides?.[feature]!==false}
  if(platformFeatureControls.global?.[feature]===false)return false;
  const group=currentCardPlan.toLowerCase()==="basic"?platformFeatureControls.Basic:currentCardPlan.toLowerCase()==="business"?platformFeatureControls.Business:platformFeatureControls.Premium;
  return group?.[feature]!==false && currentCardFeatureOverrides?.[feature]!==false;
}
const FEATURE_INPUT_IDS={description:["description"],phone:["phone"],phone2:["phone2"],whatsapp:["whatsapp"],email:["email"],website:["website"],facebook:["facebook"],instagram:["instagram"],linkedin:["linkedin"],twitter:["twitter"],tiktok:["tiktok"],youtube:["youtube"],catalog:["catalog","catalogUpload"],customBusiness:["customBusinessLabel","customBusinessSubtitle","customBusinessUrl"],video:["videoUrl"],services:["service1Title","service1Description","service1Icon","service2Title","service2Description","service2Icon","service3Title","service3Description","service3Icon"],gallery:["galleryUpload","clearGallery"],finalCTA:["finalCtaTitle","finalCtaText","finalCtaLabel"]};


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
  p.visibility=readVisibility(); p.theme=document.querySelector(".admin-theme.active")?.dataset.theme||currentProfile.theme||"gold"; p.qrDarkColor=getVal("qrDarkColor")||"#111111"; p.qrLightColor=getVal("qrLightColor")||"#ffffff"; p.removeJmxBranding=$id("removeJmxBranding")?.checked===true;
  return p;
}

async function loadAdminMeta(){
  try{
    const [cardSnap,ownerSnap]=await Promise.all([getDoc(cardRef),getDoc(ownerRef)]);
    const c=cardSnap.exists()?cardSnap.data():{},o=ownerSnap.exists()?ownerSnap.data():{};
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
    currentProfile=remote;setInputData(currentProfile);await loadAdminMeta();
    try{const settingsSnap=await getDoc(publicSettingsRef);platformFeatureControls=mergeFeatureControls(settingsSnap.exists()?(settingsSnap.data().featureControls||{}):{});}catch(e){console.warn("Feature controls unavailable",e);platformFeatureControls=defaultFeatureControls();}
  }catch(e){console.error(e);currentProfile=getLegacyProfile()||structuredCloneSafe(defaults);setInputData(currentProfile);setStatus(firebaseMessage(e),"error");}
  finally{setBusy(false);}
}


function prettyAction(name){return ({whatsapp:"WhatsApp",phone:"Phone",email:"Email",website:"Website",facebook:"Facebook",instagram:"Instagram",linkedin:"LinkedIn",twitter:"X / Twitter",tiktok:"TikTok",youtube:"YouTube",catalog:"Catalog",saveContact:"Save Contact",share:"Share",text:"Text Message",customLink:"Business Link",cta:"Contact Button",quickCapture:"Quick Capture",leadReceived:"Leads Received",qrVisit:"QR Visits",qrDownload:"QR Download"})[name]||name||"—"}
function sumOwnerActions(actions={}){return Object.values(actions||{}).reduce((sum,value)=>sum+Number(value||0),0)}
async function loadPremiumOwnerStats(){
  const section=$id("premiumStatsSection");if(!section)return;
  const show=currentRole==="owner"&&["premium","business"].includes(String(currentCardPlan).toLowerCase())&&featureEnabledForPlan("analytics");section.hidden=!show; const net=$id("businessNetworkingSection"); if(net){const networkingAllowed=String(currentCardPlan).toLowerCase()==="business"&&(featureEnabledForPlan("customQR")||featureEnabledForPlan("brandingRemoval"));net.hidden=!networkingAllowed;} if(!show)return;
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
  if(feature==="leads"||feature==="quickCapture"){const sec=$id("businessLeadsSection");if(sec&&!nodes.includes(sec))nodes.push(sec)}
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
  const net=$id("businessNetworkingSection");if(net&&currentRole==="owner"){const visible=[...net.querySelectorAll(".form-group")].some(x=>!x.hidden);net.hidden=!visible}
}
function applyPlanLocks(){
  const owner=currentRole==="owner";
  document.querySelectorAll("[data-admin-feature-hidden]").forEach(el=>{el.hidden=false;delete el.dataset.adminFeatureHidden});
  document.querySelectorAll("input,textarea,select,button").forEach(el=>{if(PREMIUM_ONLY_IDS.has(el.id))el.disabled=false});
  document.querySelectorAll("[data-vis]").forEach(el=>{el.disabled=false;(el.closest(".toggle-item")||el).hidden=false});
  if(owner){
    FEATURE_KEYS.forEach(feature=>setOwnerFeatureVisibility(feature,featureEnabledForPlan(feature)));
    Object.entries(FEATURE_INPUT_IDS).forEach(([feature,ids])=>ids.forEach(id=>{const el=$id(id);if(el)el.disabled=!featureEnabledForPlan(feature)}));
    collapseEmptyEditorSections();
  }
  let note=$id("planAccessNote");if(!note){note=document.createElement("div");note.id="planAccessNote";note.className="admin-note";document.querySelector(".card-management-section")?.after(note)}
  const disabled=FEATURE_KEYS.filter(k=>!featureEnabledForPlan(k)).map(k=>VISIBILITY_LABELS[k]||({customQR:"Custom QR",qrDownload:"QR Download",analytics:"Analytics",advancedAnalytics:"Advanced Analytics",quickCapture:"Quick Capture",leads:"Leads",contactNotes:"Contact Notes",meetingNotes:"Meeting Notes",followUp:"Follow-Up",csvExport:"CSV Export",vcfDownload:"VCF Download",contactMap:"Contact Map",aiScanner:"AI Scanner",autoIntroEmail:"Auto-Intro Email",appleWallet:"Apple Wallet",googleWallet:"Google Wallet",brandingRemoval:"Branding Removal",advancedNetworkingInsights:"Advanced Networking Insights"}[k])).filter(Boolean);
  note.innerHTML=`<strong>Plan:</strong> ${currentCardPlan}. ${owner?(disabled.length?`Features disabled by JMX administration are hidden from this editor and from the public card.`:`All available ${currentCardPlan} modules are enabled by JMX administration.`):"Administrator view: all profile fields remain editable; public visibility follows the Feature Control Center."}`;
}



function formatLeadDate(ts){try{return ts?.toDate?ts.toDate().toLocaleDateString():"—"}catch{return"—"}}
function daysRemaining(ts){if(!ts?.toMillis)return 0;return Math.max(0,Math.ceil((ts.toMillis()-Date.now())/86400000))}
function escapeLead(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
let currentLeads=[];
async function loadBusinessLeads(){
  const section=$id("businessLeadsSection");if(!section)return;
  const show=currentRole!=="none"&&String(currentCardPlan).toLowerCase()==="business"&&featureEnabledForPlan("leads")&&featureEnabledForPlan("quickCapture");
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
  list.innerHTML=currentLeads.map(l=>{const days=daysRemaining(l.expiresAt),remaining=days===0?"Expires today":`${days} day${days===1?"":"s"} remaining`;return `<article class="lead-card" data-lead-id="${escapeLead(l.id)}"><div class="lead-card-head"><div><strong>${escapeLead(l.name||"Unnamed")}</strong><small>${escapeLead(l.company||"")}</small></div><span>${remaining}</span></div><div class="lead-meta"><span>${escapeLead(l.phone||"—")}</span><span>${escapeLead(l.email||"—")}</span><span>Received ${formatLeadDate(l.createdAt)}</span></div><label>Status <select data-lead-field="status"><option ${l.status==="New"?"selected":""}>New</option><option ${l.status==="Contacted"?"selected":""}>Contacted</option><option ${l.status==="Follow Up"?"selected":""}>Follow Up</option><option ${l.status==="Qualified"?"selected":""}>Qualified</option><option ${l.status==="Customer"?"selected":""}>Customer</option><option ${l.status==="Archived"?"selected":""}>Archived</option></select></label><label>Contact Notes<textarea data-lead-field="notes" rows="2">${escapeLead(l.notes||"")}</textarea></label><label>Meeting Notes<textarea data-lead-field="meetingNotes" rows="2">${escapeLead(l.meetingNotes||"")}</textarea></label><label>Follow-Up Date<input data-lead-field="followUpDate" type="date" value="${escapeLead(l.followUpDate||"")}"></label><div class="lead-actions"><button type="button" class="mini-button" data-lead-action="save">Save</button><button type="button" class="mini-button" data-lead-action="vcf">Save Contact</button><button type="button" class="mini-button danger" data-lead-action="delete">Delete</button></div></article>`}).join("");
}
async function handleLeadAction(event){const btn=event.target.closest("[data-lead-action]");if(!btn)return;const card=btn.closest("[data-lead-id]"),id=card?.dataset.leadId,lead=currentLeads.find(x=>x.id===id);if(!lead)return;const action=btn.dataset.leadAction;if(action==="vcf")return downloadText((lead.name||"contact").replace(/[^a-z0-9]+/gi,"-")+".vcf",leadVcf(lead),"text/vcard;charset=utf-8");if(action==="delete"){if(!confirm(`Delete lead ${lead.name||id}?`))return;await deleteDoc(doc(db,"leads",CARD_ID,"items",id));return loadBusinessLeads()}if(action==="save"){const payload={status:card.querySelector('[data-lead-field="status"]').value,notes:card.querySelector('[data-lead-field="notes"]').value.trim(),meetingNotes:card.querySelector('[data-lead-field="meetingNotes"]').value.trim(),followUpDate:card.querySelector('[data-lead-field="followUpDate"]').value||null,updatedAt:serverTimestamp()};await setDoc(doc(db,"leads",CARD_ID,"items",id),payload,{merge:true});const st=$id("leadsStatus");if(st)st.textContent="Lead updated.";return loadBusinessLeads()}}
function exportLeadsCsv(){const rows=[["Name","Phone","Email","Company","Message","Date Received","Expiration Date","Days Remaining","Status","Notes","Meeting Notes","Follow-Up Date"],...currentLeads.map(l=>[l.name,l.phone,l.email,l.company,l.message,formatLeadDate(l.createdAt),formatLeadDate(l.expiresAt),daysRemaining(l.expiresAt),l.status,l.notes,l.meetingNotes,l.followUpDate])];const csv=rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");downloadText(`JMX-${CARD_ID}-Leads.csv`,csv,"text/csv;charset=utf-8")}

document.addEventListener("DOMContentLoaded",()=>{
  buildVisibility();configureEditorEvents();setCardIdentity();
  $id("adminGoogleLogin")?.addEventListener("click",signInWithGoogle);
  $id("adminLogin")?.addEventListener("click",signIn);
  $id("adminPassword")?.addEventListener("keydown",e=>{if(e.key==="Enter")signIn()});
  $id("adminLogout")?.addEventListener("click",()=>signOut(auth));
  $id("businessLeadsList")?.addEventListener("click",handleLeadAction);
  $id("exportLeadsCsv")?.addEventListener("click",exportLeadsCsv);
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
      await loadAfterAuth();applyPlanLocks();await loadPremiumOwnerStats();await loadBusinessLeads();
    }catch(e){console.error(e);setAuthStatus(firebaseMessage(e),"error");}
  });
});
