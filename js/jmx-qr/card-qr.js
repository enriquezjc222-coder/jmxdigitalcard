/**
 * card-qr.js — THE single QR layer of JMX Digital Card.
 *
 * Every card QR (public profile, customer editor preview, platform dashboard
 * preview, QR PNG download) is produced here, for existing and future cards alike.
 *
 *   renderCardQr(host, { targetUrl, customization, logoMode, themeColors, size })
 *
 * What it guarantees:
 *   • the QR encodes EXACTLY `targetUrl` — styling never changes data;
 *   • Error Correction H, 4-module quiet zone, finder/timing/format/alignment
 *     patterns protected, JMX emblem centred (target 22% of total width);
 *   • the emblem shrinks automatically when 22% is not safe for that QR;
 *   • every rendered QR is DECODED before it is shown (rendered pixels + worst-case
 *     logo area); if it does not return exactly `targetUrl`, a safer QR is used
 *     (smaller emblem → default black/white + JMX → plain black/white). A broken
 *     QR is never displayed.
 *
 * Nothing here reads or writes Firestore, card IDs, account/identity IDs, NFC,
 * device IDs or activation codes.
 */
import { buildQrModel } from './qr-engine.js';
import { tryDecodeQrGrid } from './qr-decoder.js';
import { calculateAccentBorder, contrastRatio, relativeLuminance, adjustForContrast, normalizeHex } from './qr-colors.js';
import { getQrModuleConfig } from './qr-config.js';

// ------------------------------------------------------------------ target URL (unchanged logic)
/** Identical to script.js sanitizeCardId(). */
export function sanitizeCardId(v) {
  const raw = String(v || 'main').trim();
  if (raw.toLowerCase() === 'main') return 'main';
  return raw.toUpperCase().replace(/[^A-Z0-9_-]/g, '-').slice(0, 64) || 'main';
}
/**
 * The URL every card QR has always encoded (moved verbatim from script.js qrShareURL()):
 *   https://jmxdigitalcard.com/c/{CARD_ID}?src=qr   (main → https://jmxdigitalcard.com/?src=qr)
 * `?src=qr` is the existing QR-visit analytics marker; /c/{id} is the permanent card URL.
 */
export function cardQrTargetUrl(cardId) {
  const id = sanitizeCardId(cardId);
  const canonical = id === 'main' ? 'https://jmxdigitalcard.com/' : `https://jmxdigitalcard.com/c/${encodeURIComponent(id)}`;
  const u = new URL(canonical);
  u.searchParams.set('src', 'qr');
  return u.href;
}

// ------------------------------------------------------------------ theme (for the accent ring only)
/** id → hex of script.js QR_CARD_THEMES (kept in sync by tests). */
export const QR_CARD_THEME_HEX = {"default":"#1f2937","silver_uv":"#64748b","black_gold":"#171717","black_matte":"#111827","electric_blue":"#075985","deep_navy":"#172554","emerald":"#065f46","teal":"#115e59","purple":"#581c87","violet":"#5b21b6","aurora":"#0f766e","red_matte":"#991b1b","red_gold":"#9f1239","rose_gold":"#9f5f67","copper":"#9a3412","carbon_red":"#27272a","gold":"#854d0e","cyan":"#0e7490","platinum_prism":"#6b7280","obsidian_chrome":"#18181b","midnight_spectrum":"#111827","ultraviolet_titanium":"#4c1d95","emerald_amethyst":"#065f46","sapphire_violet":"#1e3a8a","crimson_solar":"#991b1b","ruby_chrome":"#9f1239","champagne_metal":"#a16207","rose_platinum":"#9d6b75","molten_copper":"#9a3412","titanium_ice":"#475569","graphite_laser":"#27272a","opal_shift":"#94a3b8","arctic_hologram":"#0891b2","black_neon_flux":"#09090b","scarlet_noir":"#7f1d1d","cosmic_pearl":"#6366f1","neon_titanium":"#334155","golden_prism":"#a16207","emerald_circuit":"#047857","sapphire_chrome":"#1d4ed8","crimson_geometry":"#b91c1c","arctic_aurora":"#0e7490","violet_matrix":"#6d28d9","copper_horizon":"#b45309","midnight_crystal":"#1e293b","solar_carbon":"#292524","electric_quartz":"#0891b2","rose_hologram":"#be185d","ocean_prism":"#0369a1","obsidian_gold":"#171717","titanium_wave":"#64748b","emerald_geometry":"#059669","scarlet_chrome":"#be123c","cosmic_silver":"#64748b","diamond_noir":"#18181b","golden_aurora":"#a16207","laser_sapphire":"#1d4ed8","emerald_prism":"#047857","violet_flare":"#7c3aed","ruby_prism":"#be123c","aqua_chrome":"#0e7490","purple_gold_flux":"#6d28d9","carbon_aurora":"#27272a","solar_ruby":"#9f1239","ice_violet":"#6366f1","bronze_laser":"#b45309","neon_jade":"#10b981","midnight_rose":"#9d174d","platinum_wave":"#64748b","cosmic_emerald":"#059669","orange_titanium":"#c2410c","blue_hologram":"#2563eb","golden_graphite":"#3f3f46","aurora_pearl":"#94a3b8"};
/** Same rule as script.js selectedPublicTheme(). */
export function cardThemeHex(profile = {}, allows = () => false) {
  const id = allows('qrCardThemes') ? (profile.qrCardTheme || 'default') : 'default';
  return QR_CARD_THEME_HEX[id] || QR_CARD_THEME_HEX.default;
}

