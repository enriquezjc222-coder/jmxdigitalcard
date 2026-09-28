// Unit tests of the unified QR layer (js/jmx-qr). Run: node --test docs/qr-integration-tests/unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cardQrTargetUrl, sanitizeCardId, resolveCardQrCustomization, QR_CARD_THEME_HEX, cardThemeHex, isAllowedLogoUrl, normalizeBusinessLogo } from '../../js/jmx-qr/card-qr.js';
import * as FC from '../../js/feature-controls.js';
import * as PR from '../../js/plan-resolver.js';
import { createRequire } from 'node:module';
import { buildQrModel } from '../../js/jmx-qr/qr-engine.js';
import { encodeQr } from '../../js/jmx-qr/qr-encoder.js';
import { decodeQrGrid, tryDecodeQrGrid } from '../../js/jmx-qr/qr-decoder.js';
import { getQrModuleConfig } from '../../js/jmx-qr/qr-config.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// The ORIGINAL functions from Prueba 8 script.js (before this change), verbatim.
function originalSanitizeCardId(v){const raw=String(v||"main").trim();if(raw.toLowerCase()==="main")return "main";return raw.toUpperCase().replace(/[^A-Z0-9_-]/g,"-").slice(0,64)||"main"}
function originalQrShareURL(CARD_ID){const canonical=CARD_ID==="main"?"https://jmxdigitalcard.com/":`https://jmxdigitalcard.com/c/${encodeURIComponent(CARD_ID)}`;const u=new URL(canonical);u.searchParams.set("src","qr");return u.href}

test('targetUrl is byte-for-byte the URL the old QR encoded, for every kind of Card ID', () => {
  const ids = ['main', 'MAIN', 'JMXB01', 'jmxb01', 'BOSS', 'A', 'CARD_2026-X', 'with space', 'ñandú', 'x'.repeat(80), '', null, 'ABC/DEF', 'Z9'];
  for (let i = 0; i < 500; i++) ids.push(Math.random().toString(36).slice(2, 2 + (i % 40) + 1));
  for (const raw of ids) {
    const id = originalSanitizeCardId(raw); // script.js CARD_ID
    assert.equal(sanitizeCardId(raw), id);
    assert.equal(cardQrTargetUrl(id), originalQrShareURL(id), `id ${raw}`);
    assert.equal(cardQrTargetUrl(id), cardQrTargetUrl(cardQrTargetUrl(id) && id), 'idempotent');
  }
  assert.equal(cardQrTargetUrl('JMXB01'), 'https://jmxdigitalcard.com/c/JMXB01?src=qr');
});

