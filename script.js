import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getFirestore, doc, getDoc, getDocs, collection, setDoc, addDoc, increment, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

const firebaseConfig={apiKey:"AIzaSyDf12K0m93K4cWSotDcSg2fIS-s3uaLW_Y",authDomain:"jmx-digital-card.firebaseapp.com",projectId:"jmx-digital-card",storageBucket:"jmx-digital-card.firebasestorage.app",messagingSenderId:"411133047344",appId:"1:411133047344:web:07c250e162cde4d63cb3f5"};
const app=initializeApp(firebaseConfig),db=getFirestore(app);
const LEGACY_STORAGE_KEY="premiumDigitalCardProfile",THEME_KEY="digitalCardTheme";
const params=new URLSearchParams(location.search);
const pathMatch=location.pathname.match(/^\/c\/([A-Za-z0-9_-]+)\/?$/);
const CARD_ID=sanitizeCardId(pathMatch?.[1]||params.get("card")||"main");
if(params.get("pretty")==="1"&&CARD_ID!=="main"&&!(["localhost","127.0.0.1"].includes(location.hostname)||location.hostname.endsWith("github.io"))) history.replaceState({},"",`/c/${CARD_ID}`);
const fallback={fullName:"",position:"",company:"",city:"",state:"",description:"",phone:"",phoneRaw:"",phone2:"",phone2Raw:"",whatsapp:"",whatsappRaw:"",email:"",website:"",facebook:"",instagram:"",linkedin:"",twitter:"",tiktok:"",youtube:"",catalog:"",catalogFile:"",customBusinessLabel:"",customBusinessSubtitle:"",customBusinessUrl:"",profileImage:"",coverImage:"",logoImage:"",galleryImages:[],videoUrl:"",service1Title:"",service1Description:"",service1Icon:"fa-house",service2Title:"",service2Description:"",service2Icon:"fa-screwdriver-wrench",service3Title:"",service3Description:"",service3Icon:"fa-paint-roller",finalCtaTitle:"Let's Connect",finalCtaText:"",finalCtaLabel:"Contact Now",theme:"gold",qrCardTheme:"default",qrDarkColor:"#111111",qrLightColor:"#ffffff",removeJmxBranding:false,status:"active",visibility:{}}
let p={...fallback};
const FEATURE_KEYS=["description","saveContact","quickActions","phone","phone2","whatsapp","email","website","location","facebook","instagram","linkedin","twitter","tiktok","youtube","services","gallery","video","qr","customQR","qrDownload","finalCTA","businessLinks","catalog","customBusiness","analytics","advancedAnalytics","quickCapture","leads","contactNotes","meetingNotes","followUp","csvExport","vcfDownload","contactMap","aiScanner","autoIntroEmail","appleWallet","googleWallet","qrCardThemes","brandingRemoval","advancedNetworkingInsights"];
const BASIC_FEATURE_DEFAULTS=new Set(["description","saveContact","quickActions","phone","whatsapp","email","location","facebook","qr"]);
function defaultFeatureControls(){const global={},Basic={},Premium={},Business={};const businessOnly=new Set(["customQR","qrDownload","advancedAnalytics","quickCapture","leads","contactNotes","meetingNotes","followUp","csvExport","vcfDownload","contactMap","aiScanner","autoIntroEmail","appleWallet","googleWallet","qrCardThemes","brandingRemoval","advancedNetworkingInsights"]);FEATURE_KEYS.forEach(k=>{global[k]=true;Basic[k]=BASIC_FEATURE_DEFAULTS.has(k);Premium[k]=!businessOnly.has(k);Business[k]=true});return{enabled:true,global,Basic,Premium,Business}}
let platformFeatureControls=defaultFeatureControls();
function mergeFeatureControls(raw={}){const d=defaultFeatureControls();return{enabled:raw.enabled!==false,global:{...d.global,...(raw.global||{})},Basic:{...d.Basic,...(raw.Basic||{})},Premium:{...d.Premium,...(raw.Premium||{})},Business:{...d.Business,...(raw.Business||{})}}}

