// Integrated tests of the FINAL project (real pages: card.html, admin.html, dashboard.html,
// device.html, login.html) with Firebase mocked locally and GitHub-Pages-style hosting.
// Every QR shown is screenshotted and decoded with two OpenCV decoders; the text must be
// EXACTLY the card's target URL. Run: node --test --test-concurrency=1 docs/qr-integration-tests/
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';
import { buildFixtures, ADMIN_UID, LONG_ID } from './fixtures.mjs';
import { runAudit, compareIntegrity } from '../../tools/inventory-audit/lib/audit-core.mjs';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const OUT = `${HERE}results/`;
const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
mkdirSync(`${OUT}shots`, { recursive: true });
const report = [];
const record = (id, name, details) => report.push({ id, name, status: 'pass', ...details });
let H; let ctx; // shared context = shared mock DB (like one production database)
const ADMIN = { uid: ADMIN_UID, email: 'owner@jmxdigitalcard.com' };
const owner = (id) => ({ uid: `OWNER_${id}`, email: `${id.toLowerCase()}@example.com` });
const target = (id) => `https://jmxdigitalcard.com/c/${encodeURIComponent(id)}?src=qr`;
const IGNORED_ERRORS = [/Failed to load resource: the server responded with a status of 404/]; // /c/{id} 404 redirect + pre-existing /images/* placeholders
const realErrors = (p) => p.errors.filter((e) => !IGNORED_ERRORS.some((r) => r.test(e)));

