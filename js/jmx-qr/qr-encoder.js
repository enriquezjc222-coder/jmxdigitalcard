/**
 * qr-encoder.js — Dependency-free QR Code Model 2 encoder (ISO/IEC 18004).
 *
 * Why a built-in encoder: the logo safe-zone logic needs information that
 * generic QR libraries do not expose — which modules are function patterns and
 * which error-correction block every data module belongs to. With that we can
 * compute *exactly* how many codewords per block a centre logo destroys and
 * keep it inside a conservative share of the level-H correction capacity.
 *
 * Scope: byte mode (UTF-8), versions 1–40, EC levels L/M/Q/H, automatic or
 * forced mask. Output is a plain object (no DOM), usable in browsers and Node.
 * Verified in tests/decode against OpenCV's reference encoder (bit-identical
 * matrices) and two independent decoders.
 */

export const ECC = Object.freeze({ L: 'L', M: 'M', Q: 'Q', H: 'H' });

const ECC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
const ECC_INDEX = { L: 0, M: 1, Q: 2, H: 3 };

// Error-correction codewords per block, index [ecc][version]. (ISO 18004 Table 9)
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
// Number of error-correction blocks, index [ecc][version].
const NUM_EC_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

export class QrEncodeError extends Error {
  constructor(message, code) { super(message); this.name = 'QrEncodeError'; this.code = code; }
}

/** Total data + EC bits available in a symbol of this version (excludes function patterns). */
export function getNumRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

export function getNumDataCodewords(ver, ecc) {
  const e = ECC_INDEX[ecc];
  return Math.floor(getNumRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[e][ver] * NUM_EC_BLOCKS[e][ver];
}

export function getBlockLayout(ver, ecc) {
  const e = ECC_INDEX[ecc];
  const numBlocks = NUM_EC_BLOCKS[e][ver];
  const eccLen = ECC_CODEWORDS_PER_BLOCK[e][ver];
  const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  return { numBlocks, eccLen, rawCodewords, numShortBlocks, shortBlockLen };
}

export function getAlignmentPatternPositions(ver) {
  if (ver === 1) return [];
  const size = ver * 4 + 17;
  const numAlign = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

// ---------- Reed–Solomon over GF(2^8), primitive polynomial 0x11D ----------
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
const divisorCache = new Map();
function rsDivisor(degree) {
  if (divisorCache.has(degree)) return divisorCache.get(degree);
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  divisorCache.set(degree, result);
  return result;
}
function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

// ---------- helpers ----------
export function utf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
  return Array.from(Buffer.from(text, 'utf8')); // eslint-disable-line no-undef
}
const getBit = (x, i) => ((x >>> i) & 1) !== 0;

function charCountBits(ver) { return ver <= 9 ? 8 : 16; } // byte mode

/** Smallest version (>= minVersion) that fits `byteLength` bytes at `ecc`, or -1. */
export function pickVersion(byteLength, ecc, minVersion = 1, maxVersion = 40) {
  for (let v = minVersion; v <= maxVersion; v++) {
    const capacityBits = getNumDataCodewords(v, ecc) * 8;
    const used = 4 + charCountBits(v) + byteLength * 8;
    if (used <= capacityBits) return v;
  }
  return -1;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/**
 * Encode text into a QR matrix.
 * @param {string} text
 * @param {{ecc?: 'L'|'M'|'Q'|'H', minVersion?: number, maxVersion?: number, mask?: number}} [opts]
 * @returns {{version:number, size:number, ecc:string, mask:number,
 *   modules:Uint8Array, functionMask:Uint8Array, codewordIndex:Int16Array,
 *   codewordBlock:Int16Array, blocks:{numBlocks:number, eccLen:number, dataLens:number[]},
 *   alignmentPositions:number[], isDark:(row:number,col:number)=>boolean}}
 *   `modules[row*size+col]` = 1 dark. `functionMask` = 1 for function-pattern modules.
 *   `codewordIndex` = interleaved codeword index for data modules (-1 function/remainder).
 *   `codewordBlock[i]` = RS block that interleaved codeword i belongs to.
 */
export function encodeQr(text, opts = {}) {
  if (typeof text !== 'string' || text.length === 0) throw new QrEncodeError('QR text must be a non-empty string', 'EMPTY_TEXT');
  const ecc = opts.ecc || 'H';
  if (!(ecc in ECC_INDEX)) throw new QrEncodeError(`Unknown error correction level: ${ecc}`, 'BAD_ECC');
  const bytes = utf8Bytes(text);
  const version = pickVersion(bytes.length, ecc, opts.minVersion || 1, opts.maxVersion || 40);
  if (version < 0) throw new QrEncodeError(`Text too long for a QR code at level ${ecc} (${bytes.length} bytes)`, 'TOO_LONG');
  const size = version * 4 + 17;

  // ---- data bit stream ----
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, charCountBits(version));
  for (const b of bytes) push(b, 8);
  const capacityBits = getNumDataCodewords(version, ecc) * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    data.push(v);
  }

  // ---- error correction + interleave ----
  const layout = getBlockLayout(version, ecc);
  const { numBlocks, eccLen, numShortBlocks, shortBlockLen } = layout;
  const div = rsDivisor(eccLen);
  const blocks = [];
  const dataLens = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - eccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    dataLens.push(dat.length);
    const ecw = rsRemainder(dat, div);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecw));
  }
  const codewords = [];
  const owner = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i !== shortBlockLen - eccLen || j >= numShortBlocks) { codewords.push(blocks[j][i]); owner.push(j); }
    }
  }

  // ---- matrix + function patterns ----
  const modules = new Uint8Array(size * size);
  const fn = new Uint8Array(size * size);
  const set = (x, y, dark) => { modules[y * size + x] = dark ? 1 : 0; fn[y * size + x] = 1; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)); const x = cx + dx; const y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const align = getAlignmentPatternPositions(version);
  const na = align.length;
  for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  const drawFormat = (mask) => {
    const d = (ECC_FORMAT_BITS[ecc] << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, getBit(b, i));
    set(8, 7, getBit(b, 6)); set(8, 8, getBit(b, 7)); set(7, 8, getBit(b, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(b, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, getBit(b, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, getBit(b, i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(b, i); const a = size - 11 + (i % 3); const c = Math.floor(i / 3);
      set(a, c, bit); set(c, a, bit);
    }
  }

  // ---- place data (zig-zag) and record codeword map ----
  const codewordIndex = new Int16Array(size * size).fill(-1);
  let i = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        const idx = y * size + x;
        if (!fn[idx]) {
          if (i < totalBits) {
            modules[idx] = getBit(codewords[i >>> 3], 7 - (i & 7)) ? 1 : 0;
            codewordIndex[idx] = i >>> 3;
          }
          i++;
        }
      }
    }
  }
  if (i !== getNumRawDataModules(version)) throw new QrEncodeError('Internal placement mismatch', 'INTERNAL');

  // ---- masking ----
  const applyMask = (m) => {
    const f = MASKS[m];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (!fn[idx] && f(x, y)) modules[idx] ^= 1;
    }
  };
  let mask = Number.isInteger(opts.mask) && opts.mask >= 0 && opts.mask <= 7 ? opts.mask : -1;
  if (mask === -1) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const p = penaltyScore(modules, size);
      if (p < best) { best = p; mask = m; }
      applyMask(m);
    }
  }
  applyMask(mask); drawFormat(mask);

  const codewordBlock = Int16Array.from(owner);
  return {
    version, size, ecc, mask, modules, functionMask: fn, codewordIndex, codewordBlock,
    blocks: { numBlocks, eccLen, dataLens },
    alignmentPositions: align,
    byteLength: bytes.length,
    isDark: (row, col) => modules[row * size + col] === 1,
  };
}