function sanitizeCardId(v){const raw=String(v||"main").trim();if(raw.toLowerCase()==="main")return "main";return raw.toUpperCase().replace(/[^A-Z0-9_-]/g,"-").slice(0,64)||"main"}
function $id(id){return document.getElementById(id)} function text(id,v){const e=$id(id);if(e)e.textContent=v||""} function link(id,v){const e=$id(id);if(e)e.href=v||"#"} function visible(id,on){const e=$id(id);if(e)e.style.display=on?"":"none"} function has(v){return Boolean(v&&v!=="#")}
function cleanPhone(v){return(v||"").replace(/\D/g,"")} function displayWeb(v){return(v||"").replace(/^https?:\/\//i,"").replace(/\/$/,"")}
function getLegacy(){try{const x=JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY)||"{}");return {...fallback,...x,visibility:{...(fallback.visibility||{}),...(x.visibility||{})}}}catch{return {...fallback}}}
async function getOnlineProfile(){
  const [cardSnap,settingsSnap]=await Promise.all([getDoc(doc(db,"cards",CARD_ID)),getDoc(doc(db,"platform","publicSettings"))]);
  const publicSettings=settingsSnap.exists()?settingsSnap.data():{};
  window.__jmxPublicSettings=publicSettings;
  platformFeatureControls=mergeFeatureControls(publicSettings.featureControls||{});
  if(!cardSnap.exists())return null;
  const meta=cardSnap.data();
  if(["available","sold"].includes(meta.status))return {__activation:true,__meta:meta};
  if(["suspended","paused"].includes(meta.status))return {__suspended:true,__meta:meta};
  const profileSnap=await getDoc(doc(db,"profiles",CARD_ID));
  const data=profileSnap.exists()?profileSnap.data():meta;
  const out={...fallback,...data,status:meta.status||data.status||"activated",plan:meta.plan||"Premium",complimentaryPremium:meta.complimentaryPremium===true,complimentaryBusiness:meta.complimentaryBusiness===true,subscription:meta.subscription||{},featureOverrides:(meta.featureOverrides&&typeof meta.featureOverrides==="object")?meta.featureOverrides:{},visibility:{...(fallback.visibility||{}),...(data.visibility||{})},galleryImages:[]};
  const gallery=[],manifest=(data.media&&typeof data.media==="object")?data.media:{};
  const applyMedia=(id,m={})=>{const u=m.url||m.data||"";if(!u)return;if(id==="logo")out.logoImage=u;else if(id==="profile")out.profileImage=u;else if(id==="cover")out.coverImage=u;else if(id==="catalog")out.catalogFile=u;else if(id.startsWith("gallery-")){const i=Number(id.split("-")[1]);if(Number.isInteger(i))gallery[i]=u}};
  Object.entries(manifest).forEach(([id,m])=>applyMedia(id,m));
  // Legacy fallback is used only for cards that predate the Storage manifest. New cards avoid the extra media collection reads.
  if(Number(data.mediaStorageVersion||0)<2){const ms=await getDocs(collection(db,"cards",CARD_ID,"media"));ms.forEach(d=>{if(!manifest[d.id]?.url)applyMedia(d.id,d.data())})}
  out.galleryImages=gallery.filter(Boolean);out.media=manifest;out.mediaStorageVersion=Number(data.mediaStorageVersion||0);return out
}