function decode(file) { return JSON.parse(execFileSync(PYTHON_BIN, [`${HERE}decode_image.py`, file], { encoding: 'utf8' }))[file]; }
function assertDecodes(file, url) {
  const d = decode(file);
  assert.ok(d.some((x) => x === url), `${file} decoded ${JSON.stringify(d)} — expected exactly ${url}`);
  for (const x of d) if (x) assert.equal(x, url, 'no decoder may return a different string');
  return d;
}
async function openPublic(id, { viewport, dpr, via = 'c' } = {}) {
  // fresh context seeded with the CURRENT shared DB snapshot (like a new visitor)
  const c = await H.newContext({ viewport: viewport || { width: 1280, height: 900 }, dpr: dpr || 1, fixtures: currentDb });
  const p = await H.page(c);
  await p.goto(via === 'c' ? `${H.base}/c/${encodeURIComponent(id)}` : `${H.base}/card.html?card=${encodeURIComponent(id)}`);
  await p.waitForFunction(() => document.querySelector('#qrCode canvas.jmx-card-qr-canvas') || document.querySelector('.public-status-screen'), null, { timeout: 15000 });
  await p.waitForTimeout(150);
  return { p, c };
}
async function qrInfo(p) {
  return p.evaluate(() => {
    const c = document.querySelector('#qrCode canvas.jmx-card-qr-canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { ...c.dataset, cssW: r.width, cssH: r.height, pxW: c.width, result: window.__jmxCardQr, count: document.querySelectorAll('#qrCode canvas, #qrCode img').length, qrcodejs: typeof window.QRCode };
  });
}
async function shot(p, name) { const f = `${OUT}shots/${name}.png`; await p.locator('#qrCode canvas').screenshot({ path: f }); return f; }
let currentDb = buildFixtures();
async function dbNow(p) { return p.evaluate(() => JSON.parse(localStorage.getItem('__jmx_mock_db__'))); }

before(async () => {
  H = await createHarness();
  ctx = await H.newContext({ fixtures: currentDb });
});
after(async () => {
  writeFileSync(`${OUT}integration-results.json`, JSON.stringify({ ranAt: new Date().toISOString(), externalRequestsBlocked: [...new Set(H.external)].slice(0, 50), results: report }, null, 1));
  await H?.close();
});

// ------------------------------------------------------------------ public profile
test('01/14/20 existing active Basic client: default black QR + JMX, exact URL', async () => {
  const { p } = await openPublic('JMXB01');
  const i = await qrInfo(p);
  assert.equal(i.qrUrl, target('JMXB01'));
  assert.equal(i.qrFg, '#000000'); assert.equal(i.qrLogo, 'jmx'); assert.equal(i.qrVerified, 'pixels+model');
  assert.equal(i.result.errorCorrection, 'H');
  assert.equal(i.count, 1, 'exactly one QR, no old QR next to the new one');
  assert.equal(i.qrcodejs, 'undefined', 'legacy qrcode.js no longer loaded on the public card');
  const d = assertDecodes(await shot(p, '01-JMXB01-basic-default'), target('JMXB01'));
  assert.deepEqual(realErrors(p), []);
  record(1, 'Existing client (Basic, active) — default QR', { url: i.qrUrl, decoded: d, fg: i.qrFg, logo: i.qrLogo, logoScale: Number(i.qrLogoScale), version: i.qrVersion });
  await p.close();
});

test('02 new client (card just activated, no profile document yet)', async () => {
  const { p } = await openPublic('NEW777');
  const i = await qrInfo(p);
  assert.equal(i.qrUrl, target('NEW777')); assert.equal(i.qrFg, '#000000'); assert.equal(i.qrLogo, 'jmx');
  const d = assertDecodes(await shot(p, '02-NEW777-new'), target('NEW777'));
  record(2, 'New client — same single QR layer', { decoded: d });
  await p.close();
});

test('03/04/05/06/07/20-23 plans and colours: Basic default, Basic override, Premium default, Premium override, Business orange/blue, complimentary', async () => {
  const cases = [
    { id: 'JMXB01', plan: 'Basic', expectFg: '#000000', why: 'customQR OFF for Basic → default', color: 'black' },
    { id: 'JMXB06', plan: 'Basic + client override customQR ON', expectHuePink: true, color: 'pink' },
    { id: 'JMXP07', plan: 'Premium (customQR OFF by plan)', expectFg: '#000000', color: 'black (saved orange ignored)' },
    { id: 'JMXP02', plan: 'Premium + client override ON', expectHuePink: true, color: 'pink' },
    { id: 'JMXZ03', plan: 'JMX Business', expectFg: '#C2410C', color: 'orange' },
    { id: 'JMXZ04', plan: 'JMX Business', expectFg: '#1D4ED8', color: 'blue' },
    { id: 'JMXC05', plan: 'Basic + complimentary Business', expectFg: '#000000', color: 'black (saved)' },
  ];
  const out = [];
  for (const c of cases) {
    const { p } = await openPublic(c.id);
    const i = await qrInfo(p);
    assert.equal(i.qrUrl, target(c.id));
    if (c.expectFg) assert.equal(i.qrFg, c.expectFg, c.id);
    if (c.expectHuePink) { const n = parseInt(i.qrFg.slice(1), 16); const r = n >> 16; const g = (n >> 8) & 255; const b = n & 255; assert.ok(r > g && r > b - 10 && b > g, `${c.id} fg ${i.qrFg} should stay pink`); }
    assert.equal(i.qrLogo, 'jmx');
    const d = assertDecodes(await shot(p, `03-${c.id}`), target(c.id));
    out.push({ ...c, fg: i.qrFg, decoded: d[0] || d[1], logoScale: Number(i.qrLogoScale), adjusted: i.result.foregroundColor });
    await p.close();
  }
  record(3, 'Plans × colours (Basic/Premium/Business, black/pink/orange/blue)', { cases: out });
});

test('08/17/18 JMX emblem centred, complete, 22% target with automatic reduction', async () => {
  const { p } = await openPublic('JMXZ03', { viewport: { width: 1280, height: 900 }, dpr: 3 });
  const i = await qrInfo(p);
  assert.equal(i.result.logoScaleTarget, 0.22);
  assert.ok(i.result.logoScaleOfTotal <= 0.22 + 1e-9 && i.result.logoScaleOfTotal >= 0.09);
  // emblem geometry measured on the rendered pixels: centred, circular, not clipped
  const g = await p.evaluate(() => {
    const c = document.querySelector('#qrCode canvas'); const W = c.width; const ctx2 = c.getContext('2d');
    const d = ctx2.getImageData(0, 0, W, W).data;
    const s = Number(c.dataset.qrLogoScale) * W; const cx = W / 2;
    // inside the emblem box, find the tight bounding box of emblem (non-white) pixels
    let x0 = W, y0 = W, x1 = -1, y1 = -1;
    const lo = Math.floor(cx - s / 2) - 2; const hi = Math.ceil(cx + s / 2) + 2;
    for (let y = lo; y <= hi; y++) for (let x = lo; x <= hi; x++) { if ((x - cx) ** 2 + (y - cx) ** 2 > (s / 2 + 2) ** 2) continue; const k = (y * W + x) * 4; if (d[k] + d[k + 1] + d[k + 2] < 600) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } }
    return { W, s, x0, x1, y0, y1, cxBox: (x0 + x1) / 2, cyBox: (y0 + y1) / 2, w: x1 - x0 + 1, h: y1 - y0 + 1, cx };
  });
  assert.ok(Math.abs(g.cxBox - g.cx) <= 2 && Math.abs(g.cyBox - g.cx) <= 2, `emblem centred ${JSON.stringify(g)}`);
  assert.ok(Math.abs(g.w - g.h) <= 3, 'circle not deformed (width ≈ height)');
  assert.ok(g.w >= g.s * 0.9 && g.w <= g.s + 2, `full circle visible (not cropped) ${JSON.stringify(g)}`);
  const d = assertDecodes(await shot(p, '08-JMXZ03-emblem-dpr3'), target('JMXZ03'));
  // automatic reduction across URL lengths (engine), measured in the browser
  const sweep = await p.evaluate(async () => {
    const m = await import('/js/jmx-qr/card-qr.js');
    const rows = [];
    for (const id of ['A1', 'JMXB01', 'JMXZ03', 'CARD-2026-ABCDEFGHIJ', 'JMXLONGCARD-2026-IDENTIFIER-ABCDEFGHIJKLMNOPQRSTUVWXYZ-012345678']) {
      const url = m.cardQrTargetUrl(id); const { result } = await m.buildVerifiedCardQr({ targetUrl: url, pixelSize: 384 });
      rows.push({ url, len: url.length, version: result.version, logoPct: +(result.logoScaleOfTotal * 100).toFixed(1), reduced: result.logoReduced, worstBlock: +(result.worstBlockUsage * 100).toFixed(0), decoded: result.decodedText === url });
    }
    return rows;
  });
  for (const r of sweep) { assert.ok(r.decoded); assert.ok(r.logoPct <= 22.0001); }
  record(8, 'JMX emblem centred / complete / auto-sized', { geometry: g, decoded: d, logoScaleOfTotal: i.result.logoScaleOfTotal, target: 0.22, reductionSweep: sweep });
  await p.close();
});

test('10/11/12 short and long URLs, /c/{cardId} route unchanged', async () => {
  const { p } = await openPublic(LONG_ID.slice(0, 64));
  const url = target(LONG_ID.slice(0, 64));
  const i = await qrInfo(p);
  assert.equal(i.qrUrl, url);
  assert.equal(p.url(), `${H.base}/card.html?card=${encodeURIComponent(LONG_ID.slice(0, 64))}&pretty=1`, '/c/{id} still resolves through the existing 404.html redirect');
  const dl = assertDecodes(await shot(p, '11-long-url'), url);
  const { p: p2 } = await openPublic('JMXB01');
  const ds = assertDecodes(await shot(p2, '10-short-url'), target('JMXB01'));
  record(10, 'Short targetUrl', { url: target('JMXB01'), length: target('JMXB01').length, decoded: ds });
  record(11, 'Long targetUrl', { url, length: url.length, version: i.qrVersion, logoScale: Number(i.qrLogoScale), decoded: dl });
  record(12, '/c/{cardId} route', { from: `/c/${LONG_ID.slice(0, 64)}`, landedOn: p.url().replace(H.base, '') });
  await p.close(); await p2.close();
});

