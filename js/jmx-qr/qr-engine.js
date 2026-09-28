/**
 * qr-engine.js — turns a target URL + style into a render-ready QR model.
 *
 * Pure (no DOM): encodes with level H, computes the centre-logo safe zone and
 * guarantees the zone:
 *   • never touches finder patterns, separators, timing, format or version info;
 *   • never touches non-centre alignment patterns;
 *   • consumes at most `logoErrorBudget` of the correction capacity of EVERY
 *     Reed–Solomon block (computed exactly from the module→codeword map).
 * If the requested logo size breaks a rule it is shrunk; below minLogoScale the
 * logo is dropped (scan-ability always wins over decoration).
 */
import { encodeQr } from './qr-encoder.js';
import { getQrModuleConfig } from './qr-config.js';

class LRU {
  constructor(limit) { this.limit = limit; this.map = new Map(); }
  get(k) { if (!this.map.has(k)) return undefined; const v = this.map.get(k); this.map.delete(k); this.map.set(k, v); return v; }
  set(k, v) { this.map.set(k, v); if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value); return v; }
  clear() { this.map.clear(); }
}
const matrixCache = new LRU(32);
const layoutCache = new LRU(64);
export const engineStats = { encodes: 0, cacheHits: 0 };

export function clearQrCaches() { matrixCache.clear(); layoutCache.clear(); }

/** Encode (cached). */
export function getQrMatrix(text, ecc = 'H', minVersion = 1) {
  const key = `${ecc}\u0000${minVersion}\u0000${text}`;
  const hit = matrixCache.get(key);
  if (hit) { engineStats.cacheHits++; return hit; }
  engineStats.encodes++;
  return matrixCache.set(key, encodeQr(text, { ecc, minVersion }));
}

/** True if (row,col) is inside the alignment pattern at the exact symbol centre (versions ≥ 7). */
function isCenterAlignment(qr, row, col) {
  const pos = qr.alignmentPositions;
  if (pos.length < 3) return false;
  const c = (qr.size - 1) / 2;
  if (!pos.includes(c)) return false;
  return Math.abs(row - c) <= 2 && Math.abs(col - c) <= 2;
}

function clearedCells(size, plate, shape) {
  const center = size / 2;
  const half = plate / 2;
  const out = [];
  const lo = Math.max(0, Math.floor(center - half) - 1);
  const hi = Math.min(size - 1, Math.ceil(center + half) + 1);
  for (let r = lo; r <= hi; r++) {
    for (let c = lo; c <= hi; c++) {
      // nearest point of the cell [c,c+1]x[r,r+1] to the centre
      const nx = Math.max(c, Math.min(center, c + 1));
      const ny = Math.max(r, Math.min(center, r + 1));
      const dx = nx - center; const dy = ny - center;
      let inside;
      if (shape === 'circle') inside = dx * dx + dy * dy < (half - 0.02) ** 2;
      else inside = Math.abs(dx) < half - 0.02 && Math.abs(dy) < half - 0.02;
      if (inside) out.push(r * size + c);
    }
  }
  return out;
}

/** Evaluate one candidate logo size. */
export function evaluateLogoZone(qr, { scale, shape = 'circle', budget }) {
  const { size, functionMask, codewordIndex, codewordBlock, blocks } = qr;
  const logoModules = size * scale;
  const margin = Math.max(0.6, logoModules * 0.08);
  const plateModules = logoModules + margin * 2;
  const cells = clearedCells(size, plateModules, shape);
  let touchesFunction = false;
  let coversCenterAlignment = false;
  const damaged = new Set();
  for (const idx of cells) {
    const r = Math.floor(idx / size); const c = idx % size;
    if (functionMask[idx]) {
      if (isCenterAlignment(qr, r, c)) coversCenterAlignment = true; else touchesFunction = true;
    } else if (codewordIndex[idx] >= 0) {
      damaged.add(codewordIndex[idx]);
    }
  }
  const perBlock = new Array(blocks.numBlocks).fill(0);
  for (const cw of damaged) perBlock[codewordBlock[cw]]++;
  const correctable = Math.floor(blocks.eccLen / 2);
  const limit = Math.floor(correctable * budget);
  const worst = Math.max(...perBlock);
  return {
    scale, shape, logoModules, plateModules, clearedIndices: cells,
    touchesFunction, coversCenterAlignment,
    damagedCodewords: damaged.size, damagePerBlock: perBlock, correctablePerBlock: correctable,
    blockLimit: limit, worstBlockUsage: correctable ? worst / correctable : 1,
    ok: !touchesFunction && worst <= limit,
  };
}

/**
 * Find the largest safe logo zone ≤ requested scale.
 * @returns {null | ReturnType<typeof evaluateLogoZone> & {requestedScale:number, reduced:boolean}}
 */
export function computeLogoLayout(qr, opts = {}) {
  const cfg = getQrModuleConfig().qr;
  const requested = Math.min(opts.scale ?? cfg.logoScale, cfg.maxLogoScale);
  const min = opts.minScale ?? cfg.minLogoScale;
  const budget = opts.budget ?? cfg.logoErrorBudget;
  const shape = opts.shape === 'rounded' ? 'rounded' : 'circle';
  const key = `${qr.version}|${qr.mask}|${qr.ecc}|${qr.byteLength}|${requested}|${min}|${budget}|${shape}|${qr.modules.length}|${hashModules(qr)}`;
  const hit = layoutCache.get(key);
  if (hit !== undefined) return hit;
  let result = null;
  for (let s = requested; s >= min - 1e-9; s -= 0.005) {
    const ev = evaluateLogoZone(qr, { scale: s, shape, budget });
    if (ev.ok) { result = { ...ev, requestedScale: requested, reduced: s < requested - 1e-9 }; break; }
  }
  return layoutCache.set(key, result);
}
function hashModules(qr) {
  let h = 0; const m = qr.modules;
  for (let i = 0; i < m.length; i += 7) h = (h * 31 + m[i] + i) | 0;
  return h;
}

/**
 * Build the render model (pure).
 * @param {{targetUrl:string, errorCorrection?:string, quietZone?:number, minVersion?:number,
 *   logo?:{enabled:boolean, shape?:'circle'|'rounded', scale?:number}}} options
 */
export function buildQrModel(options) {
  const cfg = getQrModuleConfig().qr;
  const targetUrl = typeof options?.targetUrl === 'string' ? options.targetUrl.trim() : '';
  if (!targetUrl) {
    const err = new Error('Missing targetUrl: the QR destination must be provided by the host project.');
    err.code = 'MISSING_TARGET_URL';
    throw err;
  }
  const ecc = options.errorCorrection || cfg.errorCorrection;
  // Very small symbols (v1–v4) have few codewords per block, so a logo eats a large
  // share of their correction capacity. With a logo we encode at least version
  // `minVersionWithLogo` — same data, same URL, just a slightly denser grid.
  const wantsLogo = !!options.logo?.enabled;
  const minVersion = Math.max(options.minVersion || 1, wantsLogo ? (cfg.minVersionWithLogo || 1) : 1);
  const qr = getQrMatrix(targetUrl, ecc, Math.min(40, minVersion));
  const quietZone = Math.max(4, options.quietZone ?? cfg.quietZone);
  let layout = null;
  let logoDropped = false;
  if (wantsLogo) {
    layout = computeLogoLayout(qr, { shape: options.logo.shape, scale: options.logo.scale });
    if (!layout) logoDropped = true;
  }
  return {
    targetUrl,
    qr,
    quietZone,
    totalModules: qr.size + quietZone * 2,
    layout,
    logoDropped,
  };
}
