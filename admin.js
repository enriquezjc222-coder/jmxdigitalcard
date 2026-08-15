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
const mediaCol = collection(db, "cards", CARD_ID, "media");

const VISIBILITY_LABELS = {
  description:"Description", saveContact:"Save Contact button", quickActions:"Quick action buttons",
  phone:"Phone 1", phone2:"Phone 2", whatsapp:"WhatsApp", email:"Email", website:"Website",
  location:"Location", facebook:"Facebook", instagram:"Instagram", linkedin:"LinkedIn",
  twitter:"X / Twitter", tiktok:"TikTok", youtube:"YouTube", businessLinks:"Business Links",
  catalog:"Catalog", customBusiness:"Extra business link", services:"Services", gallery:"Gallery",
  video:"Video", qr:"QR code", finalCTA:"Final contact button", logo:"Business logo"
};

const defaults = {
  fullName:"John Smith", position:"Owner / Founder", company:"Premium Business LLC",
  city:"Chicago", state:"Illinois",
  description:"Professional services with quality, reliability and attention to detail.",
  phone:"(708) 555-1234", phoneRaw:"+17085551234", phone2:"", phone2Raw:"",
  whatsapp:"", whatsappRaw:"", email:"hello@example.com", website:"https://example.com",
  facebook:"", instagram:"", linkedin:"", twitter:"", tiktok:"", youtube:"",
  catalog:"", catalogFileName:"", customBusinessLabel:"More Information",
  customBusinessSubtitle:"Open business link", customBusinessUrl:"",
  profileImage:"", coverImage:"", logoImage:"", galleryImages:[], videoUrl:"",
  service1Title:"Service One", service1Description:"Add a short description of your service here.", service1Icon:"fa-house",
  service2Title:"Service Two", service2Description:"Add another service description here.", service2Icon:"fa-screwdriver-wrench",
  service3Title:"Service Three", service3Description:"Customize this section for any type of business.", service3Icon:"fa-paint-roller",
  finalCtaTitle:"Let's Connect", finalCtaText:"Have a question or want to work together? Contact us today.",
  finalCtaLabel:"Contact Now", theme:"gold",
  visibility:Object.fromEntries(Object.keys(VISIBILITY_LABELS).map(k=>[k,true]))
};

let currentProfile = structuredCloneSafe(defaults);
let currentUser = null;
let pendingMedia = new Map();
let pendingDeletes = new Set();

function sanitizeCardId(value){
  return String(value || "main").toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64) || "main";
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

function getLegacyProfile(){
  try{
    const raw=localStorage.getItem(LEGACY_STORAGE_KEY);
    if(!raw)return null;
    const p=JSON.parse(raw);
    return {...structuredCloneSafe(defaults),...p,visibility:{...defaults.visibility,...(p.visibility||{})},galleryImages:Array.isArray(p.galleryImages)?p.galleryImages:[]};
  }catch{return null;}
}

async function loadRemoteProfile(){
  const snap=await getDoc(cardRef);
  if(!snap.exists()) return null;
  const data=snap.data();
  const p={...structuredCloneSafe(defaults),...data,visibility:{...defaults.visibility,...(data.visibility||{})},galleryImages:[]};
  delete p.ownerUid; delete p.updatedAt;
  const mediaSnap=await getDocs(mediaCol);
  const gallery=[];
  mediaSnap.forEach(d=>{
    const m=d.data(); const dataUrl=m.data||"";
    if(d.id==="logo")p.logoImage=dataUrl;
    else if(d.id==="profile")p.profileImage=dataUrl;
    else if(d.id==="cover")p.coverImage=dataUrl;
    else if(d.id==="catalog"){p.catalogFile=dataUrl;p.catalogFileName=m.name||p.catalogFileName||"";}
    else if(d.id.startsWith("gallery-")){ const i=Number(d.id.split("-")[1]); if(Number.isInteger(i))gallery[i]=dataUrl; }
  });
  p.galleryImages=gallery.filter(Boolean);
  return p;
}

function profileForFirestore(p){
  const clean={...p};
  delete clean.profileImage; delete clean.coverImage; delete clean.logoImage; delete clean.galleryImages; delete clean.catalogFile;
  clean.ownerUid=currentUser.uid;
  clean.updatedAt=serverTimestamp();
  return clean;
}

async function ensureCardDocument(){
  const snap=await getDoc(cardRef);
  if(snap.exists()) return;
  const p=collectFormProfile();
  await setDoc(cardRef,profileForFirestore(p),{merge:true});
}