// ------------------------------------------------------------------ customization resolution
/**
 * Business Logo QR settings live ONLY on the admin-only card document
 * (cards/{cardId}.qrBusinessLogo — firestore.rules: card writes are admin-only) and the file
 * lives under the admin-only Storage path cards/{cardId}/qrBusinessLogo/ (storage.rules).
 * Anything a card owner can write (profiles/{id}) is deliberately ignored here.
 *   { url, maskUrl?, storagePath, maskStoragePath?, mode:'business'|'jmx',
 *     colorMode:'original'|'monochrome', hasTransparency, width, height, bytes, uploadedAt, uploadedBy }
 * Only Firebase Storage URLs (or same-origin URLs) are accepted as logo sources.
 */
export function isAllowedLogoUrl(url) {
  if (typeof url !== 'string' || !url || url.length > 2048) return false;
  let u; try { u = new URL(url, typeof location !== 'undefined' ? location.href : 'https://jmxdigitalcard.com/'); } catch { return false; }
  if (typeof location !== 'undefined' && u.origin === location.origin && /^https?:$/.test(u.protocol)) return true;
  return u.protocol === 'https:' && (u.hostname === 'firebasestorage.googleapis.com' || u.hostname === 'storage.googleapis.com');
}
export function normalizeBusinessLogo(raw) {
  if (!raw || typeof raw !== 'object' || !isAllowedLogoUrl(raw.url)) return null;
  return {
    url: raw.url,
    maskUrl: isAllowedLogoUrl(raw.maskUrl) ? raw.maskUrl : null,
    mode: raw.mode === 'jmx' ? 'jmx' : 'business',            // default for a stored logo: use it
    colorMode: raw.colorMode === 'monochrome' ? 'monochrome' : 'original',
    storagePath: typeof raw.storagePath === 'string' ? raw.storagePath : null,
    maskStoragePath: typeof raw.maskStoragePath === 'string' ? raw.maskStoragePath : null,
    hasTransparency: raw.hasTransparency === true,
  };
}

/**
 * Decide the QR style of a card from its EXISTING data and permissions.
 *   QR Visual Customization  = existing feature key "customQR" (plan switches + client override)
 *                              → profile.qrDarkColor / profile.qrLightColor
 *   Business Logo QR         = feature key "businessLogoQr" + card.qrBusinessLogo (admin-only, see above)
 *                              with mode "business"
 * @param {{profile:object, allows:(feature:string)=>boolean, businessLogo?:object|null}} p
 */