// Analytics transition: profile-view counters freeze at midnight in Chicago on 2026-08-26.
// 2026-08-26 00:00 America/Chicago = 2026-08-26T05:00:00Z (CDT).
// Historical cardStats/monthlyStats/dailyStats documents are intentionally preserved.
const ANALYTICS_PROFILE_VIEW_CUTOFF_ISO="2026-08-26T05:00:00Z";
const ANALYTICS_PROFILE_VIEW_CUTOFF_MS=Date.parse(ANALYTICS_PROFILE_VIEW_CUTOFF_ISO);
const PREMIUM_ACTIONS=new Set(["saveContact","phone","text","email","whatsapp","website","facebook","instagram","linkedin","twitter","tiktok","youtube","catalog","customLink","share","cta"]);
const BUSINESS_ADVANCED_ACTIONS=new Set([...PREMIUM_ACTIONS,"quickCapture","leadReceived","qrVisit","qrDownload"]);
function monthKey(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`}
function dayKey(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function analyticsActionAllowed(action){
  const plan=effectivePublicPlan();
  if(plan==="Basic"||!planAllows("analytics"))return false;
  if(plan==="Premium")return PREMIUM_ACTIONS.has(action);
  if(plan==="Business")return (planAllows("advancedAnalytics")?BUSINESS_ADVANCED_ACTIONS:PREMIUM_ACTIONS).has(action);
  return false;
}
async function trackActions(actions=[]){
  if(CARD_ID==="main")return;
  const allowed=[...new Set(actions)].filter(analyticsActionAllowed);
  if(!allowed.length)return;
  const actionIncrements={};allowed.forEach(action=>{actionIncrements[action]=increment(1)});
  try{await setDoc(doc(db,"cardStats",CARD_ID),{cardId:CARD_ID,actions:actionIncrements,updatedAt:serverTimestamp()},{merge:true})}
  catch(e){console.warn("Analytics action skipped",e)}
}
async function trackMetric(action="view"){
  if(CARD_ID==="main")return;
  if(action!=="view")return trackActions([action]);
  // Keep the legacy view counters only until the fixed transition moment. Firestore rules
  // also enforce this cutoff with server time so a changed browser clock cannot continue views.
  if(Date.now()>=ANALYTICS_PROFILE_VIEW_CUTOFF_MS)return;
  const payload={cardId:CARD_ID,views:increment(1),updatedAt:serverTimestamp()};
  try{await Promise.all([
    setDoc(doc(db,"cardStats",CARD_ID),payload,{merge:true}),
    setDoc(doc(db,"monthlyStats",`${CARD_ID}_${monthKey()}`),payload,{merge:true}),
    setDoc(doc(db,"dailyStats",`${CARD_ID}_${dayKey()}`),payload,{merge:true})
  ])}catch(e){console.warn("Legacy profile-view analytics skipped",e)}
}
function trackView(){return trackMetric("view")}
function initActionTracking(){
  const map={phoneButton:"phone",textButton:"text",whatsappButton:"whatsapp",emailButton:"email",websiteButton:"website",phone1Row:"phone",phone2Row:"phone",whatsappRow:"whatsapp",emailRow:"email",websiteRow:"website",facebookLink:"facebook",instagramLink:"instagram",linkedinLink:"linkedin",twitterLink:"twitter",tiktokLink:"tiktok",youtubeLink:"youtube",catalogLink:"catalog",customBusinessLink:"customLink",saveContactButton:"saveContact",shareButton:"share",footerShareButton:"share",finalCtaSection:"cta"};
  Object.entries(map).forEach(([id,name])=>$id(id)?.addEventListener("click",()=>trackMetric(name),{passive:true}));
}

function pdfObjectURL(data){try{if(!data?.startsWith("data:application/pdf"))return data;const b=atob(data.split(",")[1]),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return URL.createObjectURL(new Blob([a],{type:"application/pdf"}))}catch{return""}}
function youtubeEmbed(url){if(!url)return"";try{const u=new URL(url);if(u.hostname.includes("youtu.be"))return"https://www.youtube.com/embed/"+u.pathname.slice(1);if(u.hostname.includes("youtube.com")){if(u.pathname.startsWith("/embed/"))return url;const v=u.searchParams.get("v");if(v)return"https://www.youtube.com/embed/"+v;const m=u.pathname.match(/\/shorts\/([^/?]+)/);if(m)return"https://www.youtube.com/embed/"+m[1]}return url}catch{return url}}
function setImage(id,src,fallbackText){const e=$id(id);if(!e)return;if(src){e.src=src;e.style.display=""}else{e.removeAttribute("src");e.style.display="none";if(fallbackText)e.alt=fallbackText}}
function applyData(){text("profileName",p.fullName);text("profilePosition",p.position);text("companyName",p.company);text("profileDescription",p.description);const loc=[p.city,p.state].filter(Boolean).join(", ");const pl=$id("profileLocation");if(pl)pl.innerHTML='<i class="fa-solid fa-location-dot"></i> '+loc;text("displayLocation",loc);text("displayPhone",p.phone);text("displayPhone2",p.phone2);text("displayWhatsApp",p.whatsapp||p.phone);text("displayEmail",p.email);text("displayWebsite",displayWeb(p.website));
setImage("profilePhoto",p.profileImage,p.fullName);setImage("coverImage",p.coverImage,"Cover image");
link("phoneButton","tel:"+p.phoneRaw);link("textButton","sms:"+p.phoneRaw);link("emailButton","mailto:"+p.email);link("websiteButton",p.website);const quickWa=p.whatsappRaw||p.phoneRaw;link("whatsappButton","https://wa.me/"+cleanPhone(quickWa));link("phone1Row","tel:"+p.phoneRaw);link("phone2Row","tel:"+p.phone2Raw);link("emailRow","mailto:"+p.email);link("websiteRow",p.website);const wa=p.whatsappRaw||p.phoneRaw;link("whatsappRow","https://wa.me/"+cleanPhone(wa));[["facebookLink",p.facebook],["instagramLink",p.instagram],["linkedinLink",p.linkedin],["twitterLink",p.twitter],["tiktokLink",p.tiktok],["youtubeLink",p.youtube]].forEach(([id,u])=>link(id,u));const cat=pdfObjectURL(p.catalogFile)||p.catalog;link("catalogLink",cat);text("customBusinessLabel",p.customBusinessLabel);text("customBusinessSubtitle",p.customBusinessSubtitle);link("customBusinessLink",p.customBusinessUrl);
for(let i=1;i<=3;i++){text(`service${i}Title`,p[`service${i}Title`]);text(`service${i}Description`,p[`service${i}Description`]);const ic=$id(`service${i}Icon`);if(ic)ic.className="fa-solid "+(p[`service${i}Icon`]||"fa-star")}
const vid=$id("featuredVideo");if(vid){if(p.videoUrl){vid.src=youtubeEmbed(p.videoUrl);vid.style.display=""}else vid.removeAttribute("src")};text("finalCtaTitle",p.finalCtaTitle);text("finalCtaText",p.finalCtaText);text("finalCtaLabel",p.finalCtaLabel);link("final-cta-button","tel:"+p.phoneRaw);loadGallery();applyVisibility(cat);applyTheme(p.theme||"gold")}
function loadGallery(){const imgs=Array.isArray(p.galleryImages)?p.galleryImages:[];document.querySelectorAll(".gallery-item").forEach((item,i)=>{const im=item.querySelector("img");if(imgs[i]){if(im)im.src=imgs[i];item.dataset.image=imgs[i];item.style.display=""}else item.style.display="none"})}
function planAllows(feature){
  const planName=p.complimentaryBusiness===true?"Business":(p.complimentaryPremium===true?"Premium":(p.plan||"Premium"));
  if(["qrCardThemes"].includes(feature) && typeof p.featureOverrides?.[feature]==="boolean") return p.featureOverrides[feature];
  if(platformFeatureControls.enabled===false){let base;if(String(planName).toLowerCase()==="business")base=true;else if(String(planName).toLowerCase()==="premium")base=!["quickCapture","leads","advancedAnalytics"].includes(feature);else base=BASIC_FEATURE_DEFAULTS.has(feature);return base&&p.featureOverrides?.[feature]!==false}
  if(platformFeatureControls.global?.[feature]===false)return false;
  const bucket=String(planName).toLowerCase()==="basic"?platformFeatureControls.Basic:String(planName).toLowerCase()==="business"?platformFeatureControls.Business:platformFeatureControls.Premium;
  return bucket?.[feature]!==false && p.featureOverrides?.[feature]!==false;
}
function applyVisibility(cat){const v=p.visibility||{};visible("profileDescription",planAllows("description")&&v.description!==false&&has(p.description));visible("saveContactButton",planAllows("saveContact")&&v.saveContact!==false);visible("phoneButton",planAllows("quickActions")&&planAllows("phone")&&v.quickActions!==false&&v.phone!==false&&has(p.phoneRaw));visible("textButton",planAllows("quickActions")&&planAllows("phone")&&v.quickActions!==false&&v.phone!==false&&has(p.phoneRaw));visible("emailButton",planAllows("quickActions")&&planAllows("email")&&v.quickActions!==false&&v.email!==false&&has(p.email));visible("websiteButton",planAllows("quickActions")&&planAllows("website")&&v.quickActions!==false&&v.website!==false&&has(p.website));visible("whatsappButton",planAllows("quickActions")&&planAllows("whatsapp")&&v.quickActions!==false&&v.whatsapp!==false&&has(p.whatsappRaw||p.phoneRaw));visible("quickActions",planAllows("quickActions")&&v.quickActions!==false&&["phoneButton","textButton","whatsappButton","emailButton","websiteButton"].some(id=>$id(id)?.style.display!=="none"));visible("phone1Row",planAllows("phone")&&v.phone!==false&&has(p.phoneRaw));visible("phone2Row",planAllows("phone2")&&v.phone2!==false&&has(p.phone2Raw));visible("whatsappRow",planAllows("whatsapp")&&v.whatsapp!==false&&has(p.whatsappRaw||p.phoneRaw));visible("emailRow",planAllows("email")&&v.email!==false&&has(p.email));visible("websiteRow",planAllows("website")&&v.website!==false&&has(p.website));visible("locationRow",planAllows("location")&&v.location!==false&&(has(p.city)||has(p.state)));visible("contactSection",["phone1Row","phone2Row","whatsappRow","emailRow","websiteRow","locationRow"].some(id=>$id(id)?.style.display!=="none"));const socials=[["facebookLink","facebook",p.facebook],["instagramLink","instagram",p.instagram],["linkedinLink","linkedin",p.linkedin],["twitterLink","twitter",p.twitter],["tiktokLink","tiktok",p.tiktok],["youtubeLink","youtube",p.youtube]];socials.forEach(([id,k,u])=>visible(id,planAllows(k)&&v[k]!==false&&has(u)));visible("socialSection",socials.some(([id])=>$id(id)?.style.display!=="none"));visible("services",planAllows("services")&&v.services!==false);visible("gallery",planAllows("gallery")&&v.gallery!==false&&Array.isArray(p.galleryImages)&&p.galleryImages.length>0);visible("videoSection",planAllows("video")&&v.video!==false&&has(p.videoUrl));visible("qrSection",planAllows("qr")&&v.qr!==false);visible("finalCtaSection",planAllows("finalCTA")&&v.finalCTA!==false);visible("businessServicesLink",planAllows("services")&&v.services!==false);visible("businessGalleryLink",planAllows("gallery")&&v.gallery!==false&&Array.isArray(p.galleryImages)&&p.galleryImages.length>0);visible("catalogLink",planAllows("catalog")&&v.catalog!==false&&has(cat));visible("customBusinessLink",planAllows("customBusiness")&&v.customBusiness!==false&&has(p.customBusinessUrl));visible("businessLinksSection",planAllows("businessLinks")&&v.businessLinks!==false&&["businessServicesLink","businessGalleryLink","catalogLink","customBusinessLink"].some(id=>$id(id)?.style.display!=="none"));visible("quickCaptureSection",effectivePublicPlan()==="Business"&&planAllows("quickCapture"))}
const themes={gold:["#b88a2b","#e7cc84","#745317","184, 138, 43"],blue:["#2563eb","#93c5fd","#1e3a8a","37, 99, 235"],emerald:["#059669","#6ee7b7","#065f46","5, 150, 105"],purple:["#7c3aed","#c4b5fd","#4c1d95","124, 58, 237"],red:["#dc2626","#fca5a5","#7f1d1d","220, 38, 38"],black:["#171717","#a3a3a3","#050505","23, 23, 23"],cyan:["#06b6d4","#a5f3fc","#155e75","6, 182, 212"]};
function applyTheme(t){const a=themes[t]||themes.gold,r=document.documentElement;r.style.setProperty("--accent",a[0]);r.style.setProperty("--accent-light",a[1]);r.style.setProperty("--accent-dark",a[2]);r.style.setProperty("--accent-rgb",a[3]);document.querySelectorAll(".theme-option").forEach(b=>b.classList.toggle("selected",b.dataset.theme===t))}
function initTheme(){const panel=$id("themePanel");$id("themeButton")?.addEventListener("click",()=>panel?.classList.add("active"));$id("closeThemePanel")?.addEventListener("click",()=>panel?.classList.remove("active"));document.querySelectorAll(".theme-option").forEach(b=>b.addEventListener("click",()=>{applyTheme(b.dataset.theme);panel?.classList.remove("active")}))}
function initGallery(){const lb=$id("lightbox"),li=$id("lightboxImage");document.querySelectorAll(".gallery-item").forEach(item=>item.addEventListener("click",()=>{if(!lb||!li)return;li.src=item.dataset.image||item.querySelector("img")?.src||"";lb.classList.add("active");lb.setAttribute("aria-hidden","false")}));$id("lightboxClose")?.addEventListener("click",()=>lb?.classList.remove("active"));lb?.addEventListener("click",e=>{if(e.target===lb)lb.classList.remove("active")})}
function cardURL(){if(CARD_ID==="main")return location.origin+"/";if(["localhost","127.0.0.1"].includes(location.hostname)||location.hostname.endsWith("github.io"))return new URL(`card.html?card=${encodeURIComponent(CARD_ID)}`,location.href).href;return `${location.origin}/c/${CARD_ID}`}
async function shareCard(){const data={title:`${p.fullName} | ${p.company}`,text:"View my digital business card.",url:cardURL()};try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(data.url);toast("Card link copied")}}catch{}}
function escapeVC(v){return String(v||"").replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;")}
function saveContact(){const lines=["BEGIN:VCARD","VERSION:3.0",`FN:${escapeVC(p.fullName)}`,`ORG:${escapeVC(p.company)}`,`TITLE:${escapeVC(p.position)}`,p.phoneRaw?`TEL;TYPE=CELL:${p.phoneRaw}`:"",p.phone2Raw?`TEL;TYPE=CELL:${p.phone2Raw}`:"",p.email?`EMAIL;TYPE=INTERNET:${p.email}`:"",p.website?`URL:${p.website}`:"",`ADR;TYPE=WORK:;;;${escapeVC(p.city)};${escapeVC(p.state)};;;`,"END:VCARD"].filter(Boolean).join("\r\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([lines],{type:"text/vcard;charset=utf-8"}));a.download=(p.fullName||"contact").replace(/[^a-z0-9]+/gi,"-")+".vcf";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}

function effectivePublicPlan(){return p.complimentaryBusiness===true?"Business":(p.complimentaryPremium===true?"Premium":(p.plan||"Premium"))}
function showBusinessPolicy(kind){const d=window.__jmxPublicSettings?.business||{};const title=kind==="terms"?"JMX Business Terms & Conditions":"JMX Business Privacy Policy";const body=kind==="terms"?d.terms:d.privacyPolicy;text("businessPolicyTitle",title);text("businessPolicyBody",body||"Policy content has not been published yet.");$id("businessPolicyDialog")?.showModal()}
async function submitQuickCapture(event){
  event.preventDefault();
  const status=$id("quickCaptureStatus"),button=$id("submitLeadButton");
  if(effectivePublicPlan()!=="Business"||!planAllows("quickCapture")){if(status)status.textContent="Quick Capture is not available for this card.";return}
  const name=$id("leadName")?.value.trim()||"",phone=$id("leadPhone")?.value.trim()||"",email=$id("leadEmail")?.value.trim()||"",company=$id("leadCompany")?.value.trim()||"",message=$id("leadMessage")?.value.trim()||"";
  if(!name){if(status)status.textContent="Please enter your name.";return}
  if(!$id("leadConsent")?.checked){if(status)status.textContent="Please accept the Business Terms and Privacy Policy.";return}
  if(button)button.disabled=true;if(status)status.textContent="Sending…";
  try{
    const now=Date.now(),expiresAt=Timestamp.fromMillis(now+30*24*60*60*1000);
    const policies=window.__jmxPublicSettings?.business||{};
    await addDoc(collection(db,"leads",CARD_ID,"items"),{cardId:CARD_ID,name,phone,email,company,message,status:"New",notes:"",meetingNotes:"",followUpDate:null,createdAt:serverTimestamp(),expiresAt,policyVersion:String(policies.policyVersion||policies.updatedAt||"business-v1"),acceptedAt:serverTimestamp(),plan:"Business"});
    trackActions(planAllows("leads")?["quickCapture","leadReceived"]:["quickCapture"]);
    event.currentTarget.reset();if(status)status.textContent="Your contact was shared successfully.";
  }catch(e){console.error("Quick Capture failed",e);if(status)status.textContent="Could not share your contact. Please try again."}finally{if(button)button.disabled=false}
}
function initQuickCapture(){
  $id("quickCaptureForm")?.addEventListener("submit",submitQuickCapture);
  $id("openBusinessTerms")?.addEventListener("click",()=>showBusinessPolicy("terms"));
  $id("openBusinessPrivacy")?.addEventListener("click",()=>showBusinessPolicy("privacy"));
  $id("closeBusinessPolicyDialog")?.addEventListener("click",()=>$id("businessPolicyDialog")?.close());
}

const QR_CARD_THEMES=[
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

function renderPublicQrCardTheme(){const host=$id("qrCardThemePublic"),code=$id("qrCardThemeCode");if(!host||!code)return;const allowed=planAllows("qrCardThemes")&&planAllows("qr");visible("qrCardThemePublic",allowed);if(!allowed)return;const t=QR_CARD_THEMES.find(x=>x.id===(p.qrCardTheme||"default"))||QR_CARD_THEMES[0];host.style.background=t.css;code.innerHTML="";const [dark,light]=effectivePublicPlan()==="Business"&&planAllows("customQR")?validQrColors():["#111111","#ffffff"];new QRCode(code,{text:qrShareURL(),width:150,height:150,colorDark:dark,colorLight:light,correctLevel:QRCode.CorrectLevel.H})}

function qrShareURL(){const u=new URL(cardURL(),location.href);u.searchParams.set("src","qr");return u.href}
function validQrColors(){
  const valid=h=>/^#[0-9a-f]{6}$/i.test(h||"");const dark=valid(p.qrDarkColor)?p.qrDarkColor:"#111111",light=valid(p.qrLightColor)?p.qrLightColor:"#ffffff";
  const rgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];const hex=a=>"#"+a.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,"0")).join("");
  const lum=h=>{const c=rgb(h).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*c[0]+.7152*c[1]+.0722*c[2]};const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  if(ratio(dark,light)>=4.5)return[dark,light];
  const base=rgb(dark);for(let f=.85;f>=.2;f-=.05){const candidate=hex(base.map(v=>v*f));if(ratio(candidate,light)>=4.5)return[candidate,light]}
  return["#111111","#ffffff"];
}
function initQR(){const q=$id("qrCode");if(!q||typeof QRCode==="undefined")return;q.innerHTML="";const [dark,light]=effectivePublicPlan()==="Business"&&planAllows("customQR")?validQrColors():["#111111","#ffffff"];new QRCode(q,{text:qrShareURL(),width:160,height:160,colorDark:dark,colorLight:light,correctLevel:QRCode.CorrectLevel.H});renderPublicQrCardTheme();const btn=$id("downloadQrButton");if(btn){btn.hidden=!(effectivePublicPlan()==="Business"&&planAllows("qrDownload"));btn.onclick=()=>{const canvas=q.querySelector("canvas"),img=q.querySelector("img"),a=document.createElement("a");a.download=`JMX-${CARD_ID}-QR.png`;a.href=canvas?.toDataURL("image/png")||img?.src||"";if(a.href)a.click();trackMetric("qrDownload")}}}
function toast(m){let e=$id("toastMessage");if(!e){e=document.createElement("div");e.id="toastMessage";e.style.cssText="position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111;color:#fff;padding:11px 16px;border-radius:12px;z-index:9999";document.body.appendChild(e)}e.textContent=m;e.style.display="block";clearTimeout(window._toast);window._toast=setTimeout(()=>e.style.display="none",2200)}
function showUnavailable(title,message){const app=document.querySelector(".digital-card-app");if(app)app.style.display="none";const box=document.createElement("main");box.className="public-status-screen";box.innerHTML=`<div class="public-status-card"><div class="public-status-icon"><i class="fa-regular fa-address-card"></i></div><h1>${title}</h1><p>${message}</p><a href="https://jmxdigitalcard.com">JMX Digital Card</a></div>`;document.body.appendChild(box);document.body.classList.remove("firebase-loading")}
async function boot(){
  document.body.classList.add("firebase-loading");let remote=null;
  try{remote=await getOnlineProfile()}catch(e){console.error("Firebase load failed",e)}
  if(!remote){const localHost=["localhost","127.0.0.1"].includes(location.hostname);if(localHost)remote=getLegacy();else return showUnavailable("Card not found","This JMX Digital Card code does not exist.")}
  if(remote.__activation){const app=document.querySelector(".digital-card-app");if(app)app.style.display="none";const box=document.createElement("main");box.className="public-status-screen";box.innerHTML=`<div class="public-status-card"><div class="public-status-icon"><i class="fa-solid fa-wifi"></i></div><h1>Activate your JMX Digital Card</h1><p>This NFC card is ready to be claimed by its owner.</p><a class="activation-link" href="/activate.html?card=${encodeURIComponent(CARD_ID)}">Activate Card</a><p style="margin-top:18px"><a href="/login.html">Owner Login</a></p></div>`;document.body.appendChild(box);document.body.classList.remove("firebase-loading");return}
  if(remote.__suspended)return showUnavailable("Card temporarily unavailable","This JMX Digital Card is currently suspended.");
  p=remote;applyData();initTheme();initGallery();initQR();initQuickCapture();trackView();initActionTracking();$id("shareButton")?.addEventListener("click",shareCard);$id("footerShareButton")?.addEventListener("click",shareCard);$id("saveContactButton")?.addEventListener("click",saveContact);text("currentYear",new Date().getFullYear());const owner=document.createElement("a");owner.href="/login.html";owner.textContent="Owner Login";owner.className="owner-login-link";document.body.appendChild(owner);if(effectivePublicPlan()==="Business"&&planAllows("brandingRemoval")&&p.removeJmxBranding===true){document.querySelector(".card-footer")?.remove();document.querySelector(".owner-login-link")?.remove();}if(params.get("src")==="qr")trackMetric("qrVisit");document.body.classList.remove("firebase-loading")
}
document.addEventListener("DOMContentLoaded",boot);
