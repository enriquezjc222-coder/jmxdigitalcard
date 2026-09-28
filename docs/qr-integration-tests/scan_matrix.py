#!/usr/bin/env python3
"""QR scanner stress test of the INTEGRATED engine.
Renders docs/qr-integration-tests/bench.html in Chromium at mobile (128 px @ DPR 2 and 3)
and desktop (160 px @ DPR 1) sizes, screenshots every QR, and decodes each with two OpenCV
decoders — clean and under camera-like degradations (downscale, blur, JPEG, rotation,
perspective, low light + noise). Every decode must return EXACTLY the target URL.
Usage: python3 docs/qr-integration-tests/scan_matrix.py [--query "budget=0.5"]
"""
import json, os, subprocess, sys
import cv2, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'results', 'scan'); os.makedirs(OUT, exist_ok=True)
query = sys.argv[sys.argv.index('--query') + 1] if '--query' in sys.argv else ''
capture = r'''
import { createHarness } from './harness.mjs';
const h = await createHarness(); const out = [];
for (const [mode, dpr] of [['mobile', 2], ['mobile', 3], ['desktop', 1]]) {
  const c = await h.newContext({ viewport: { width: 1400, height: 900 }, dpr }); const p = await h.page(c);
  await p.goto(`${h.base}/docs/qr-integration-tests/bench.html?mode=${mode}&${process.argv.at(-2) || ''}`);
  await p.waitForFunction(() => window.__done === true, null, { timeout: 180000 });
  for (const b of await p.evaluate(() => window.__bench)) { const size = b.cssSize; const f = `${process.argv.at(-1)}/${b.id}-${mode}-${dpr}.png`; await p.locator(`#${b.id} canvas`).screenshot({ path: f }); out.push({ ...b, size, dpr, file: f }); }
  await c.close();
}
await h.close(); console.log(JSON.stringify(out));
'''
res = subprocess.run(['node', '--input-type=module', '-e', capture, '--', query, OUT], cwd=HERE, capture_output=True, text=True)
if res.returncode: print(res.stderr); sys.exit(2)
rows = json.loads(res.stdout.strip().splitlines()[-1])
D = cv2.QRCodeDetector(); A = cv2.QRCodeDetectorAruco()
def dec(img):
    r = []
    for d in (D, A):
        try: r.append(d.detectAndDecode(img)[0] or '')
        except cv2.error: r.append('')
    return r
def pad(img, n): return cv2.copyMakeBorder(img, n, n, n, n, cv2.BORDER_CONSTANT, value=(255, 255, 255))
def degr(img, modules):
    h, w = img.shape[:2]; o = {}
    k = 3.0 * modules / w
    if k < 1:
        s = cv2.resize(img, (max(1, int(w * k)), max(1, int(h * k))), interpolation=cv2.INTER_AREA); o['downscale_3px_module'] = cv2.resize(s, (s.shape[1] * 2, s.shape[0] * 2))
    o['blur'] = cv2.GaussianBlur(img, (0, 0), max(0.8, w / modules * 0.25))
    ok, e = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 35]); o['jpeg_q35'] = cv2.imdecode(e, 1)
    p = pad(img, int(w * .2)); c = (p.shape[1] / 2, p.shape[0] / 2); o['rotate_15'] = cv2.warpAffine(p, cv2.getRotationMatrix2D(c, 15, 1), (p.shape[1], p.shape[0]), borderValue=(255, 255, 255))
    p = pad(img, int(w * .15)); H, W = p.shape[:2]; d = W * .08
    o['perspective'] = cv2.warpPerspective(p, cv2.getPerspectiveTransform(np.float32([[0, 0], [W, 0], [W, H], [0, H]]), np.float32([[d, d * .6], [W - d * .2, 0], [W, H], [d * .4, H - d]])), (W, H), borderValue=(255, 255, 255))
    rng = np.random.default_rng(7); o['low_light_noise'] = (img.astype(np.float32) * .55 + 70 + rng.normal(0, 9, img.shape)).clip(0, 255).astype(np.uint8)
    return o
stats = {}; wrong = []; clean_fail = []; hard = []
base = {(r['url'], r['color'], r['size'], r['dpr']): r for r in rows if r['logo'] == 'none'}
results = []
for r in rows:
    img = pad(cv2.imread(r['file']), 16); modules = r['version'] * 4 + 17 + 8
    c = dec(img)
    for x in c:
        if x and x != r['url']: wrong.append((r['file'], 'clean', x))
    if not all(x == r['url'] for x in c): clean_fail.append(r['file'])
    dres = {}
    for n, im in degr(img, modules).items():
        z = dec(im)
        for x in z:
            if x and x != r['url']: wrong.append((r['file'], n, x))
        ok = any(x == r['url'] for x in z); dres[n] = ok
        tier = f"desktop{r['cssSize']}@1x" if r['dpr'] == 1 else f"mobile{r['cssSize']}@{r['dpr']}x"
        s = stats.setdefault(f'{tier}:{n}', [0, 0]); s[0] += ok; s[1] += 1
    results.append({**r, 'clean': c, 'deg': dres})
for r in results:
    b = next((x for x in results if x['logo'] == 'none' and x['url'] == r['url'] and x['color'] == r['color'] and x['size'] == r['size'] and x['dpr'] == r['dpr']), None)
    for n, ok in r['deg'].items():
        if not ok and (b is None or b['deg'].get(n)): hard.append((os.path.basename(r['file']), r['logo'], n))
summary = {'query': query, 'images': len(rows), 'clean_both_decoders': len(rows) - len(clean_fail), 'clean_failures': clean_fail, 'wrong_decodes': len(wrong),
           'logo_attributable_degradation_failures': len(hard), 'degradation_pass': {k: f'{v[0]}/{v[1]}' for k, v in sorted(stats.items())},
           'logo_pct_by_version': sorted({(r['version'], r['logo'], r['logoPct']) for r in rows if r['logo'] != 'none'})}
json.dump({'summary': summary, 'hard': hard, 'results': results}, open(os.path.join(HERE, 'results', f"scan-matrix{('-' + query) if query else ''}.json"), 'w'), indent=1)
print(json.dumps(summary, indent=1)); print('hard:', hard[:30])
sys.exit(1 if (clean_fail or wrong or hard) else 0)
