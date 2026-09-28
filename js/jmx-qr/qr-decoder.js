/**
 * qr-decoder.js — QR Code Model 2 decoder for a module grid (ISO/IEC 18004).
 *
 * Used to VERIFY every rendered card QR before it is shown: the grid is read
 * either from the rendered canvas pixels or from the model with the logo area
 * forced to worst-case values, then fully decoded (format info → unmask →
 * de-interleave → Reed–Solomon error correction → segment parsing). The result
 * must equal the card's target URL exactly, otherwise a safer QR is used.
 *
 * Pure JS, no DOM. Works in browsers and Node.
 */
import { getFunctionMask, getBlockLayout, getNumRawDataModules, QR_MASKS, QR_ECC_FORMAT_BITS } from './qr-encoder.js';

// ---------------------------------------------------------------- GF(256), primitive 0x11D
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
const div = (a, b) => { if (b === 0) throw new Error('div0'); return a === 0 ? 0 : EXP[(LOG[a] + 255 - LOG[b]) % 255]; };
const pow = (x, p) => EXP[(((LOG[x] * p) % 255) + 255) % 255];
const inv = (x) => EXP[255 - LOG[x]];
const polyScale = (p, x) => p.map((c) => mul(c, x));
function polyAdd(p, q) {
  const r = new Array(Math.max(p.length, q.length)).fill(0);
  for (let i = 0; i < p.length; i++) r[i + r.length - p.length] = p[i];
  for (let i = 0; i < q.length; i++) r[i + r.length - q.length] ^= q[i];
  return r;
}
function polyMul(p, q) {
  const r = new Array(p.length + q.length - 1).fill(0);
  for (let j = 0; j < q.length; j++) for (let i = 0; i < p.length; i++) r[i + j] ^= mul(p[i], q[j]);
  return r;
}
function polyEval(p, x) { let y = p[0]; for (let i = 1; i < p.length; i++) y = mul(y, x) ^ p[i]; return y; }
function polyDiv(dividend, divisor) {
  const out = dividend.slice();
  for (let i = 0; i < dividend.length - (divisor.length - 1); i++) {
    const coef = out[i];
    if (coef !== 0) for (let j = 1; j < divisor.length; j++) if (divisor[j] !== 0) out[i + j] ^= mul(divisor[j], coef);
  }
  const sep = out.length - (divisor.length - 1);
  return [out.slice(0, sep), out.slice(sep)];
}

/** Reed–Solomon decode (generator roots α^0..α^(nsym-1), as used by QR). Returns corrected codeword array or throws. */
export function rsDecode(msg, nsym) {
  const synd = [0];
  for (let i = 0; i < nsym; i++) synd.push(polyEval(msg, pow(2, i)));
  if (synd.every((s) => s === 0)) return { data: msg.slice(), corrected: 0 };
  // Berlekamp–Massey
  let errLoc = [1]; let oldLoc = [1];
  const shift = synd.length - nsym;
  for (let i = 0; i < nsym; i++) {
    const K = i + shift;
    let delta = synd[K];
    for (let j = 1; j < errLoc.length; j++) delta ^= mul(errLoc[errLoc.length - (j + 1)], synd[K - j]);
    oldLoc = oldLoc.concat([0]);
    if (delta !== 0) {
      if (oldLoc.length > errLoc.length) {
        const newLoc = polyScale(oldLoc, delta);
        oldLoc = polyScale(errLoc, inv(delta));
        errLoc = newLoc;
      }
      errLoc = polyAdd(errLoc, polyScale(oldLoc, delta));
    }
  }
  while (errLoc.length && errLoc[0] === 0) errLoc.shift();
  const errs = errLoc.length - 1;
  if (errs * 2 > nsym) throw new Error('Too many errors');
  // Chien search
  const rev = errLoc.slice().reverse();
  const errPos = [];
  for (let i = 0; i < msg.length; i++) if (polyEval(rev, pow(2, i)) === 0) errPos.push(msg.length - 1 - i);
  if (errPos.length !== errs) throw new Error('Could not locate errors');
  // Forney
  const coefPos = errPos.map((p) => msg.length - 1 - p);
  let eLoc = [1];
  for (const i of coefPos) eLoc = polyMul(eLoc, polyAdd([1], [pow(2, i), 0]));
  const [, rem] = polyDiv(polyMul(synd.slice().reverse(), eLoc), [1].concat(new Array(eLoc.length).fill(0)));
  const errEval = rem.slice().reverse();
  const X = coefPos.map((c) => pow(2, -(255 - c)));
  const E = new Array(msg.length).fill(0);
  for (let i = 0; i < X.length; i++) {
    const XiInv = inv(X[i]);
    let prime = 1;
    for (let j = 0; j < X.length; j++) if (j !== i) prime = mul(prime, 1 ^ mul(XiInv, X[j]));
    let y = polyEval(errEval.slice().reverse(), XiInv);
    y = mul(pow(X[i], 1), y);
    if (prime === 0) throw new Error('Forney failure');
    E[errPos[i]] = div(y, prime);
  }
  const fixed = polyAdd(msg, E);
  for (let i = 0; i < nsym; i++) if (polyEval(fixed, pow(2, i)) !== 0) throw new Error('Correction failed');
  return { data: fixed, corrected: errs };
}