export function resolveCardQrCustomization({ profile = {}, allows = () => false, businessLogo = null } = {}) {
  const d = getQrModuleConfig().defaults;
  const visual = allows('customQR') === true;
  const bizAllowed = allows('businessLogoQr') === true;
  let fg = d.foregroundColor; let bg = d.backgroundColor; let adjusted = false;
  if (visual) {
    fg = normalizeHex(profile.qrDarkColor) || '#111111';
    bg = normalizeHex(profile.qrLightColor) || '#FFFFFF';
    // Readability protection: QR must be darker than its background, with real contrast.
    if (relativeLuminance(fg) >= relativeLuminance(bg)) { fg = d.foregroundColor; bg = d.backgroundColor; adjusted = true; }
    else if (contrastRatio(fg, bg) < 3) { const s = adjustForContrast(fg, bg, 4.5); if (s && contrastRatio(s, bg) >= 4.5) { fg = s; } else { fg = d.foregroundColor; bg = d.backgroundColor; } adjusted = true; }
  }
  // Business logo = the logo a platform admin uploaded (card document, admin-only). The
  // owner-writable profile is never consulted, so a client cannot inject a logo or switch it on.
  const biz = normalizeBusinessLogo(businessLogo);
  const logoMode = biz && biz.mode === 'business' && bizAllowed ? 'business' : 'jmx';
  const mono = logoMode === 'business' && biz.colorMode === 'monochrome' && !!biz.maskUrl;
  return {
    enabled: visual,
    foregroundColor: fg,
    backgroundColor: bg,
    logoMode,
    businessLogoUrl: logoMode === 'business' ? (mono ? biz.maskUrl : biz.url) : null,
    businessLogoColorMode: logoMode === 'business' ? (mono ? 'monochrome' : 'original') : null,
    colorAdjusted: adjusted,
    businessLogoAllowed: bizAllowed,
    businessLogoStored: !!biz,
  };
}

// ------------------------------------------------------------------ images
const imageCache = new Map();
function loadImage(src, { cors = true } = {}) {
  const key = `${cors ? 'c' : 'n'}|${src}`;
  if (imageCache.has(key)) return imageCache.get(key);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    if (cors && /^https?:/i.test(src) && !src.startsWith(location.origin)) img.crossOrigin = 'anonymous';
    img.onload = () => (img.naturalWidth ? resolve(img) : reject(new Error('empty image')));
    img.onerror = () => reject(new Error(`image failed: ${String(src).slice(0, 60)}`));
    img.src = src;
  });
  imageCache.set(key, p);
  p.catch(() => imageCache.delete(key));
  return p;
}
/**
 * Business logos are displayed with a plain (non-CORS) load so a Storage bucket without a
 * CORS rule never produces console errors; such a canvas is verified by decoding the model
 * (logo area forced to worst-case values). Same-origin / data: logos are pixel-verified too.
 * For PNG export a CORS load is attempted (`forExport`).
 */
async function loadLogoImage(src, { forExport = false, tint = null } = {}) {
  let loaded = null;
  if (forExport) {
    try { loaded = { img: await loadImage(src, { cors: true }), readable: true }; } catch { /* fall through */ }
  }
  if (!loaded) loaded = { img: await loadImage(src, { cors: false }), readable: false };
  const hex = normalizeHex(tint);
  if (!hex) return loaded;
  // Monochrome: the stored file is an alpha MASK (black ink on transparent). Tinting with
  // 'source-in' needs no pixel reads, so it also works for non-CORS images.
  const S = 384; const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const iw = loaded.img.naturalWidth || loaded.img.width; const ih = loaded.img.naturalHeight || loaded.img.height;
  const f = Math.min(S / iw, S / ih);
  ctx.drawImage(loaded.img, (S - iw * f) / 2, (S - ih * f) / 2, iw * f, ih * f);
  ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = hex; ctx.fillRect(0, 0, S, S);
  return { img: c, readable: loaded.readable };
}
const tintCache = new Map();
async function jmxEmblem(color) {
  const { assets } = getQrModuleConfig();
  const hex = normalizeHex(color);
  if (!hex) return { img: await loadImage(assets.jmxLogoUrl), readable: true };
  if (tintCache.has(hex)) return tintCache.get(hex);
  const p = loadImage(assets.jmxLogoMaskUrl).then((mask) => {
    const c = document.createElement('canvas'); c.width = 384; c.height = 384;
    const ctx = c.getContext('2d');
    ctx.drawImage(mask, 0, 0, 384, 384);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = hex; ctx.fillRect(0, 0, 384, 384);
    return { img: c, readable: true };
  });
  tintCache.set(hex, p);
  p.catch(() => tintCache.delete(hex));
  return p;
}

