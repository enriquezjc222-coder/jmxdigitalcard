/**
 * qr-logo-upload.js — Business Logo QR upload pipeline (browser).
 * Validates (real type from magic bytes, size, dimensions, corrupt files), sanitises SVG
 * (scripts, event handlers, external links removed; the SVG is only ever rasterised),
 * trims empty margins and produces an optimised 512 px square PNG + 128 px thumbnail.
 * Also produces an alpha MASK (black ink on transparent) used by the "Monochrome" colour
 * mode, so tinting at render time never needs to read pixels of a cross-origin image.
 * Used ONLY by the platform-admin dashboard; files go to cards/{cardId}/qrBusinessLogo/…,
 * a path storage.rules restricts to the platform admin (the card owner cannot write it).
 */
export class LogoError extends Error {
  constructor(message, code) { super(message); this.name = 'LogoError'; this.code = code; }
}
const LIMITS = { maxBytes: 5 * 1024 * 1024, minDimension: 64, maxDimension: 6000, maxPixels: 25_000_000,
  acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'], optimizedSize: 512, thumbnailSize: 128 };
export const getUploadLimits = () => ({ ...LIMITS });
const getQrModuleConfig = () => ({ upload: LIMITS });
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// ------------------------------------------------------------------ upload pipeline

/** Identify the real file type from its first bytes (never trust the extension). */
export function sniffImageType(bytes) {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.slice(0, 512)).replace(/^﻿/, '').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')) || (head.startsWith('<!--') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

const SVG_FORBIDDEN_ELEMENTS = ['script', 'foreignobject', 'iframe', 'embed', 'object', 'audio', 'video', 'canvas', 'handler', 'listener', 'set', 'animate', 'animatemotion', 'animatetransform', 'animatecolor', 'discard'];

/**
 * Remove active/external content from an SVG. The sanitised SVG is only ever
 * rasterised to PNG (never served as SVG), which is a second layer of defence.
 */
export function sanitizeSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) {
    throw new LogoError('The SVG file could not be parsed.', 'SVG_INVALID');
  }
  const removed = [];
  const walk = (el) => {
    for (const child of Array.from(el.children)) {
      const name = child.localName.toLowerCase();
      if (SVG_FORBIDDEN_ELEMENTS.includes(name)) { removed.push(name); child.remove(); continue; }
      for (const attr of Array.from(child.attributes)) {
        const n = attr.name.toLowerCase(); const v = attr.value.trim().toLowerCase();
        if (n.startsWith('on')) { removed.push(`@${n}`); child.removeAttribute(attr.name); continue; }
        if ((n === 'href' || n === 'xlink:href' || n.endsWith(':href')) && !v.startsWith('#')) { removed.push(`@${n}`); child.removeAttribute(attr.name); continue; }
        if (n === 'style' && /url\s*\(\s*['"]?(?!#)|expression|javascript:|@import/i.test(attr.value)) { removed.push('@style'); child.removeAttribute(attr.name); }
      }
      if (name === 'style' && /@import|url\s*\(\s*['"]?(?!#)|javascript:/i.test(child.textContent || '')) { removed.push('style-block'); child.remove(); continue; }
      walk(child);
    }
  };
  for (const attr of Array.from(root.attributes)) {
    const n = attr.name.toLowerCase();
    if (n.startsWith('on')) { removed.push(`@${n}`); root.removeAttribute(attr.name); }
  }
  walk(root);
  if (!root.getAttribute('viewBox')) {
    const w = parseFloat(root.getAttribute('width')); const h = parseFloat(root.getAttribute('height'));
    if (w > 0 && h > 0) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
    else throw new LogoError('The SVG has no size (viewBox or width/height).', 'SVG_NO_SIZE');
  }
  // Give it a concrete raster size for decoding.
  const vb = root.getAttribute('viewBox').split(/[\s,]+/).map(Number);
  const aspect = vb[2] > 0 && vb[3] > 0 ? vb[2] / vb[3] : 1;
  root.setAttribute('width', String(Math.round(aspect >= 1 ? 1024 : 1024 * aspect)));
  root.setAttribute('height', String(Math.round(aspect >= 1 ? 1024 / aspect : 1024)));
  return { svg: new XMLSerializer().serializeToString(root), removed };
}

function hasMeaningfulTransparency(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  let transparent = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) transparent++;
  return transparent / (w * h) > 0.02;
}

/** Bounding box of "ink" (non-transparent, or not matching the corner background for opaque images). */
function contentBounds(ctx, w, h, transparent) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const bg = [d[0], d[1], d[2]];
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const ink = transparent ? d[i + 3] > 12 : Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 36;
    if (ink) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Ink mask for the Monochrome mode (black ink on transparent, tinted at render time).
 *  • transparent logos: alpha × darkness, so light details inside the logo (white text on a
 *    dark block) stay knocked out instead of becoming a solid silhouette; a logo that is
 *    almost entirely light (a white logo made for dark backgrounds) falls back to its alpha;
 *  • opaque logos (JPG…): alpha from the colour distance to the logo's own background colour.
 */
function buildInkMask(src, transparent) {
  const n = src.width; const m = makeCanvas(n, n);
  const ctx = m.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, n, n); const d = img.data;
  const bg = [d[0], d[1], d[2]];
  const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
  const alpha = new Uint8ClampedArray(d.length / 4); const ink = new Uint8ClampedArray(d.length / 4);
  let alphaSum = 0; let inkSum = 0;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    if (transparent) {
      const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      alpha[j] = d[i + 3]; ink[j] = clamp(d[i + 3] * Math.max(0, Math.min(1, (0.9 - lum) / 0.35)));
    } else {
      const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
      alpha[j] = 255; ink[j] = clamp(((dist - 24) / 96) * 255);
    }
    alphaSum += alpha[j]; inkSum += ink[j];
  }
  const useAlpha = transparent && inkSum < alphaSum * 0.25;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = useAlpha ? alpha[j] : ink[j]; }
  ctx.putImageData(img, 0, 0);
  return m;
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new LogoError('Could not encode image', 'ENCODE_FAILED'))), type, quality));
}