test('13 /d/** NFC device route unchanged → same card, same QR URL', async () => {
  const p = await H.page(ctx);
  await p.goto(`${H.base}/d/NFC-TEST-0001`);
  await p.waitForFunction(() => document.querySelector('#qrCode canvas.jmx-card-qr-canvas'), null, { timeout: 15000 });
  const landed = p.url().replace(H.base, '');
  assert.match(landed, /^\/card\.html\?card=JMXB01&src=nfc&device=NFC-TEST-0001$/);
  const i = await qrInfo(p);
  assert.equal(i.qrUrl, target('JMXB01'), 'QR target never contains src=nfc or the device id');
  const calls = await p.evaluate(() => JSON.parse(localStorage.getItem('__jmx_mock_calls__') || '[]').map((c) => c.name));
  assert.ok(calls.includes('resolveNfcDevice'));
  const d = assertDecodes(await shot(p, '13-nfc'), target('JMXB01'));
  record(13, '/d/** NFC route', { landed, qrUrl: i.qrUrl, callables: [...new Set(calls)], decoded: d });
  await p.close();
});

test('14b inventory card not yet activated keeps the activation screen (no QR)', async () => {
  const { p } = await openPublic('AVAIL9');
  assert.equal(await p.locator('#qrCode canvas').count(), 0);
  assert.match(await p.locator('.public-status-screen').innerText(), /Activate your JMX Digital Card/);
  record(14, 'Active vs available card', { AVAIL9: 'activation screen unchanged', activeCards: 'render QR' });
  await p.close();
});

test('15/16/37 mobile 128 px (320–430) and desktop ≥195 px (integer px/module), no horizontal overflow', async () => {
  const rows = [];
  for (const [w, hgt, dpr] of [[320, 640, 2], [360, 740, 3], [375, 812, 3], [390, 844, 3], [412, 915, 2.625], [430, 932, 3], [768, 1024, 2], [1024, 768, 1], [1280, 900, 1], [1440, 900, 2]]) {
    const { p, c } = await openPublic('JMXZ03', { viewport: { width: w, height: hgt }, dpr });
    const i = await qrInfo(p);
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const fits = await p.evaluate(() => { const card = document.querySelector('#publicShareThemeCard').getBoundingClientRect(); const s = document.querySelector('.public-share-qr-shell').getBoundingClientRect(); return s.left >= card.left - 0.5 && s.right <= card.right + 0.5; });
    const totalModules = Number(i.qrVersion) * 4 + 17 + 8;
    if (w <= 640) assert.equal(Math.round(i.cssW), 128, `${w}px mobile QR css size`);
    else { assert.ok(i.cssW >= 195 && i.cssW <= 252, `${w}px desktop QR size ${i.cssW}`); assert.equal(Math.round(i.cssW) % totalModules, 0, 'desktop: integer CSS px per module'); }
    const expected = Math.round(i.cssW);
    assert.equal(i.pxW, Math.round(expected * dpr), 'canvas rendered 1:1 at device pixels');
    assert.ok(ov <= 0, `${w}px horizontal overflow ${ov}`);
    assert.ok(fits, `${w}px QR shell inside the card`);
    const f = await shot(p, `15-${w}px-dpr${dpr}`);
    const d = assertDecodes(f, target('JMXZ03'));
    await p.screenshot({ path: `${OUT}shots/page-${w}px.png`, fullPage: false });
    rows.push({ viewport: `${w}x${hgt}@${dpr}`, qrCss: i.cssW, canvasPx: i.pxW, overflow: ov, decoded: !!(d[0] || d[1]) });
    await c.close();
  }
  record(15, 'Mobile 128 px / desktop 245 px (integer px per module), no overflow', { rows });
});

test('19 fallback: unreadable saved colours and a broken business logo never produce a broken QR', async () => {
  const { p } = await openPublic('JMXZ08');
  const i = await qrInfo(p);
  assert.notEqual(i.qrFg, '#FAFAFA');
  assertDecodes(await shot(p, '19-unreadable-colours'), target('JMXZ08'));
  // broken business logo URL + logoMode business → falls back to JMX with the same URL
  const r = await p.evaluate(async (url) => {
    const m = await import('/js/jmx-qr/card-qr.js');
    const { result } = await m.buildVerifiedCardQr({ targetUrl: url, customization: { foregroundColor: '#C2410C' }, logoMode: 'business', businessLogoUrl: '/does-not-exist.png', pixelSize: 384 });
    return result;
  }, target('JMXZ03'));
  assert.equal(r.logo, 'jmx'); assert.equal(r.fallback, 'jmx'); assert.equal(r.decodedText, target('JMXZ03'));
  // decoder rejects a corrupted grid (so a non-decodable render can never pass verification)
  const rej = await p.evaluate(async () => {
    const e = await import('/js/jmx-qr/qr-engine.js'); const d = await import('/js/jmx-qr/qr-decoder.js');
    const m = e.buildQrModel({ targetUrl: 'https://jmxdigitalcard.com/c/JMXZ03?src=qr' });
    const g = Uint8Array.from(m.qr.modules); for (let k = 0; k < g.length; k += 3) g[k] ^= 1;
    return d.tryDecodeQrGrid(g, m.qr.size);
  });
  assert.equal(rej, null);
  record(19, 'Fallback', { unreadableSavedColours: { saved: '#FAFAFA on #FFFFFF', shown: i.qrFg }, brokenBusinessLogo: { shown: r.logo, fallback: r.fallback, decoded: r.decodedText }, corruptedGridRejected: true });
  await p.close();
});