// ------------------------------------------------------------------ rendering + verification
function drawQr(canvas, model, { fg, bg, logoImg, plate, pixelSize }) {
  const T = model.totalModules; const q = model.quietZone; const { qr, layout } = model;
  const W = Math.max(T, Math.round(pixelSize));
  canvas.width = W; canvas.height = W;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const e = (k) => Math.round((k * W) / T);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, W);
  ctx.fillStyle = fg;
  const cleared = layout ? new Set(layout.clearedIndices) : null;
  for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) {
    const idx = r * qr.size + c;
    if (!qr.modules[idx] || (cleared && cleared.has(idx))) continue;
    const x1 = e(c + q); const x2 = e(c + q + 1); const y1 = e(r + q); const y2 = e(r + q + 1);
    ctx.fillRect(x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1));
  }
  if (layout && logoImg) {
    const k = W / T; const cx = W / 2; const pr = (layout.plateModules * k) / 2;
    ctx.fillStyle = bg; ctx.beginPath();
    if (plate === 'rounded' && ctx.roundRect) ctx.roundRect(cx - pr, cx - pr, pr * 2, pr * 2, pr * 0.36); else if (plate === 'rounded') ctx.rect(cx - pr, cx - pr, pr * 2, pr * 2); else ctx.arc(cx, cx, pr, 0, Math.PI * 2);
    ctx.fill();
    const s = layout.logoModules * k;
    const iw = logoImg.naturalWidth || logoImg.width; const ih = logoImg.naturalHeight || logoImg.height;
    const f = Math.min(s / iw, s / ih);
    ctx.drawImage(logoImg, cx - (iw * f) / 2, cx - (ih * f) / 2, iw * f, ih * f);
  }
  return { W, edge: e };
}

/** Decode the rendered pixels (sampling each module centre) — throws SecurityError on tainted canvases. */
function decodeCanvasPixels(canvas, model, fg, bg, edge) {
  const { qr, quietZone: q } = model; const W = canvas.width;
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, W).data;
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
  const thr = (lum(fg) + lum(bg)) / 2;
  const grid = new Uint8Array(qr.size * qr.size);
  for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) {
    const x = Math.min(W - 1, Math.floor((edge(c + q) + edge(c + q + 1)) / 2));
    const y = Math.min(W - 1, Math.floor((edge(r + q) + edge(r + q + 1)) / 2));
    const i = (y * W + x) * 4;
    grid[r * qr.size + c] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) < thr ? 1 : 0;
  }
  return tryDecodeQrGrid(grid, qr.size);
}
/** Decode the model with the whole logo area forced dark AND forced light (worst cases). */
function decodeModelWorstCase(model) {
  const { qr, layout } = model;
  const variants = layout ? [0, 1] : [null];
  let first = null;
  for (const v of variants) {
    const g = Uint8Array.from(qr.modules);
    if (layout) for (const i of layout.clearedIndices) g[i] = v;
    const r = tryDecodeQrGrid(g, qr.size);
    if (!r) return null;
    if (!first) first = r;
    else if (r.text !== first.text) return null;
  }
  return first;
}

function attemptPlan({ targetUrl, fg, bg, logoMode, businessLogoUrl }) {
  const cfg = getQrModuleConfig();
  const target = cfg.qr.logoScaleTarget;
  const steps = [1, 0.85, 0.7, 0.55, 0.42];
  const plan = [];
  const logos = logoMode === 'business' && businessLogoUrl ? ['business', 'jmx'] : logoMode === 'none' ? [] : ['jmx'];
  // Business logos are square, multi-coloured and usually darker than the emblem: they get a
  // slightly smaller ceiling (0.9 × target ≈ 20%) and a rounded plate; the JMX emblem uses the full target.
  for (const kind of logos) for (const f of steps) { const t = (kind === 'business' ? target * 0.9 : target) * f; plan.push({ fg, bg, kind, totalScale: t, label: `${kind}@${Math.round(t * 100)}%` }); }
  const d = cfg.defaults;
  if (fg !== d.foregroundColor || bg !== d.backgroundColor) for (const f of steps) plan.push({ fg: d.foregroundColor, bg: d.backgroundColor, kind: 'jmx', totalScale: target * f, fallback: 'default', label: `default-jmx@${Math.round(target * f * 100)}%` });
  plan.push({ fg: d.foregroundColor, bg: d.backgroundColor, kind: 'none', totalScale: 0, fallback: 'plain', label: 'plain' });
  return plan.map((p) => ({ ...p, targetUrl, businessLogoUrl }));
}