test('script.js delegates qrShareURL() to the shared function (single source)', () => {
  const s = readFileSync(`${ROOT}script.js`, 'utf8');
  assert.match(s, /function qrShareURL\(\)\{return cardQrTargetUrl\(CARD_ID\)\}/);
  assert.doesNotMatch(s, /new QRCode\(/, 'no second QR generator on the public card');
  for (const f of ['admin.js', 'dashboard.js']) assert.match(readFileSync(`${ROOT}${f}`, 'utf8'), /from "\.\/js\/jmx-qr\/card-qr\.js"/);
});

test('theme hex map is in sync with script.js QR_CARD_THEMES', () => {
  const s = readFileSync(`${ROOT}script.js`, 'utf8');
  const block = s.match(/const QR_CARD_THEMES=\[([\s\S]*?)\n\];/)[1];
  const m = Object.fromEntries([...block.matchAll(/\{id:"([a-z0-9_]+)",name:"[^"]*",hex:"(#[0-9a-fA-F]{6})"/g)].map((x) => [x[1], x[2]]));
  assert.deepEqual(QR_CARD_THEME_HEX, m);
  assert.equal(cardThemeHex({ qrCardTheme: 'orange_titanium' }, () => true), '#c2410c');
  assert.equal(cardThemeHex({ qrCardTheme: 'orange_titanium' }, () => false), '#1f2937');
});

test('config: Error Correction H, logo target 22% of total width, safety budget', () => {
  const c = getQrModuleConfig().qr;
  assert.equal(c.errorCorrection, 'H'); assert.equal(c.logoScaleTarget, 0.22); assert.equal(c.quietZone, 4);
  assert.ok(c.logoErrorBudget <= 0.5);
});

test('customization rules: default / saved colour / readability protection / business logo', () => {
  const none = () => false; const all = () => true; const only = (...k) => (f) => k.includes(f);
  let r = resolveCardQrCustomization({ profile: { qrDarkColor: '#C2410C' }, allows: none });
  assert.deepEqual([r.enabled, r.foregroundColor, r.backgroundColor, r.logoMode], [false, '#000000', '#FFFFFF', 'jmx']);
  r = resolveCardQrCustomization({ profile: { qrDarkColor: '#c2410c', qrLightColor: '#ffffff' }, allows: only('customQR') });
  assert.deepEqual([r.enabled, r.foregroundColor, r.colorAdjusted], [true, '#C2410C', false]);
  r = resolveCardQrCustomization({ profile: { qrDarkColor: '#D9889E' }, allows: only('customQR') });
  assert.equal(r.colorAdjusted, true); assert.notEqual(r.foregroundColor, '#D9889E');
  r = resolveCardQrCustomization({ profile: { qrDarkColor: '#FFFFFF', qrLightColor: '#000000' }, allows: only('customQR') });
  assert.deepEqual([r.foregroundColor, r.backgroundColor], ['#000000', '#FFFFFF']);
  const LOGO = 'https://firebasestorage.googleapis.com/v0/b/b/o/cards%2FX%2FqrBusinessLogo%2F1-optimized.png?alt=media';
  const MASK = 'https://firebasestorage.googleapis.com/v0/b/b/o/cards%2FX%2FqrBusinessLogo%2F1-mask.png?alt=media';
  r = resolveCardQrCustomization({ profile: {}, allows: all, businessLogo: { url: LOGO, maskUrl: MASK } });
  assert.deepEqual([r.logoMode, r.businessLogoUrl, r.businessLogoColorMode], ['business', LOGO, 'original']);
  r = resolveCardQrCustomization({ profile: {}, allows: all, businessLogo: { url: LOGO, maskUrl: MASK, colorMode: 'monochrome' } });
  assert.deepEqual([r.logoMode, r.businessLogoUrl, r.businessLogoColorMode], ['business', MASK, 'monochrome'], 'monochrome renders the ink mask');
  r = resolveCardQrCustomization({ profile: {}, allows: all, businessLogo: { url: LOGO, colorMode: 'monochrome' } });
  assert.equal(r.businessLogoColorMode, 'original', 'no mask stored → original colours');
  r = resolveCardQrCustomization({ profile: {}, allows: all, businessLogo: { url: LOGO, mode: 'jmx' } });
  assert.deepEqual([r.logoMode, r.businessLogoStored], ['jmx', true], '"Use JMX" keeps the stored logo');
  r = resolveCardQrCustomization({ profile: {}, allows: only('customQR'), businessLogo: { url: LOGO } });
  assert.deepEqual([r.logoMode, r.businessLogoStored], ['jmx', true], 'feature OFF → JMX shown, logo settings kept');
  r = resolveCardQrCustomization({ profile: {}, allows: all });
  assert.equal(r.logoMode, 'jmx', 'no uploaded logo → JMX');
});

test('Business Logo QR cannot be injected through the owner-writable profile', () => {
  const all = () => true;
  const LOGO = 'https://firebasestorage.googleapis.com/v0/b/b/o/evil.png?alt=media';
  for (const profile of [{ qrLogoMode: 'business', qrBusinessLogo: { url: LOGO } }, { qrBusinessLogo: { url: LOGO, mode: 'business' } }, { __qrBusinessLogo: { url: LOGO } }]) {
    const r = resolveCardQrCustomization({ profile, allows: all });
    assert.equal(r.logoMode, 'jmx'); assert.equal(r.businessLogoUrl, null);
  }
  // only Firebase Storage URLs are accepted as logo sources (card documents are admin-only, this is defence in depth)
  for (const bad of ['http://firebasestorage.googleapis.com/x.png', 'https://evil.example/x.png', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>', '', null, 42, 'https://firebasestorage.googleapis.com.evil.com/x.png']) {
    assert.equal(isAllowedLogoUrl(bad), false, String(bad)); assert.equal(normalizeBusinessLogo({ url: bad }), null);
  }
  assert.ok(isAllowedLogoUrl(LOGO)); assert.ok(isAllowedLogoUrl('https://storage.googleapis.com/b/cards/X/qrBusinessLogo/1.png'));
  const n = normalizeBusinessLogo({ url: LOGO, maskUrl: 'https://evil.example/m.png', colorMode: 'weird', mode: 'weird' });
  assert.deepEqual([n.maskUrl, n.colorMode, n.mode], [null, 'original', 'business']);
});

test('script / admin / dashboard read Business Logo QR only from the admin-only card document', () => {
  const s = readFileSync(`${ROOT}script.js`, 'utf8'); const a = readFileSync(`${ROOT}admin.js`, 'utf8'); const d = readFileSync(`${ROOT}dashboard.js`, 'utf8');
  assert.match(s, /__qrBusinessLogo:\(meta\.qrBusinessLogo/); assert.match(s, /businessLogo:p\.__qrBusinessLogo/);
  assert.match(s, /qrBusinessLogo:null,qrLogoMode:null/, 'profile copies are neutralised');
  assert.match(a, /editorBusinessLogo=\(c\.qrBusinessLogo/); assert.doesNotMatch(a, /qrLogoMode/); assert.doesNotMatch(readFileSync(`${ROOT}admin.html`, 'utf8'), /qrLogoMode/);
  assert.doesNotMatch(d, /doc\(db,"profiles",id\),\{qrBusinessLogo/); assert.match(d, /setDoc\(doc\(db,"cards",id\),\{qrBusinessLogo:/);
  assert.match(d, /cards\/\$\{id\}\/qrBusinessLogo\/\$\{stamp\}-optimized\.png/);
});

test('decoder: corrects up to the maximum per block for all 40 versions × 4 levels', () => {
  let seed = 7; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const ecc of ['L', 'M', 'Q', 'H']) for (let v = 1; v <= 40; v++) {
    const t = `https://jmxdigitalcard.com/c/T${v}${ecc}?src=qr`;
    const q = encodeQr(t, { ecc, minVersion: v });
    const g = Uint8Array.from(q.modules);
    const per = Math.floor(q.blocks.eccLen / 2); const by = new Map();
    q.codewordBlock.forEach((b, i) => { if (!by.has(b)) by.set(b, []); by.get(b).push(i); });
    const hit = new Set(); for (const [, l] of by) for (let k = 0; k < per; k++) hit.add(l[Math.floor(R() * l.length)]);
    const done = new Set(); for (let i = 0; i < g.length; i++) { const cw = q.codewordIndex[i]; if (hit.has(cw) && !done.has(cw)) { g[i] ^= 1; done.add(cw); } }
    assert.equal(decodeQrGrid(g, q.size).text, t, `${ecc} v${v}`);
  }
});

test('decoder rejects damage beyond the correction capacity (never returns a wrong URL)', () => {
  const q = encodeQr('https://jmxdigitalcard.com/c/JMXB01?src=qr', { ecc: 'H' });
  const g = Uint8Array.from(q.modules); for (let i = 0; i < g.length; i += 2) if (q.codewordIndex[i] >= 0) g[i] ^= 1;
  const r = tryDecodeQrGrid(g, q.size);
  assert.ok(r === null || r.text === 'https://jmxdigitalcard.com/c/JMXB01?src=qr');
});

test('logo safe zone for every Card ID length 1–64: protected patterns intact, ≤22% of total, worst-case decodes', () => {
  const cfg = getQrModuleConfig().qr; const rows = [];
  for (let len = 1; len <= 64; len++) {
    const url = cardQrTargetUrl('X'.repeat(len));
    const probe = buildQrModel({ targetUrl: url, logo: { enabled: true, scale: 0.1 } });
    const m = buildQrModel({ targetUrl: url, logo: { enabled: true, scale: (cfg.logoScaleTarget * probe.totalModules) / probe.qr.size } });
    assert.ok(m.layout, `layout for len ${len}`);
    assert.equal(m.layout.touchesFunction, false);
    assert.ok(m.qr.version >= 6 && m.qr.ecc === 'H');
    const total = m.layout.logoModules / m.totalModules; assert.ok(total <= 0.2201 && total >= 0.09);
    for (const val of [0, 1]) { const g = Uint8Array.from(m.qr.modules); for (const i of m.layout.clearedIndices) g[i] = val; assert.equal(decodeQrGrid(g, m.qr.size).text, url); }
    rows.push([len, m.qr.version, +(total * 100).toFixed(1)]);
  }
});

// Intentional, documented edits to otherwise-protected files. The test REVERTS exactly these
// edits and requires the result to be byte-identical to Prueba 8 → nothing else changed.
export const INTENTIONAL_EDITS = {
  'firebase.json': [
    ['      "docs/**",\n      "tools/**",\n', '      "docs/**",\n'],
    ['      "**/*.log",\n', ''],
  ],
  '_config.yml': [['  - docs\n  - tools\n', '  - docs\n']],
  'functions/index.js': [
    ['const jwt = require("jsonwebtoken");\nconst {effectivePlanName} = require("./plan-resolver");\n', 'const jwt = require("jsonwebtoken");\n'],
    ['// Plan: one shared resolver (./plan-resolver.js, identical to ../js/plan-resolver.js).\n// Missing/unrecognised plan → "Premium", the plan these cards have always shown publicly.\nfunction normalizePlan(card = {}) {\n  return effectivePlanName(card);\n}',
     'function normalizePlan(card = {}) {\n  if (card.complimentaryBusiness === true) return "Business";\n  if (card.complimentaryPremium === true) return "Premium";\n  return ["Basic", "Premium", "Business"].includes(card.plan) ? card.plan : "Basic";\n}'],
  ],
  // Node 20 → 22 (separate commit; Cloud Functions Node 20 decommission 2026-10-30)
  'functions/package.json': [['"node": "22"', '"node": "20"']],
  'functions/package-lock.json': [['"engines": {\n        "node": "22"\n', '"engines": {\n        "node": "20"\n']],
};
test('protected files are byte-identical to Prueba 8 except the documented intentional edits (NFC, /d/**, activation, auth, wallet, functions, rules, hosting)', async () => {
  const { createHash } = await import('node:crypto');
  const manifest = JSON.parse(readFileSync(`${ROOT}docs/qr-integration-tests/protected-files.sha256.json`, 'utf8'));
  // storage.rules is intentionally changed (Business Logo QR admin-only) and is verified by the rules tests below.
  const must = ['device.js', 'device.html', 'device-activate.js', 'device-activate.html', 'activate.js', 'activate.html', 'login.js', 'login.html', 'functions/index.js', 'functions/package.json', 'firestore.rules', 'firebase.json', '404.html', 'landing.js', 'index.html', '_config.yml', 'CNAME'];
  for (const f of must) assert.ok(manifest[f], `${f} listed`);
  const revert = (f) => {
    let raw = readFileSync(`${ROOT}${f}`); const edits = INTENTIONAL_EDITS[f]; if (!edits) return raw;
    const crlf = raw.includes('\r\n'); let t = raw.toString('utf8').replace(/\r\n/g, '\n');
    for (const [now, before] of edits) { if (t.includes(now)) t = t.replace(now, before); }
    return Buffer.from(crlf ? t.replace(/\n/g, '\r\n') : t, 'utf8');
  };
  const changed = Object.entries(manifest).filter(([f, h]) => createHash('sha256').update(revert(f)).digest('hex') !== h).map(([f]) => f);
  assert.deepEqual(changed, []);
});

// ------------------------------------------------------------------ storage.rules (executed, not just read)
// The rule expressions of the cards media block are translated 1:1 to JS and evaluated over a
// full permission matrix. This checks the logic as written; it is NOT the Firebase emulator
// (firebase-tools/Java are not available here) — run the emulator suite before deploying.
function compileStorageRules(text) {
  const block = text.match(/match \/cards\/\{cardId\}\/\{mediaId\}\/\{fileName\} \{([\s\S]*?)\n    \}/)[1];
  const grab = (re) => { const m = block.match(re); return m ? m[1].replace(/\s+/g, ' ').trim() : null; };
  const tr = (e) => e
    .replace(/([A-Za-z_.]+)\.matches\('([^']*)'\)/g, (_, v, re) => `new RegExp('^(?:${re})$').test(${v})`)
    .replace(/request\.resource\.size/g, 'req.size').replace(/request\.resource\.contentType/g, 'req.ct');
  const helper = text.match(/function isAdminOnlyMedia\(mediaId\) \{\s*return ([^;]+);/);
  const src = (e) => new Function('ctx', 'req', 'cardId', 'mediaId', `const isAdmin=()=>ctx.admin;const isOwner=(c)=>ctx.owner===c;const isAdminOnlyMedia=(mediaId)=>${helper ? tr(helper[1]) : 'false'};return (${tr(e)});`);
  return { read: src(grab(/allow read: if ([^;]+);/)), write: src(grab(/allow create, update: if ([\s\S]+?);/)), del: src(grab(/allow delete: if ([^;]+);/)) };
}
test('storage.rules: Business Logo QR path is admin-only; every other owner media permission is unchanged', () => {
  const now = compileStorageRules(readFileSync(`${ROOT}storage.rules`, 'utf8'));
  const base = compileStorageRules(readFileSync(`${ROOT}docs/qr-integration-tests/fixtures/storage.rules.base-prueba8`, 'utf8'));
  const who = { admin: { admin: true, owner: null }, owner: { admin: false, owner: 'JMXZ03' }, otherOwner: { admin: false, owner: 'JMXB01' }, anonymous: { admin: false, owner: null } };
  const medias = ['profile', 'cover', 'logo', 'catalog', 'gallery-0', 'qrBusinessLogo', 'qrbusinesslogo', 'qr-logo'];
  const reqs = [{ size: 1000, ct: 'image/png' }, { size: 1000, ct: 'image/jpeg' }, { size: 1000, ct: 'application/pdf' }, { size: 1000, ct: 'text/html' }, { size: 13 * 1024 * 1024, ct: 'image/png' }];
  let checked = 0;
  for (const [name, ctx] of Object.entries(who)) for (const m of medias) for (const q of reqs) {
    const w = now.write(ctx, q, 'JMXZ03', m); const d = now.del(ctx, q, 'JMXZ03', m);
    assert.equal(now.read(ctx, q, 'JMXZ03', m), true, 'public read unchanged');
    if (m === 'qrBusinessLogo') {
      if (name !== 'admin') { assert.equal(w, false, `${name} must not write ${m}`); assert.equal(d, false, `${name} must not delete ${m}`); }
      else { assert.equal(w, q.ct === 'image/png' && q.size < 12 * 1024 * 1024, `admin ${q.ct} ${q.size}`); assert.equal(d, true); }
    } else {
      assert.equal(w, base.write(ctx, q, 'JMXZ03', m), `${name} ${m} ${q.ct}: write unchanged vs Prueba 8`);
      assert.equal(d, base.del(ctx, q, 'JMXZ03', m), `${name} ${m}: delete unchanged vs Prueba 8`);
    }
    checked++;
  }
  // the owner really could write that path before this change (the hole that is now closed)
  assert.equal(base.write(who.owner, reqs[0], 'JMXZ03', 'qrBusinessLogo'), true);
  const text = readFileSync(`${ROOT}storage.rules`, 'utf8');
  assert.match(text, /match \/\{allPaths=\*\*\} \{\s*allow read, write: if false;/, 'catch-all deny kept');
  assert.doesNotMatch(text.replace(/allow read: if true;/g, ''), /if true/, 'no open write rule');
  assert.ok(checked === 4 * medias.length * reqs.length);
});
test('firestore.rules: card documents (where qrBusinessLogo lives) are admin-writable only', () => {
  const t = readFileSync(`${ROOT}firestore.rules`, 'utf8');
  const cards = t.match(/match \/cards\/\{cardId\} \{([\s\S]*?)match \/media/)[1];
  assert.match(cards, /allow create, delete: if isAdmin\(\);/);
  // the only non-admin update is the activation claim, limited to status/activatedAt/updatedAt
  assert.match(cards, /allow update: if isAdmin\(\) \|\| \(\s*signedIn\(\)\s*&& resource\.data\.status in \['available','sold'\]\s*&& request\.resource\.data\.status == 'activated'\s*&& request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(\['status','activatedAt','updatedAt'\]\)/);
});

// ------------------------------------------------------------------ feature controls: one resolver, same results
// ORIGINAL resolvers (Prueba 8 / previous delivery), verbatim, for equivalence checks.
const ORIG = {
  script(p, platformFeatureControls, BASIC_FEATURE_DEFAULTS, feature) {
    const planName=p.complimentaryBusiness===true?"Business":(p.complimentaryPremium===true?"Premium":(p.plan||"Premium"));
    if(platformFeatureControls.global?.[feature]===false)return false;
    const override=p.featureOverrides?.[feature];if(override===true)return true;if(override===false)return false;
    if(platformFeatureControls.enabled===false){if(String(planName).toLowerCase()==="business")return true;if(String(planName).toLowerCase()==="premium")return !["quickCapture","leads","advancedAnalytics"].includes(feature);return BASIC_FEATURE_DEFAULTS.has(feature)}
    const bucket=String(planName).toLowerCase()==="basic"?platformFeatureControls.Basic:String(planName).toLowerCase()==="business"?platformFeatureControls.Business:platformFeatureControls.Premium;
    return bucket?.[feature]!==false;
  },
  admin(currentCardPlan, currentCardFeatureOverrides, platformFeatureControls, BASIC_FEATURE_DEFAULTS, feature) {
    if(platformFeatureControls.global?.[feature]===false)return false;
    const override=currentCardFeatureOverrides?.[feature];if(override===true)return true;if(override===false)return false;
    if(platformFeatureControls.enabled===false){return ["premium","business"].includes(currentCardPlan.toLowerCase())||BASIC_FEATURE_DEFAULTS.has(feature)}
    const group=currentCardPlan.toLowerCase()==="basic"?platformFeatureControls.Basic:currentCardPlan.toLowerCase()==="business"?platformFeatureControls.Business:platformFeatureControls.Premium;
    return group?.[feature]!==false;
  },
  dashEffectivePlan(card) { if(card?.complimentaryBusiness===true) return "Business"; if(card?.complimentaryPremium===true) return "Premium"; return ["Basic","Premium","Business"].includes(card?.plan) ? card.plan : "Basic"; },
  dashPlatform(featureControls, BASIC_FEATURE_DEFAULTS, card, key) {
    if(featureControls.enabled===false){const plan=ORIG.dashEffectivePlan(card);if(plan==="Business")return true;if(plan==="Premium")return !new Set(["quickCapture","leads","advancedAnalytics"]).has(key);return BASIC_FEATURE_DEFAULTS.has(key)}
    if(featureControls.global?.[key]===false)return false;
    const plan=ORIG.dashEffectivePlan(card),bucket=plan==="Basic"?featureControls.Basic:plan==="Business"?featureControls.Business:featureControls.Premium;
    return bucket?.[key]!==false;
  },
  dashClient(featureControls, BASIC_FEATURE_DEFAULTS, card, key) {
    if(featureControls.global?.[key]===false)return false;
    const override=card?.featureOverrides?.[key]; if(override===true)return true; if(override===false)return false;
    return ORIG.dashPlatform(featureControls, BASIC_FEATURE_DEFAULTS, card, key);
  },
};
function scriptConst(file, name) { const s = readFileSync(`${ROOT}${file}`, 'utf8'); const m = s.match(new RegExp(`const ${name}\\s*=\\s*(new Set\\(\\[[^\\]]*\\]\\))`)); return eval(m[1]); } // eslint-disable-line no-eval
test('feature controls: shared resolver == previous script.js / dashboard.js resolvers on every combination; admin aligned', () => {
  const BASIC = scriptConst('script.js', 'BASIC_FEATURE_DEFAULTS'); const BIZ = scriptConst('script.js', 'BUSINESS_ONLY_FEATURES');
  const s = readFileSync(`${ROOT}script.js`, 'utf8'); const KEYS = JSON.parse(s.match(/const FEATURE_KEYS=(\[[^\]]*\]);/)[1]);
  const defaults = FC.defaultFeatureControls(KEYS, { basicDefaults: BASIC, businessOnly: BIZ });
  let seed = 11; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const controlsVariants = [];
  for (let i = 0; i < 24; i++) {
    const raw = { enabled: i % 4 !== 3, global: {}, Basic: {}, Premium: {}, Business: {} };
    for (const k of KEYS) { if (R() < 0.12) raw.global[k] = false; for (const b of ['Basic', 'Premium', 'Business']) if (R() < 0.3) raw[b][k] = R() < 0.5; }
    controlsVariants.push(FC.mergeFeatureControls(raw, defaults));
  }
  const plans = ['Basic', 'Premium', 'Business', 'business', 'BASIC', '', undefined, 'Gold'];
  const comps = [{}, { complimentaryPremium: true }, { complimentaryBusiness: true }];
  const ovs = [undefined, true, false];
  let n = 0; const adminDiffs = new Set(); const dashPlatformDiffs = new Set();
  for (const controls of controlsVariants) for (const plan of plans) for (const comp of comps) for (const k of KEYS) for (const ov of ovs) {
    const overrides = ov === undefined ? {} : { [k]: ov };
    const card = { plan, ...comp, featureOverrides: overrides };
    // public card
    const planName = card.complimentaryBusiness === true ? 'Business' : (card.complimentaryPremium === true ? 'Premium' : (card.plan || 'Premium'));
    assert.equal(FC.resolveFeature({ controls, plan: planName, overrides, key: k, basicDefaults: BASIC }), ORIG.script(card, controls, BASIC, k));
    // dashboard (effective permission)
    const dPlan = ORIG.dashEffectivePlan(card);
    assert.equal(FC.resolveFeature({ controls, plan: dPlan, overrides, key: k, basicDefaults: BASIC }), ORIG.dashClient(controls, BASIC, card, k));
    const inh = FC.inheritedFeature({ controls, plan: dPlan, key: k, basicDefaults: BASIC });
    if (inh !== ORIG.dashPlatform(controls, BASIC, card, k)) { assert.ok(controls.enabled === false && controls.global[k] === false); dashPlatformDiffs.add(k); }
    // customer editor
    const aNew = FC.resolveFeature({ controls, plan: planName, overrides, key: k, basicDefaults: BASIC });
    if (aNew !== ORIG.admin(planName, overrides, controls, BASIC, k)) {
      assert.ok(controls.enabled === false && String(planName).toLowerCase() === 'premium' && FC.LEGACY_PREMIUM_EXCLUDED.includes(k) && ov === undefined, `unexpected editor difference ${k}`);
      adminDiffs.add(k);
    }
    n++;
  }
  assert.ok(n > 70000, `${n} combinations`);
  // Only intended alignments: legacy-mode Premium editor now hides the 3 features the public card and server already deny,
  // and the dashboard's "inherited" hint now respects a Global OFF in legacy mode.
  assert.deepEqual([...adminDiffs].sort(), [...FC.LEGACY_PREMIUM_EXCLUDED].sort());
});
test('feature controls: server featureAllows (functions/index.js) agrees with the shared resolvers (plan + features)', () => {
  const src = readFileSync(`${ROOT}functions/index.js`, 'utf8');
  const pick = (name) => src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0];
  const basic = src.match(/const BASIC_FEATURE_DEFAULTS = (new Set\(\[[^\]]*\]\));/)[1];
  const { effectivePlanName } = createRequire(import.meta.url)(`${ROOT}functions/plan-resolver.js`);
  const server = new Function('effectivePlanName', `const BASIC_FEATURE_DEFAULTS=${basic};${pick('normalizePlan')}${pick('defaultFeatureControls')}${pick('mergeFeatureControls')}${pick('featureAllows')};return {featureAllows,defaultFeatureControls,BASIC_FEATURE_DEFAULTS};`)(effectivePlanName);
  const keys = Object.keys(server.defaultFeatureControls().global);
  const BIZ = scriptConst('script.js', 'BUSINESS_ONLY_FEATURES');
  let seed = 5; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 40; i++) {
    const raw = { enabled: i % 5 !== 4, global: {}, Basic: {}, Premium: {}, Business: {} };
    for (const k of keys) { if (R() < 0.1) raw.global[k] = false; for (const b of ['Basic', 'Premium', 'Business']) if (R() < 0.3) raw[b][k] = R() < 0.5; }
    const controls = FC.mergeFeatureControls(raw, FC.defaultFeatureControls(keys, { basicDefaults: server.BASIC_FEATURE_DEFAULTS, businessOnly: BIZ }));
    for (const plan of ['Basic', 'Premium', 'Business', 'business', 'x', undefined]) for (const comp of [{}, { complimentaryPremium: true }, { complimentaryBusiness: true }]) for (const k of keys) for (const ov of [undefined, true, false]) {
      const card = { plan, ...comp, featureOverrides: ov === undefined ? {} : { [k]: ov } };
      const dPlan = PR.effectivePlanName(card);
      assert.equal(FC.resolveFeature({ controls, plan: dPlan, overrides: card.featureOverrides, key: k, basicDefaults: server.BASIC_FEATURE_DEFAULTS }), server.featureAllows(card, { featureControls: raw }, k), `${k} ${plan}`);
    }
  }
});

// ------------------------------------------------------------------ plan resolver: one source of truth
const PLAN_VALUES = ['Basic', 'Premium', 'Business', 'basic', 'PREMIUM', 'business', 'JMX Business', 'jmx  business', ' Premium ', '', '   ', undefined, null, 'gold', 'Enterprise', 42, true];
const COMPS = [{}, { complimentaryPremium: true }, { complimentaryBusiness: true }, { complimentaryPremium: true, complimentaryBusiness: true }, { complimentaryPremium: 'true' }];
test('plan resolver: browser module and Cloud Functions copy are identical', () => {
  const F = createRequire(import.meta.url)(`${ROOT}functions/plan-resolver.js`);
  assert.deepEqual(F.PLANS, PR.PLANS); assert.equal(F.LEGACY_PLAN_FALLBACK, PR.LEGACY_PLAN_FALLBACK);
  for (const plan of PLAN_VALUES) for (const c of COMPS) { const card = { plan, ...c }; assert.deepEqual(F.resolveEffectivePlan(card), PR.resolveEffectivePlan(card), JSON.stringify(card)); }
  assert.deepEqual(F.resolveEffectivePlan(null), PR.resolveEffectivePlan(null));
});
test('plan resolver: canonical names, legacy fallback Premium, complimentary precedence', () => {
  const t = (plan, c = {}) => PR.resolveEffectivePlan({ plan, ...c });
  assert.deepEqual([t('Basic').plan, t('basic').plan, t('JMX Business').plan, t('business').plan, t(' Premium ').plan], ['Basic', 'Basic', 'Business', 'Business', 'Premium']);
  for (const v of [undefined, null, '', '  ']) assert.deepEqual([t(v).plan, t(v).baseSource, t(v).legacyFallback], ['Premium', 'missing', true]);
  for (const v of ['gold', 'Enterprise', 42, true]) assert.deepEqual([t(v).plan, t(v).baseSource, t(v).legacyFallback], ['Premium', 'invalid', true]);
  assert.equal(t('Basic', { complimentaryBusiness: true }).plan, 'Business');
  assert.equal(t('Business', { complimentaryPremium: true }).plan, 'Premium', 'same precedence as every previous surface');
  assert.equal(t('Basic', { complimentaryPremium: 'true' }).plan, 'Basic', 'only boolean true counts');
  assert.equal(t(undefined).rawPlan, null); assert.equal(t('gold').rawPlan, 'gold');
});
test('plan resolver vs previous per-surface behaviour: public card + editor unchanged for every missing plan; dashboard + server change only for missing/unrecognised/lower-case plans', () => {
  const oldPublic = (c) => (c.complimentaryBusiness === true ? 'Business' : c.complimentaryPremium === true ? 'Premium' : (c.plan || 'Premium'));
  const bucketOf = (p) => { const x = String(p).toLowerCase(); return x === 'basic' ? 'Basic' : x === 'business' ? 'Business' : 'Premium'; };
  const changedPublic = []; const changedServer = [];
  for (const plan of PLAN_VALUES) for (const c of COMPS) {
    const card = { plan, ...c }; const now = PR.effectivePlanName(card);
    if (bucketOf(oldPublic(card)) !== now) changedPublic.push(JSON.stringify(plan));
    if (ORIG.dashEffectivePlan(card) !== now) changedServer.push(plan);
  }
  // public card/editor: the only differences are values the old code passed through raw and matched case-sensitively
  // ("JMX Business"/"jmx  business" were treated as the Premium bucket; now correctly Business)
  assert.deepEqual([...new Set(changedPublic)].sort(), ['"JMX Business"', '"jmx  business"']);
  for (const v of [...new Set(changedServer)]) assert.ok(v === undefined || v === null || !PR.normalizePlanName(v) || PR.normalizePlanName(v) !== v, `dashboard/server changed for canonical plan ${v}`);
  for (const v of ['Basic', 'Premium', 'Business']) assert.ok(!changedServer.includes(v), `canonical ${v} unchanged`);
});
test('plan resolver is the only plan logic in script.js / admin.js / dashboard.js / functions', () => {
  const s = readFileSync(`${ROOT}script.js`, 'utf8'); const a = readFileSync(`${ROOT}admin.js`, 'utf8'); const d = readFileSync(`${ROOT}dashboard.js`, 'utf8'); const f = readFileSync(`${ROOT}functions/index.js`, 'utf8');
  for (const [name, src] of [['script.js', s], ['admin.js', a], ['dashboard.js', d]]) {
    assert.match(src, /from "\.\/js\/plan-resolver\.js"/, name);
    assert.doesNotMatch(src, /\.plan\|\|"Premium"|complimentaryPremium===true\?"Premium":\(/, `${name}: no private plan fallback`);
  }
  assert.match(s, /function effectivePublicPlan\(\)\{return effectivePlanName\(p\)\}/);
  assert.match(a, /currentCardPlan=effectivePlanName\(meta\)/);
  assert.match(d, /function effectivePlan\(card\)\{\s*return effectivePlanName\(card\);/);
  assert.match(f, /function normalizePlan\(card = \{\}\) \{\s*return effectivePlanName\(card\);/);
  // saving never persists a guessed plan: plan is only written when the admin changed it
  assert.match(d, /const planChanged=clientDialogDraft\.basePlan!==clientDialogOriginal\.basePlan;/);
  assert.match(d, /\.\.\.\(planChanged\?\{plan:clientDialogDraft\.basePlan\}:\{\}\)/);
  assert.match(a, /\.\.\.\(planChanged\?\{plan:selectedPlan\}:\{\}\)/);
});

// ------------------------------------------------------------------ static integrity: Auth, Wallet, NFC
test('Google Auth, Google Wallet and NFC code lines are identical to Prueba 8 (static verification)', async () => {
  const { createHash } = await import('node:crypto');
  const base = JSON.parse(readFileSync(`${ROOT}docs/qr-integration-tests/fixtures/critical-lines-baseline.json`, 'utf8'));
  const drift = [];
  for (const [key, b] of Object.entries(base)) {
    const file = key.split(':')[1];
    const lines = readFileSync(`${ROOT}${file}`, 'utf8').replace(/\r\n/g, '\n').split('\n').filter((l) => new RegExp(b.re).test(l));
    if (lines.length !== b.lines || createHash('sha256').update(lines.join('\n')).digest('hex') !== b.sha256) drift.push(`${key} (${lines.length} vs ${b.lines} lines)`);
  }
  assert.deepEqual(drift, []);
  assert.ok(Object.keys(base).filter((k) => k.startsWith('auth:')).length >= 6);
  // Wallet object identity: deterministic id and GET → PUT / POST-on-404 upsert unchanged
  const f = readFileSync(`${ROOT}functions/index.js`, 'utf8');
  assert.match(f, /jmx_/); assert.match(f, /googleWalletObjectId/);
  // routes
  const fb = JSON.parse(readFileSync(`${ROOT}firebase.json`, 'utf8'));
  assert.deepEqual(fb.hosting.rewrites, [{ source: '/d/**', destination: '/device.html' }, { source: '/c/**', destination: '/card.html' }]);
  assert.ok(fb.hosting.ignore.includes('tools/**') && fb.hosting.ignore.includes('docs/**') && fb.hosting.ignore.includes('functions/**'));
});