/** Standard ISO 18004 mask penalty (N1..N4). */
export function penaltyScore(m, size) {
  let score = 0;
  const at = (x, y) => m[y * size + x];
  const lineScore = (get) => {
    let s = 0;
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b <= size; b++) {
        if (b < size && get(a, b) === get(a, b - 1)) run++;
        else { if (run >= 5) s += 3 + (run - 5); run = 1; }
      }
      // N3: 1:1:3:1:1 finder-like pattern with 4 light modules on one side (outside = light)
      for (let b = -4; b < size; b++) {
        const v = (k) => (k < 0 || k >= size ? 0 : get(a, k));
        if (v(b) === 1 && v(b + 1) === 0 && v(b + 2) === 1 && v(b + 3) === 1 && v(b + 4) === 1 && v(b + 5) === 0 && v(b + 6) === 1) {
          const before = v(b - 1) === 0 && v(b - 2) === 0 && v(b - 3) === 0 && v(b - 4) === 0;
          const after = v(b + 7) === 0 && v(b + 8) === 0 && v(b + 9) === 0 && v(b + 10) === 0;
          if (before || after) s += 40;
        }
      }
    }
    return s;
  };
  score += lineScore((a, b) => at(b, a)); // rows
  score += lineScore((a, b) => at(a, b)); // columns
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = at(x, y);
    if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3;
  }
  let dark = 0; for (let i = 0; i < m.length; i++) dark += m[i];
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += Math.max(0, k) * 10;
  return score;
}

const functionMaskCache = new Map();
/** Function-pattern mask of a version (independent of data, ECC level and mask). */
export function getFunctionMask(version) {
  if (!functionMaskCache.has(version)) functionMaskCache.set(version, encodeQr('0', { ecc: 'L', minVersion: version, mask: 0 }).functionMask);
  return functionMaskCache.get(version);
}
export { MASKS as QR_MASKS, ECC_FORMAT_BITS as QR_ECC_FORMAT_BITS };