/**
 * Build a verified QR canvas. Pure rendering — no DOM insertion.
 * @returns {Promise<{canvas:HTMLCanvasElement, result:object}>}
 */
export async function buildVerifiedCardQr({ targetUrl, customization = {}, logoMode, businessLogoUrl, businessLogoColorMode, pixelSize = 512, forExport = false, minVersion }) {
  if (typeof targetUrl !== 'string' || !targetUrl) throw new Error('renderCardQr: targetUrl is required');
  const d = getQrModuleConfig().defaults;
  const fg = normalizeHex(customization.foregroundColor) || d.foregroundColor;
  const bg = normalizeHex(customization.backgroundColor) || d.backgroundColor;
  const mode = logoMode || customization.logoMode || 'jmx';
  const bizUrl = businessLogoUrl ?? customization.businessLogoUrl ?? null;
  const bizMono = (businessLogoColorMode ?? customization.businessLogoColorMode) === 'monochrome';
  const tried = [];
  for (const a of attemptPlan({ targetUrl, fg, bg, logoMode: mode, businessLogoUrl: bizUrl })) {
    try {
      let logo = null;
      if (a.kind === 'jmx') logo = await jmxEmblem(a.fg);
      else if (a.kind === 'business') logo = await loadLogoImage(a.businessLogoUrl, { forExport, tint: bizMono ? a.fg : null });
      // the engine takes a symbol-relative scale: convert "share of the total width"
      const probe = buildQrModel({ targetUrl, logo: { enabled: a.kind !== 'none', shape: a.kind === 'business' ? 'rounded' : 'circle', scale: 0.1 } });
      const symScale = a.kind === 'none' ? 0 : (a.totalScale * probe.totalModules) / probe.qr.size;
      const model = a.kind === 'none' ? buildQrModel({ targetUrl, minVersion }) : buildQrModel({ targetUrl, logo: { enabled: true, shape: a.kind === 'business' ? 'rounded' : 'circle', scale: symScale } });
      if (a.kind !== 'none' && !model.layout) { tried.push(`${a.label}: no safe logo zone`); continue; }
      const canvas = document.createElement('canvas');
      const { edge } = drawQr(canvas, model, { fg: a.fg, bg: a.bg, logoImg: logo?.img, plate: a.kind === 'business' ? 'rounded' : 'circle', pixelSize });
      const modelCheck = decodeModelWorstCase(model);
      if (!modelCheck || modelCheck.text !== targetUrl) { tried.push(`${a.label}: model decode mismatch`); continue; }
      let pixelCheck = null; let method = 'pixels+model';
      try { pixelCheck = decodeCanvasPixels(canvas, model, a.fg, a.bg, edge); } catch { method = 'model'; }
      if (method !== 'model' && (!pixelCheck || pixelCheck.text !== targetUrl)) { tried.push(`${a.label}: pixel decode mismatch`); continue; }
      const T = model.totalModules;
      const result = {
        targetUrl,
        decodedText: (pixelCheck || modelCheck).text,
        verified: true,
        verification: method,
        version: model.qr.version,
        errorCorrection: model.qr.ecc,
        foregroundColor: a.fg,
        backgroundColor: a.bg,
        logo: a.kind,
        logoColorMode: a.kind === 'business' ? (bizMono ? 'monochrome' : 'original') : null,
        logoScaleTarget: getQrModuleConfig().qr.logoScaleTarget,
        logoScaleOfTotal: model.layout ? model.layout.logoModules / T : 0,
        logoScaleOfSymbol: model.layout ? model.layout.scale : 0,
        logoReduced: !!model.layout && model.layout.logoModules / T < getQrModuleConfig().qr.logoScaleTarget - 0.004,
        worstBlockUsage: model.layout ? model.layout.worstBlockUsage : 0,
        coversCenterAlignment: !!model.layout?.coversCenterAlignment,
        usedFallback: !!a.fallback || (mode === 'business' && a.kind !== 'business'),
        fallback: a.fallback || (mode === 'business' && a.kind !== 'business' ? 'jmx' : null),
        attempts: tried,
        pixelSize: canvas.width,
      };
      canvas.dataset.qrUrl = targetUrl;
      canvas.dataset.qrVerified = method;
      canvas.dataset.qrLogo = a.kind;
      if (a.kind === 'business') canvas.dataset.qrLogoColor = bizMono ? 'monochrome' : 'original';
      canvas.dataset.qrLogoScale = result.logoScaleOfTotal.toFixed(4);
      canvas.dataset.qrFg = a.fg;
      canvas.dataset.qrFallback = result.fallback || 'none';
      canvas.dataset.qrVersion = String(model.qr.version);
      return { canvas, result };
    } catch (err) {
      tried.push(`${a.label}: ${err.message}`);
    }
  }
  throw new Error(`No verifiable QR could be produced: ${tried.join(' | ')}`);
}

