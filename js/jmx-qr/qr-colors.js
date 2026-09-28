/**
 * qr-colors.js — colour math used by the QR module (pure, no DOM).
 * HEX/RGB/HSV/HSL conversion, WCAG contrast, safe-shade suggestion and the
 * card accent-border derivation (calculateAccentBorder).
 */

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalise "#abc", "abc", "#AABBCC" → "#AABBCC". Returns null when invalid. */
export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(HEX_RE);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h.toUpperCase()}`;
}
export const isValidHex = (v) => normalizeHex(v) !== null;

export function hexToRgb(hex) {
  const n = normalizeHex(hex);
  if (!n) return null;
  return { r: parseInt(n.slice(1, 3), 16), g: parseInt(n.slice(3, 5), 16), b: parseInt(n.slice(5, 7), 16) };
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const to2 = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
export function rgbToHex({ r, g, b }) { return `#${to2(r)}${to2(g)}${to2(b)}`.toUpperCase(); }

/** h: 0..360, s,v: 0..1 */
export function rgbToHsv({ r, g, b }) {
  const R = r / 255; const G = g / 255; const B = b / 255;
  const max = Math.max(R, G, B); const min = Math.min(R, G, B); const d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6; else if (max === G) h = (B - R) / d + 2; else h = (R - G) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
export function hsvToRgb({ h, s, v }) {
  const c = v * s; const hh = ((h % 360) + 360) % 360 / 60; const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0; let g = 0; let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0]; else if (hh < 2) [r, g, b] = [x, c, 0]; else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c]; else if (hh < 5) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  const m = v - c;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
/** h: 0..360, s,l: 0..1 */
export function rgbToHsl({ r, g, b }) {
  const R = r / 255; const G = g / 255; const B = b / 255;
  const max = Math.max(R, G, B); const min = Math.min(R, G, B); const l = (max + min) / 2; const d = max - min;
  let h = 0; let s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === R) h = ((G - B) / d) % 6; else if (max === G) h = (B - R) / d + 2; else h = (R - G) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s, l };
}
export function hslToRgb({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s; const hh = ((h % 360) + 360) % 360 / 60; const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0; let g = 0; let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0]; else if (hh < 2) [r, g, b] = [x, c, 0]; else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c]; else if (hh < 5) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
export const hexToHsl = (hex) => rgbToHsl(hexToRgb(hex));
export const hslToHex = (hsl) => rgbToHex(hslToRgb(hsl));

/** WCAG 2.x relative luminance (0..1). */
export function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return NaN;
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}
/** WCAG contrast ratio 1..21 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a); const lb = relativeLuminance(b);
  if (Number.isNaN(la) || Number.isNaN(lb)) return NaN;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Darken (or lighten) `hex` keeping its hue until contrast against `against`
 * reaches `target`. Used for the "Use a safer shade" suggestion.
 */
export function adjustForContrast(hex, against, target = 4.5) {
  const n = normalizeHex(hex); const bg = normalizeHex(against);
  if (!n || !bg) return null;
  if (contrastRatio(n, bg) >= target) return n;
  const hsl = hexToHsl(n);
  const darken = relativeLuminance(bg) > 0.18;
  let lo = darken ? 0 : hsl.l; let hi = darken ? hsl.l : 1;
  let best = darken ? '#000000' : '#FFFFFF';
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const cand = hslToHex({ ...hsl, l: mid });
    if (contrastRatio(cand, bg) >= target) { best = cand; if (darken) lo = mid; else hi = mid; } else if (darken) hi = mid; else lo = mid;
  }
  return best;
}

export function mixHex(a, b, t) {
  const A = hexToRgb(a); const B = hexToRgb(b);
  return rgbToHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}
export function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
}

const NEUTRAL_ACCENT = Object.freeze({ primary: '#9AA3AF' });

function accentTone(hex) {
  const hsl = hexToHsl(hex);
  if (hsl.s < 0.1) {
    // Greys/black/white → a soft metallic silver/graphite, not a random hue.
    return { border: hslToHex({ h: hsl.h, s: 0.04, l: clamp(hsl.l, 0.52, 0.66) }), neutral: true, hsl };
  }
  return {
    border: hslToHex({ h: hsl.h, s: clamp(hsl.s * 1.08, 0.4, 0.86), l: clamp(hsl.l, 0.5, 0.62) }),
    neutral: false,
    hsl,
  };
}

/**
 * Derive a thin, premium accent frame for the white QR area from the card theme.
 * Same colour family as the theme, slightly brighter with a soft metallic highlight.
 * @param {{primary?:string, secondary?:string, accent?:string, surface?:string}|string|null} themeColors
 * @returns {{borderColor:string, highlightColor:string, secondaryBorderColor:string,
 *   shadowColor:string, gradient:string, cssVars:Record<string,string>, source:string}}
 */
export function calculateAccentBorder(themeColors) {
  const theme = typeof themeColors === 'string' ? { primary: themeColors } : (themeColors || {});
  const primary = normalizeHex(theme.primary) || normalizeHex(theme.accent) || normalizeHex(theme.secondary);
  const source = primary ? 'theme' : 'neutral-fallback';
  const base = accentTone(primary || NEUTRAL_ACCENT.primary);
  const secondaryHex = normalizeHex(theme.secondary);
  const second = secondaryHex && secondaryHex !== primary ? accentTone(secondaryHex) : null;

  const b = hexToHsl(base.border);
  const highlightColor = hslToHex({ h: b.h, s: base.neutral ? 0.05 : clamp(b.s * 0.85, 0.3, 0.8), l: clamp(b.l + 0.24, 0.72, 0.9) });
  const secondaryBorderColor = second ? second.border : hslToHex({ h: b.h, s: b.s, l: clamp(b.l - 0.08, 0.38, 0.55) });
  const shadowBase = hslToHex({ h: b.h, s: base.neutral ? 0.05 : clamp(b.s, 0.3, 0.7), l: 0.32 });
  const shadowColor = hexToRgba(shadowBase, 0.22);
  const gradient = `linear-gradient(135deg, ${base.border} 0%, ${highlightColor} 38%, ${base.border} 58%, ${secondaryBorderColor} 100%)`;
  return {
    borderColor: base.border,
    highlightColor,
    secondaryBorderColor,
    shadowColor,
    gradient,
    source,
    cssVars: {
      '--jmxqr-accent': base.border,
      '--jmxqr-accent-highlight': highlightColor,
      '--jmxqr-accent-secondary': secondaryBorderColor,
      '--jmxqr-accent-shadow': shadowColor,
      '--jmxqr-accent-gradient': gradient,
    },
  };
}