// ------------------------------------------------------------------ platform dashboard
test('32/36/09 dashboard: client dialog QR preview (same engine), one close button, Business Logo upload', async () => {
  const c = await H.newContext({ user: ADMIN, fixtures: currentDb });
  const p = await H.page(c);
  await p.goto(`${H.base}/dashboard.html`);
  await p.locator(`.client-list-row[data-client-id="JMXZ03"], [data-manage-client="JMXZ03"]`).first().waitFor({ timeout: 15000 });
  await p.evaluate(() => { const b = document.querySelector('[data-manage-client="JMXZ03"]') || document.querySelector('.client-list-row[data-client-id="JMXZ03"]'); b.click(); });
  const dlg = p.locator('#clientDetailDialog');
  await dlg.locator('#clientCardQrPreview canvas.jmx-card-qr-canvas').waitFor({ timeout: 15000 });
  assert.equal(await dlg.locator('[aria-label="Close"]').count(), 1, 'one close (X) button');
  const pv = await dlg.locator('#clientCardQrPreview canvas').evaluate((c2) => ({ ...c2.dataset }));
  assert.equal(pv.qrUrl, target('JMXZ03')); assert.equal(pv.qrFg, '#C2410C');
  const f1 = `${OUT}shots/32-dashboard-preview.png`; await dlg.locator('#clientCardQrPreview canvas').screenshot({ path: f1 });
  assertDecodes(f1, target('JMXZ03'));
  // same engine as public: identical data attributes
  const { p: pub } = await openPublic('JMXZ03'); const pi = await qrInfo(pub); await pub.close();
  for (const k of ['qrUrl', 'qrFg', 'qrLogo', 'qrLogoScale', 'qrVersion']) assert.equal(pv[k], pi[k], `dashboard vs public ${k}`);
  // upload business logo (fictional ABC logo) → preview switches to business logo
  await dlg.locator('[data-qr-logo-file]').setInputFiles(`${HERE}fixtures/abc-remodeling-logo.png`);
  await dlg.locator('#clientCardQrStatus', { hasText: 'Logo saved' }).waitFor({ timeout: 15000 });
  await p.waitForFunction(() => document.querySelector('#clientCardQrPreview canvas')?.dataset.qrLogo === 'business', null, { timeout: 15000 });
  const pv2 = await dlg.locator('#clientCardQrPreview canvas').evaluate((c2) => ({ ...c2.dataset }));
  const f2 = `${OUT}shots/09-dashboard-business-logo.png`; await dlg.locator('#clientCardQrPreview canvas').screenshot({ path: f2 });
  assertDecodes(f2, target('JMXZ03'));
  let db = await dbNow(p);
  const biz = db['cards/JMXZ03'].qrBusinessLogo;
  assert.equal(biz.mode, 'business'); assert.equal(biz.colorMode, 'original');
  assert.match(biz.storagePath, /^cards\/JMXZ03\/qrBusinessLogo\/\d+-optimized\.png$/); assert.match(biz.maskStoragePath, /^cards\/JMXZ03\/qrBusinessLogo\/\d+-mask\.png$/);
  assert.match(biz.url, /^https:\/\/firebasestorage\.googleapis\.com\//);
  assert.ok(H.srv.storage.has(biz.storagePath) && H.srv.storage.has(biz.maskStoragePath), 'logo + mask uploaded');
  assert.equal(db['profiles/JMXZ03'].qrBusinessLogo, undefined, 'nothing written to the owner-writable profile');
  assert.equal(db['profiles/JMXZ03'].qrLogoMode, undefined);
  // Monochrome (tinted with the QR colour) — still decodes exactly
  await dlg.locator('[data-qr-logo-colormode]').selectOption('monochrome');
  await p.waitForFunction(() => document.querySelector('#clientCardQrPreview canvas')?.dataset.qrLogoColor === 'monochrome', null, { timeout: 15000 });
  const f3 = `${OUT}shots/09-dashboard-business-logo-monochrome.png`; await dlg.locator('#clientCardQrPreview canvas').screenshot({ path: f3 });
  assertDecodes(f3, target('JMXZ03'));
  db = await dbNow(p); assert.equal(db['cards/JMXZ03'].qrBusinessLogo.colorMode, 'monochrome'); assert.equal(db['cards/JMXZ03'].qrBusinessLogo.url, biz.url, 'colour switch only changes rendering');
  // Use JMX (logo kept) → Use Business again
  await dlg.locator('[data-qr-logo-mode]').selectOption('jmx');
  await p.waitForFunction(() => document.querySelector('#clientCardQrPreview canvas')?.dataset.qrLogo === 'jmx', null, { timeout: 15000 });
  db = await dbNow(p); assert.equal(db['cards/JMXZ03'].qrBusinessLogo.mode, 'jmx'); assert.equal(db['cards/JMXZ03'].qrBusinessLogo.storagePath, biz.storagePath, 'Use JMX keeps the uploaded logo');
  await dlg.locator('[data-qr-logo-mode]').selectOption('business');
  await dlg.locator('[data-qr-logo-colormode]').selectOption('original');
  await p.waitForFunction(() => { const c2 = document.querySelector('#clientCardQrPreview canvas'); return c2?.dataset.qrLogo === 'business' && c2?.dataset.qrLogoColor === 'original'; }, null, { timeout: 15000 });
  // Replace → previous files removed only after the new record is saved
  await dlg.locator('[data-qr-logo-file]').setInputFiles(`${HERE}fixtures/abc-remodeling-logo.png`);
  await p.waitForFunction((old) => JSON.parse(localStorage.getItem('__jmx_mock_db__'))['cards/JMXZ03'].qrBusinessLogo.storagePath !== old, biz.storagePath, { timeout: 15000 });
  await p.waitForTimeout(300);
  db = await dbNow(p); const biz2 = db['cards/JMXZ03'].qrBusinessLogo;
  assert.ok(!H.srv.storage.has(biz.storagePath) && !H.srv.storage.has(biz.maskStoragePath), 'replaced files removed');
  assert.ok(H.srv.storage.has(biz2.storagePath) && H.srv.storage.has(biz2.maskStoragePath));
  // client override toggles re-render the preview with the staged draft (not saved)
  const hasToggle = await dlg.locator('[data-client-feature="customQR"]').count();
  if (hasToggle) {
    await dlg.locator('[data-client-feature="customQR"]').evaluate((el) => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForFunction(() => document.querySelector('#clientCardQrPreview canvas')?.dataset.qrFg === '#000000', null, { timeout: 15000 });
  }
  const hasBizToggle = await dlg.locator('[data-client-feature="businessLogoQr"]').count();
  if (hasBizToggle) {
    await dlg.locator('[data-client-feature="businessLogoQr"]').evaluate((el) => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForFunction(() => document.querySelector('#clientCardQrPreview canvas')?.dataset.qrLogo === 'jmx', null, { timeout: 15000 });
  }
  const dialogOverflow = await p.evaluate(() => { const b = document.querySelector('#clientDetailBody'); return b.scrollWidth - b.clientWidth; });
  assert.ok(dialogOverflow <= 0);
  assert.deepEqual(realErrors(p), []);
  currentDb = await dbNow(p);
  assert.deepEqual(currentDb['cards/JMXZ03'].featureOverrides || {}, buildFixtures()['cards/JMXZ03'].featureOverrides || {}, 'staged toggles were not saved');
  record(32, 'Dashboard works + QR preview identical to public', { preview: pv, public: { qrUrl: pi.qrUrl, qrFg: pi.qrFg, qrLogoScale: pi.qrLogoScale }, closeButtons: 1, stagedOverrideRerender: hasToggle > 0, stagedBusinessLogoToggle: hasBizToggle > 0 });
  record(9, 'Business Logo QR (admin: upload, monochrome, use JMX, use business, replace)', { preview: pv2, stored: 'cards/JMXZ03.qrBusinessLogo', storagePath: biz2.storagePath, maskStoragePath: biz2.maskStoragePath, profileUntouched: true });
  await c.close();
});

test('09b public card shows the business logo (cross-origin logo → model-verified) and decodes exactly', async () => {
  const { p, c } = await openPublic('JMXZ03', { viewport: { width: 390, height: 844 }, dpr: 3 });
  const i = await qrInfo(p);
  assert.equal(i.qrLogo, 'business'); assert.equal(i.qrUrl, target('JMXZ03'));
  assert.ok(['model', 'pixels+model'].includes(i.qrVerified));
  const d = assertDecodes(await shot(p, '09b-public-business-logo'), target('JMXZ03'));
  record(90, 'Public card with Business Logo', { verification: i.qrVerified, decoded: d, logoScale: Number(i.qrLogoScale) });
  await c.close();
});

test('09c Business Logo QR: feature OFF keeps the logo (JMX shown), ON restores it; owner cannot inject a logo', async () => {
  // feature OFF for this client (saved override) → public shows JMX, logo settings untouched
  const off = JSON.parse(JSON.stringify(currentDb)); off['cards/JMXZ03'].featureOverrides = { ...(off['cards/JMXZ03'].featureOverrides || {}), businessLogoQr: false };
  let c = await H.newContext({ fixtures: off }); let p = await H.page(c);
  await p.goto(`${H.base}/card.html?card=JMXZ03`); await p.waitForFunction(() => document.querySelector('#qrCode canvas.jmx-card-qr-canvas'), null, { timeout: 15000 });
  let i = await qrInfo(p); assert.equal(i.qrLogo, 'jmx'); assert.deepEqual((await dbNow(p))['cards/JMXZ03'].qrBusinessLogo, currentDb['cards/JMXZ03'].qrBusinessLogo);
  assertDecodes(await shot(p, '09c-feature-off-jmx'), target('JMXZ03')); await c.close();
  // back to INHERIT → business logo restored exactly
  const { p: p2, c: c2 } = await openPublic('JMXZ03'); i = await qrInfo(p2); assert.equal(i.qrLogo, 'business'); await c2.close();
  // an owner-writable profile carrying logo fields is ignored on every surface
  const inj = JSON.parse(JSON.stringify(currentDb));
  inj['profiles/JMXZ04'] = { ...inj['profiles/JMXZ04'], qrLogoMode: 'business', qrBusinessLogo: { url: `https://firebasestorage.googleapis.com/v0/b/jmx-mock.appspot.com/o/${encodeURIComponent(currentDb['cards/JMXZ03'].qrBusinessLogo.storagePath)}?alt=media`, mode: 'business' } };
  c = await H.newContext({ fixtures: inj }); p = await H.page(c);
  await p.goto(`${H.base}/card.html?card=JMXZ04`); await p.waitForFunction(() => document.querySelector('#qrCode canvas.jmx-card-qr-canvas'), null, { timeout: 15000 });
  i = await qrInfo(p); assert.equal(i.qrLogo, 'jmx', 'profile-injected logo ignored on the public card'); await c.close();
  c = await H.newContext({ user: owner('JMXZ04'), fixtures: inj }); p = await H.page(c);
  await p.goto(`${H.base}/admin.html?card=JMXZ04`); await p.locator('#jmxQrEditorCanvas canvas.jmx-card-qr-canvas').waitFor({ timeout: 20000 }); await p.waitForTimeout(300);
  assert.equal(await p.locator('#jmxQrEditorCanvas canvas').evaluate((x) => x.dataset.qrLogo), 'jmx', 'profile-injected logo ignored in the editor');
  assert.equal(await p.locator('#qrLogoMode, [data-qr-logo-file]').count(), 0, 'no logo controls for the client');
  await c.close();
  record(91, 'Business Logo QR: OFF keeps settings / ON restores / owner injection ignored', { off: 'jmx', restored: 'business', injected: 'jmx' });
});

test('09d Business Logo QR remove (two-step) deletes record + files; public back to JMX', async () => {
  const c = await H.newContext({ user: ADMIN, fixtures: currentDb }); const p = await H.page(c);
  await p.goto(`${H.base}/dashboard.html`);
  await p.locator('[data-manage-client="JMXZ03"], .client-list-row[data-client-id="JMXZ03"]').first().waitFor({ timeout: 15000 });
  await p.evaluate(() => { (document.querySelector('[data-manage-client="JMXZ03"]') || document.querySelector('.client-list-row[data-client-id="JMXZ03"]')).click(); });
  const dlg = p.locator('#clientDetailDialog');
  await dlg.locator('#clientCardQrPreview canvas.jmx-card-qr-canvas').waitFor({ timeout: 15000 });
  const before = (await dbNow(p))['cards/JMXZ03'].qrBusinessLogo;
  await dlg.locator('[data-qr-logo-remove]').click();
  assert.ok((await dbNow(p))['cards/JMXZ03'].qrBusinessLogo, 'first click only arms the button');
  await dlg.locator('[data-qr-logo-remove]').click();
  await dlg.locator('#clientCardQrStatus', { hasText: 'Logo removed' }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(300);
  const after = await dbNow(p);
  assert.equal(after['cards/JMXZ03'].qrBusinessLogo, undefined);
  assert.ok(!H.srv.storage.has(before.storagePath) && !H.srv.storage.has(before.maskStoragePath), 'files deleted');
  const keep = buildFixtures()['cards/JMXZ03']; for (const k of Object.keys(keep)) assert.deepEqual(after['cards/JMXZ03'][k], keep[k], `cards/JMXZ03.${k} untouched`);
  assert.deepEqual(realErrors(p), []);
  currentDb = after; await c.close();
  const { p: pub, c: cp } = await openPublic('JMXZ03'); const i = await qrInfo(pub); assert.equal(i.qrLogo, 'jmx'); assertDecodes(await shot(pub, '09d-after-remove'), target('JMXZ03')); await cp.close();
  record(92, 'Business Logo QR remove', { recordDeleted: true, filesDeleted: true, publicLogo: i.qrLogo });
});

// ------------------------------------------------------------------ customer editor
test('33/35 customer editor: live preview uses the same engine, save keeps identity, public reflects it', async () => {
  const c = await H.newContext({ user: owner('JMXZ04'), fixtures: currentDb });
  const p = await H.page(c);
  await p.goto(`${H.base}/admin.html?card=JMXZ04`);
  await p.locator('#jmxQrEditorCanvas canvas.jmx-card-qr-canvas').waitFor({ timeout: 20000 });
  let pv = await p.locator('#jmxQrEditorCanvas canvas').evaluate((x) => ({ ...x.dataset }));
  assert.equal(pv.qrUrl, target('JMXZ04')); assert.equal(pv.qrFg, '#1D4ED8');
  // live change → preview updates before saving
  await p.locator('#qrDarkColor').evaluate((el) => { el.value = '#15803d'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForFunction(() => document.querySelector('#jmxQrEditorCanvas canvas')?.dataset.qrFg === '#15803D', null, { timeout: 10000 });
  pv = await p.locator('#jmxQrEditorCanvas canvas').evaluate((x) => ({ ...x.dataset }));
  const f = `${OUT}shots/33-editor-preview.png`; await p.locator('#jmxQrEditorCanvas canvas').screenshot({ path: f });
  assertDecodes(f, target('JMXZ04'));
  const before = await dbNow(p);
  // save through the existing editor save button
  const saveBtn = p.locator('#saveProfile');
  await saveBtn.click();
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('__jmx_mock_db__'))['profiles/JMXZ04']?.qrDarkColor?.toLowerCase() === '#15803d', null, { timeout: 15000 });
  const after2 = await dbNow(p);
  for (const k of ['cards/JMXZ04', 'inventory/JMXZ04', 'cardOwners/JMXZ04', 'accounts/ACC-JMXZ04', 'users/OWNER_JMXZ04']) assert.deepEqual(after2[k], before[k], `${k} untouched by editor save`);
  assert.deepEqual(realErrors(p), []);
  currentDb = after2;
  const { p: pub } = await openPublic('JMXZ04'); const pi = await qrInfo(pub);
  assert.equal(pi.qrFg, '#15803D'); assert.equal(pi.qrUrl, target('JMXZ04'));
  assertDecodes(await shot(pub, '33-public-after-editor-save'), target('JMXZ04'));
  await pub.close();
  record(33, 'Customer editor works (live preview = public engine, save)', { previewAfterChange: pv, publicAfterSave: { qrFg: pi.qrFg, qrUrl: pi.qrUrl } });
  // 35: Basic owner without QR features → no empty section, no preview box
  const c2 = await H.newContext({ user: owner('JMXB01'), fixtures: currentDb, viewport: { width: 390, height: 844 }, dpr: 2 });
  const p2 = await H.page(c2);
  await p2.goto(`${H.base}/admin.html?card=JMXB01`);
  await p2.waitForFunction(() => document.getElementById('adminUserEmail')?.textContent, null, { timeout: 20000 });
  await p2.waitForTimeout(800);
  const vis = await p2.evaluate(() => ({ section: !document.getElementById('businessNetworkingSection').hidden, preview: !document.getElementById('jmxQrEditorPreview').hidden, overflow: document.documentElement.scrollWidth - innerWidth }));
  assert.deepEqual(vis, { section: false, preview: false, overflow: 0 });
  assert.deepEqual(realErrors(p2), []);
  record(35, 'No dead spaces (Basic owner: QR section fully hidden)', vis);
  await c.close(); await c2.close();
});

// ------------------------------------------------------------------ plan resolver + inventory guard (isolated DB copies)
test('P1 legacy cards without / with unrecognised plan: Premium everywhere, public data still visible, saving never persists a guessed plan', async () => {
  const db0 = JSON.parse(JSON.stringify(currentDb));
  // public card: Premium-only fields (website, instagram) stay visible exactly as before
  for (const id of ['LEG09', 'LEG10']) {
    const c = await H.newContext({ fixtures: db0 }); const p = await H.page(c);
    await p.goto(`${H.base}/card.html?card=${id}`); await p.waitForFunction(() => document.querySelector('#qrCode canvas.jmx-card-qr-canvas'), null, { timeout: 15000 });
    const vis = await p.evaluate(() => ({ website: getComputedStyle(document.getElementById('websiteRow') || document.body).display !== 'none', phone2: !!document.getElementById('phone2Row') }));
    if (id === 'LEG09') assert.ok(vis.website, 'LEG09 website (Premium feature) still visible');
    assert.equal((await qrInfo(p)).qrUrl, target(id)); assert.deepEqual(realErrors(p), []); await c.close();
  }
  // dashboard: shows Premium + legacy note; saving an unrelated change does NOT write plan
  const c = await H.newContext({ user: ADMIN, fixtures: db0 }); const p = await H.page(c);
  await p.goto(`${H.base}/dashboard.html`);
  await p.locator('[data-manage-client="LEG09"], .client-list-row[data-client-id="LEG09"]').first().waitFor({ timeout: 15000 });
  await p.evaluate(() => (document.querySelector('[data-manage-client="LEG09"]') || document.querySelector('.client-list-row[data-client-id="LEG09"]')).click());
  const dlg = p.locator('#clientDetailDialog'); await dlg.locator('[data-legacy-plan-note]').waitFor({ timeout: 15000 });
  assert.match(await dlg.locator('.access-status-grid').innerText(), /Premium[\s\S]*legacy: no plan saved/);
  await dlg.locator('[data-client-feature="customQR"]').evaluate((el) => { el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await dlg.locator('[data-dialog-action="saveClientChanges"]').click();
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('__jmx_mock_db__'))['cards/LEG09'].featureOverrides?.customQR !== undefined, null, { timeout: 15000 });
  let db = await dbNow(p);
  assert.equal('plan' in db['cards/LEG09'], false, 'dashboard save did not persist a guessed plan');
  assert.equal(db['inventory/LEG09'].plan, undefined);
  assert.deepEqual(realErrors(p), []); await c.close();
  // customer editor opened by the platform admin: saving keeps the card without plan
  const c2 = await H.newContext({ user: ADMIN, fixtures: db0 }); const p2 = await H.page(c2);
  await p2.goto(`${H.base}/admin.html?card=LEG09`); await p2.waitForFunction(() => document.getElementById('clientPlan')?.value === 'Premium', null, { timeout: 20000 });
  await p2.waitForTimeout(500); await p2.locator('#saveProfile').click();
  await p2.waitForFunction(() => JSON.parse(localStorage.getItem('__jmx_mock_db__'))['cardAdmin/LEG09']?.updatedAt, null, { timeout: 15000 }); await p2.waitForTimeout(800);
  db = await dbNow(p2);
  assert.equal('plan' in db['cards/LEG09'], false, 'editor save did not persist a guessed plan');
  for (const k of ['website', 'fullName', 'email', 'phone']) assert.equal(db['profiles/LEG09'][k], db0['profiles/LEG09'][k], `profile ${k} kept`);
  assert.match(db['profiles/LEG09'].instagram, /legacyco/, 'instagram kept (the existing editor stores it as a full URL)');
  assert.deepEqual(realErrors(p2), []); await c2.close();
  record(93, 'Plan resolver: legacy cards', { publicFeaturesKept: true, dashboardShows: 'Premium (legacy: no plan saved)', planWritten: false });
});

test('P2 dashboard delete / regenerate guard: blocks anything referenced; deletes unused stock only after re-validation and a JSON backup', async () => {
  const db0 = JSON.parse(JSON.stringify(currentDb));
  const c = await H.newContext({ user: ADMIN, fixtures: db0 }); const p = await H.page(c);
  const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await p.goto(`${H.base}/dashboard.html`);
  await p.waitForFunction(() => document.querySelector('[data-manage-client]'), null, { timeout: 15000 });
  const act = (id, action) => p.evaluate(async ([cid, a]) => {
    const dlg = document.getElementById('clientDetailDialog'); dlg.dataset.cardId = cid;
    const host = document.getElementById('clientDetailActions'); host.innerHTML = `<button data-dialog-action="${a}">x</button>`;
    host.querySelector('button').click(); await new Promise((r) => setTimeout(r, 1500));
  }, [id, action]);
  const exists = async (path) => !!(await dbNow(p))[path];
  const blocked = {};
  for (const id of ['STOCK02', 'RESV04', 'REL05']) {
    dialogs.length = 0; await act(id, 'delete');
    assert.ok(dialogs.some((m) => /blocked/.test(m)), `${id}: ${dialogs.join(' | ')}`);
    assert.ok(await exists(`cards/${id}`) && await exists(`inventory/${id}`), `${id} kept`);
    blocked[id] = dialogs.find((m) => /blocked/.test(m)).split('\n')[0];
  }
  dialogs.length = 0; await act('STOCK02', 'regenerate'); assert.ok(dialogs.some((m) => /Regenerate blocked/.test(m))); assert.ok(await exists('cards/STOCK02'));
  // unused stock: explicit confirmation, re-validation, backup download, then delete
  dialogs.length = 0;
  const [download] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), act('STOCK01', 'delete')]);
  assert.match(download.suggestedFilename(), /^JMX-backup-STOCK01-\d+\.json$/);
  assert.ok(dialogs.some((m) => /VALID unused stock/.test(m)));
  const backup = await p.evaluate(() => window.__jmxLastDeletionBackup);
  assert.equal(backup.documents['cards/STOCK01'].status, 'available'); assert.ok(backup.documents['inventory/STOCK01'].activationCode);
  for (const col of ['cards', 'inventory', 'profiles', 'cardAdmin']) assert.equal(await exists(`${col}/STOCK01`), false);
  const after = await dbNow(p);
  for (const k of Object.keys(db0)) if (!k.endsWith('/STOCK01')) assert.deepEqual(after[k], db0[k], `${k} untouched`);
  assert.deepEqual(realErrors(p), []); await c.close();
  record(94, 'Dashboard delete/regenerate guard', { blocked, deleted: 'STOCK01 (after confirm + re-validation + backup)', otherDocsUntouched: true });
});

// ------------------------------------------------------------------ untouched systems + data
test('30/31 Google Auth (login page) and Google Wallet (editor) still load', async () => {
  const c = await H.newContext({ fixtures: currentDb });
  const p = await H.page(c);
  await p.goto(`${H.base}/login.html`);
  await p.waitForTimeout(500);
  assert.deepEqual(realErrors(p), []);
  const c2 = await H.newContext({ user: owner('JMXZ03'), fixtures: currentDb });
  const p2 = await H.page(c2);
  await p2.goto(`${H.base}/admin.html?card=JMXZ03`);
  await p2.locator('#jmxQrEditorCanvas canvas').waitFor({ timeout: 20000 });
  const wallet = await p2.evaluate(() => !!document.getElementById('googleWalletSection'));
  assert.ok(wallet); assert.deepEqual(realErrors(p2), []);
  record(30, 'Google Auth login page loads unchanged', { errors: 0 });
  record(31, 'Google Wallet section present in editor, no errors', { walletSection: wallet });
  await c.close(); await c2.close();
});

test('24–29/38 identity & existing data intact after all flows (Card/Account/Identity IDs, NFC, Device IDs, activation codes)', async () => {
  const p = await H.page(ctx);
  await p.goto(`${H.base}/card.html?card=JMXB01`);
  const now = await dbNow(p);
  const orig = buildFixtures();
  // merge DB snapshots from the other contexts (each test context had its own localStorage copy)
  const finalDb = { ...now, ...currentDb };
  const identityCollections = ['cards/', 'accounts/', 'users/', 'inventory/', 'nfcDevices/', 'nfcDevicePublic/', 'cardOwners/', 'cardAdmin/', 'platform/'];
  const changed = [];
  for (const [k, v] of Object.entries(orig)) {
    if (!identityCollections.some((c) => k.startsWith(c))) continue;
    if (JSON.stringify(finalDb[k]) !== JSON.stringify(v)) changed.push(k);
  }
  assert.deepEqual(changed, [], 'identity / NFC / activation / account documents unchanged');
  // profiles: only QR fields (and the editor-save of JMXZ04) may differ
  const profileDiffs = {};
  for (const [k, v] of Object.entries(orig)) {
    if (!k.startsWith('profiles/')) continue;
    const a = v; const b = finalDb[k] || {};
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((x) => JSON.stringify(a[x]) !== JSON.stringify(b[x]));
    if (keys.length) profileDiffs[k] = keys;
  }
  const allowed = new Set(['updatedAt', 'qrDarkColor']); // Business Logo QR never writes to profiles
  for (const [k, keys] of Object.entries(profileDiffs)) {
    if (k === 'profiles/JMXZ04') continue; // explicit editor save in test 33 (existing editor behaviour writes the full profile)
    for (const x of keys) assert.ok(allowed.has(x), `${k}.${x} changed unexpectedly`);
  }
  // no new cards / accounts were created
  const countOf = (db, pre) => Object.keys(db).filter((k) => k.startsWith(pre)).length;
  for (const pre of ['cards/', 'accounts/', 'users/', 'nfcDevices/', 'inventory/']) assert.equal(countOf(finalDb, pre), countOf(orig, pre), `${pre} count`);
  const ids = Object.fromEntries(Object.entries(orig).filter(([k]) => k.startsWith('cards/')).map(([k, v]) => [k, { accountId: finalDb[k].accountId, identityProfileId: finalDb[k].identityProfileId }]));
  // integrity counts (same code as the inventory audit tool): no active count may go down
  const iBefore = runAudit(orig).summary.integrity; const iAfter = runAudit(finalDb).summary.integrity;
  assert.deepEqual(compareIntegrity(iBefore, iAfter), []);
  record(31.1, 'Integrity counts before/after all flows', { before: iBefore, after: iAfter });
  record(24, 'Card IDs / Account IDs / Identity Profile IDs / NFC / Device IDs / Activation codes intact', { identityDocsChanged: changed, profileQrFieldChanges: profileDiffs, ids });
  await p.close();
});