/**
 * Render the card QR into `host` (replaces its content once verified — the old QR
 * stays visible until the new one is ready, so there is never an empty or broken QR).
 * @param {HTMLElement} host
 * @param {{targetUrl:string, customization?:{foregroundColor?:string, backgroundColor?:string, enabled?:boolean},
 *   logoMode?:'jmx'|'business'|'none', businessLogoUrl?:string|null, themeColors?:{primary?:string}|string|null,
 *   size:number, accentHost?:HTMLElement|null, label?:string}} opts
 */
export async function renderCardQr(host, opts) {
  const size = Math.max(64, Math.round(opts.size || 128));
  const dpr = Math.min(4, Math.max(1, window.devicePixelRatio || 1));
  const token = Symbol('render');
  host.__jmxQrToken = token;
  const { canvas, result } = await buildVerifiedCardQr({ ...opts, pixelSize: size * dpr });
  if (host.__jmxQrToken !== token) return { ...result, superseded: true };
  canvas.className = 'jmx-card-qr-canvas';
  canvas.style.width = `${size}px`; canvas.style.height = `${size}px`; canvas.style.display = 'block';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', opts.label || `QR code for ${opts.targetUrl}`);
  host.replaceChildren(canvas);
  host.dataset.qrUrl = result.targetUrl;
  if (opts.accentHost !== undefined) applyCardQrAccent(opts.accentHost, opts.customization?.enabled ? opts.themeColors : null);
  return result;
}

/**
 * Display size policy (CSS px). Mobile: 128 px (phones are ≥2× DPR → ≥5 device px per
 * module for normal Card IDs; very dense QRs from very long IDs grow up to 168 px). Desktop: an INTEGER number of CSS px per module (3–5 px), ~195–252 px, so modules
 * stay perfectly regular on 1× monitors and dense QRs (long URLs) grow instead of shrinking.
 */
export function recommendedCardQrSize(targetUrl, { mobile = false } = {}) {
  let T = 49;
  try { T = buildQrModel({ targetUrl, logo: { enabled: true, scale: 0.1 } }).totalModules; } catch { /* default v6 */ }
  // Mobile: 128 px minimum; only unusually dense QRs (very long Card IDs, v8+) grow up to 168 px.
  if (mobile) return Math.max(128, Math.min(168, Math.ceil(T * 2.5)));
  try {
    const k = Math.max(3, Math.min(Math.floor(252 / T), Math.round(240 / T)));
    return T * k;
  } catch { return 196; }
}

/** PNG export (download) using the same verified pipeline. */
export async function exportCardQrPng(opts, pixelSize = 1024) {
  const { canvas, result } = await buildVerifiedCardQr({ ...opts, pixelSize, forExport: true });
  try { return { dataUrl: canvas.toDataURL('image/png'), result }; } catch {
    // business logo not CORS-readable → export the same QR with the JMX emblem instead
    const again = await buildVerifiedCardQr({ ...opts, logoMode: 'jmx', pixelSize });
    return { dataUrl: again.canvas.toDataURL('image/png'), result: { ...again.result, exportNote: 'business-logo-not-exportable' } };
  }
}

/** Thin theme-derived ring around the QR shell (only when customization is enabled). */
export function applyCardQrAccent(el, themeColors) {
  if (!el) return;
  if (!themeColors) { el.classList.remove('jmx-qr-accent'); ['--jmxqr-accent', '--jmxqr-accent-highlight', '--jmxqr-accent-secondary', '--jmxqr-accent-shadow', '--jmxqr-accent-gradient'].forEach((k) => el.style.removeProperty(k)); return; }
  const a = calculateAccentBorder(themeColors);
  for (const [k, v] of Object.entries(a.cssVars)) el.style.setProperty(k, v);
  el.classList.add('jmx-qr-accent');
}