async function saveMediaDoc(id,data,name=""){
  if(!data){ await deleteDoc(doc(db,"cards",CARD_ID,"media",id)).catch(()=>{}); return; }
  await setDoc(doc(db,"cards",CARD_ID,"media",id),{data,name,updatedAt:serverTimestamp()},{merge:true});
}

function setInputData(profile){
  const ids=["fullName","position","company","city","state","description","phone","phone2","whatsapp","email","website","facebook","instagram","linkedin","twitter","tiktok","youtube","catalog","customBusinessLabel","customBusinessSubtitle","customBusinessUrl","videoUrl","service1Title","service1Description","service1Icon","service2Title","service2Description","service2Icon","service3Title","service3Description","service3Icon","finalCtaTitle","finalCtaText","finalCtaLabel"];
  ids.forEach(id=>setVal(id,profile[id]));
  updatePreview("logoPreview","logoPlaceholder",profile.logoImage);
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

async function saveProfile(){
  if(!currentUser)return setStatus("Sign in first.","error");
  const p=collectFormProfile(); if(!p.fullName)return setStatus("Please enter a name.","error");
  setBusy(true); setStatus("Publishing changes online...","working");
  try{
    await setDoc(cardRef,profileForFirestore(p),{merge:true});
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
    await setDoc(cardRef,profileForFirestore(currentProfile));
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
  stageImage("logoUpload","logoImage","logoPreview","logoPlaceholder",900,600,"logo");
  stageImage("profileUpload","profileImage","profilePreview","profilePlaceholder",700,700,"profile");
  stageImage("coverUpload","coverImage","coverPreview","coverPlaceholder",1600,900,"cover");
  $id("galleryUpload")?.addEventListener("change",e=>handleGallery(e.target.files));
  $id("clearGallery")?.addEventListener("click",()=>{currentProfile.galleryImages=[];renderGalleryPreview([]);for(let i=0;i<6;i++){pendingDeletes.add(`gallery-${i}`);pendingMedia.delete(`gallery-${i}`)}setStatus("Gallery will be removed when you press Save Changes.")});
  $id("catalogUpload")?.addEventListener("change",e=>handleCatalog(e.target.files?.[0]));
  document.querySelectorAll("[data-clear-image]").forEach(b=>b.addEventListener("click",()=>{const field=b.dataset.clearImage;const map={logoImage:["logoPreview","logoPlaceholder","logo"],profileImage:["profilePreview","profilePlaceholder","profile"],coverImage:["coverPreview","coverPlaceholder","cover"]};const m=map[field];if(!m)return;currentProfile[field]="";pendingDeletes.add(m[2]);pendingMedia.delete(m[2]);updatePreview(m[0],m[1],"");setStatus("Image will be removed when you press Save Changes.")}));
  document.querySelectorAll(".admin-theme").forEach(b=>b.addEventListener("click",()=>setThemeActive(b.dataset.theme)));
  $id("saveProfile")?.addEventListener("click",saveProfile);$id("resetProfile")?.addEventListener("click",resetAll);
  const view=$id("viewCardButton");if(view)view.href=`index.html${CARD_ID==="main"?"":`?card=${encodeURIComponent(CARD_ID)}`}`;
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
    currentProfile=remote;setInputData(currentProfile);
  }catch(e){console.error(e);currentProfile=getLegacyProfile()||structuredCloneSafe(defaults);setInputData(currentProfile);setStatus(firebaseMessage(e),"error");}
  finally{setBusy(false);}
}

document.addEventListener("DOMContentLoaded",()=>{
  buildVisibility();configureEditorEvents();
  $id("adminLogin")?.addEventListener("click",signIn);
  $id("adminPassword")?.addEventListener("keydown",e=>{if(e.key==="Enter")signIn()});
  $id("adminLogout")?.addEventListener("click",()=>signOut(auth));
  onAuthStateChanged(auth,async user=>{
    currentUser=user||null;document.body.classList.toggle("admin-authenticated",Boolean(user));
    if(user){setAuthStatus(`Signed in as ${user.email||"admin"}.`,`ok`);$id("adminUserEmail").textContent=user.email||"Admin";await loadAfterAuth();}
    else{setAuthStatus("Sign in with the Firebase admin account to edit and publish this card.");$id("adminUserEmail").textContent="";}
  });
});