/**
 * Validate and normalise an uploaded business logo.
 * @param {File|Blob} file
 * @returns {Promise<{blob:Blob, maskBlob:Blob, thumbnailBlob:Blob, metadata:object, previewUrl:string}>}
 */
export async function prepareBusinessLogo(file) {
  const cfg = getQrModuleConfig().upload;
  if (!file || typeof file.size !== 'number') throw new LogoError('No file selected.', 'NO_FILE');
  if (file.size === 0) throw new LogoError('The file is empty.', 'EMPTY_FILE');
  if (file.size > cfg.maxBytes) throw new LogoError(`The file is too large (max ${Math.round(cfg.maxBytes / 1024 / 1024)} MB).`, 'FILE_TOO_LARGE');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (!sniffed || !cfg.acceptedMimeTypes.includes(sniffed)) throw new LogoError('Unsupported file type. Use PNG, JPG, WEBP or SVG.', 'UNSUPPORTED_TYPE');
  const declared = (file.type || '').toLowerCase();
  if (declared && declared !== sniffed && !(declared === 'image/jpg' && sniffed === 'image/jpeg')) {
    throw new LogoError(`The file content (${sniffed}) does not match its declared type (${declared}).`, 'MIME_MISMATCH');
  }
  let sourceUrl; let sanitizedRemoved = [];
  if (sniffed === 'image/svg+xml') {
    const { svg, removed } = sanitizeSvg(new TextDecoder().decode(bytes));
    sanitizedRemoved = removed;
    sourceUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  } else {
    sourceUrl = URL.createObjectURL(new Blob([bytes], { type: sniffed }));
  }
  let img;
  try {
    img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new LogoError('The image is corrupt or cannot be decoded.', 'CORRUPT_IMAGE'));
      i.src = sourceUrl;
    });
    if (img.decode) await img.decode().catch(() => { throw new LogoError('The image is corrupt or cannot be decoded.', 'CORRUPT_IMAGE'); });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
  const w = img.naturalWidth; const h = img.naturalHeight;
  if (!w || !h) throw new LogoError('The image is corrupt or has no dimensions.', 'CORRUPT_IMAGE');
  if (sniffed !== 'image/svg+xml') {
    if (Math.min(w, h) < cfg.minDimension) throw new LogoError(`The image is too small (min ${cfg.minDimension}px on the short side).`, 'TOO_SMALL');
    if (Math.max(w, h) > cfg.maxDimension || w * h > cfg.maxPixels) throw new LogoError(`The image is too large (max ${cfg.maxDimension}px).`, 'TOO_LARGE_DIMENSIONS');
  }
  // Work canvas (bounded) → trim empty margins → square with padding.
  const workMax = 1024; const k = Math.min(1, workMax / Math.max(w, h));
  const ww = Math.max(1, Math.round(w * k)); const wh = Math.max(1, Math.round(h * k));
  const work = makeCanvas(ww, wh);
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(img, 0, 0, ww, wh);
  const transparent = hasMeaningfulTransparency(wctx, ww, wh);
  const bounds = contentBounds(wctx, ww, wh, transparent) || { x: 0, y: 0, w: ww, h: wh };
  const out = cfg.optimizedSize;
  const pad = Math.round(out * 0.06);
  const inner = out - pad * 2;
  const s = Math.min(inner / bounds.w, inner / bounds.h);
  const dw = bounds.w * s; const dh = bounds.h * s;
  const optimized = makeCanvas(out, out);
  const octx = optimized.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  if (!transparent) { // opaque logos keep their own background colour, squared
    const bgPixel = wctx.getImageData(0, 0, 1, 1).data;
    octx.fillStyle = `rgb(${bgPixel[0]},${bgPixel[1]},${bgPixel[2]})`; octx.fillRect(0, 0, out, out);
  }
  octx.drawImage(work, bounds.x, bounds.y, bounds.w, bounds.h, (out - dw) / 2, (out - dh) / 2, dw, dh);
  const thumb = makeCanvas(cfg.thumbnailSize, cfg.thumbnailSize);
  const tctx = thumb.getContext('2d'); tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(optimized, 0, 0, cfg.thumbnailSize, cfg.thumbnailSize);
  const mask = buildInkMask(optimized, transparent);
  const [blob, maskBlob, thumbnailBlob] = await Promise.all([canvasToBlob(optimized), canvasToBlob(mask), canvasToBlob(thumb)]);
  return {
    blob,
    maskBlob,
    thumbnailBlob,
    previewUrl: optimized.toDataURL('image/png'),
    metadata: {
      mimeType: 'image/png',
      width: out, height: out,
      bytes: blob.size,
      hasTransparency: transparent,
      source: { name: file.name || null, mimeType: sniffed, width: w, height: h, bytes: file.size },
      sanitized: sanitizedRemoved,
    },
  };
}