// ---------------------------------------------------------------- format information
const FORMATS = [];
for (const ecc of ['L', 'M', 'Q', 'H']) for (let mask = 0; mask < 8; mask++) {
  const d = (QR_ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = d; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  FORMATS.push({ ecc, mask, bits: ((d << 10) | rem) ^ 0x5412 });
}
const popcount = (x) => { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };
function readFormat(grid, size) {
  const at = (x, y) => grid[y * size + x] ? 1 : 0;
  let a = 0; let b = 0;
  for (let i = 0; i <= 5; i++) a |= at(8, i) << i;
  a |= at(8, 7) << 6; a |= at(8, 8) << 7; a |= at(7, 8) << 8;
  for (let i = 9; i < 15; i++) a |= at(14 - i, 8) << i;
  for (let i = 0; i < 8; i++) b |= at(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) b |= at(8, size - 15 + i) << i;
  let best = null; let bestD = 99;
  for (const f of FORMATS) {
    const d = Math.min(popcount(f.bits ^ a), popcount(f.bits ^ b));
    if (d < bestD) { bestD = d; best = f; }
  }
  if (bestD > 3) throw new Error('Unreadable format information');
  return best;
}

// ---------------------------------------------------------------- bitstream parsing
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
function parseSegments(bytes, version) {
  let pos = 0;
  const bits = bytes.length * 8;
  const read = (n) => { let v = 0; for (let i = 0; i < n; i++) { const b = pos + i; v = (v << 1) | ((bytes[b >>> 3] >>> (7 - (b & 7))) & 1); } pos += n; return v; };
  const cc = (mode) => { const t = version <= 9 ? 0 : version <= 26 ? 1 : 2; return { 1: [10, 12, 14], 2: [9, 11, 13], 4: [8, 16, 16] }[mode][t]; };
  const out = [];
  while (pos + 4 <= bits) {
    const mode = read(4);
    if (mode === 0) break;
    if (mode === 7) { read(8); continue; } // ECI (single byte designator)
    if (mode === 4) {
      const n = read(cc(4)); const arr = [];
      for (let i = 0; i < n; i++) arr.push(read(8));
      out.push(...arr);
    } else if (mode === 2) {
      let n = read(cc(2)); let s = '';
      while (n >= 2) { const v = read(11); s += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; n -= 2; }
      if (n === 1) s += ALNUM[read(6)];
      out.push(...new TextEncoder().encode(s));
    } else if (mode === 1) {
      let n = read(cc(1)); let s = '';
      while (n >= 3) { s += String(read(10)).padStart(3, '0'); n -= 3; }
      if (n === 2) s += String(read(7)).padStart(2, '0'); else if (n === 1) s += String(read(4));
      out.push(...new TextEncoder().encode(s));
    } else {
      throw new Error(`Unsupported mode ${mode}`);
    }
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(out));
}

/**
 * Decode a square module grid (1 = dark).
 * @param {ArrayLike<number>} grid  size*size, row-major
 * @returns {{text:string, version:number, ecc:string, mask:number, correctedCodewords:number}}
 */
export function decodeQrGrid(grid, size) {
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 40) throw new Error('Invalid grid size');
  const { ecc, mask } = readFormat(grid, size);
  const fn = getFunctionMask(version);
  const m = QR_MASKS[mask];
  const layout = getBlockLayout(version, ecc);
  const raw = layout.rawCodewords;
  const codewords = new Array(raw).fill(0);
  let i = 0;
  const total = raw * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j; const upward = ((right + 1) & 2) === 0; const y = upward ? size - 1 - vert : vert;
        const idx = y * size + x;
        if (fn[idx]) continue;
        if (i < total) {
          const bit = (grid[idx] ? 1 : 0) ^ (m(x, y) ? 1 : 0);
          if (bit) codewords[i >>> 3] |= 1 << (7 - (i & 7));
        }
        i++;
      }
    }
  }
  if (i !== getNumRawDataModules(version)) throw new Error('Placement mismatch');
  const { numBlocks, eccLen, numShortBlocks, shortBlockLen } = layout;
  const blocks = Array.from({ length: numBlocks }, () => new Array(shortBlockLen + 1).fill(0));
  let k = 0;
  for (let c = 0; c <= shortBlockLen; c++) for (let b = 0; b < numBlocks; b++) {
    if (c !== shortBlockLen - eccLen || b >= numShortBlocks) blocks[b][c] = codewords[k++];
  }
  const data = [];
  let corrected = 0;
  blocks.forEach((blk, b) => {
    const full = b < numShortBlocks ? blk.slice(0, shortBlockLen - eccLen).concat(blk.slice(shortBlockLen - eccLen + 1)) : blk;
    const res = rsDecode(full, eccLen);
    corrected += res.corrected;
    data.push(...res.data.slice(0, full.length - eccLen));
  });
  return { text: parseSegments(data, version), version, ecc, mask, correctedCodewords: corrected };
}

/** Safe wrapper: returns the decoded text or null. */
export function tryDecodeQrGrid(grid, size) {
  try { return decodeQrGrid(grid, size); } catch { return null; }
}
