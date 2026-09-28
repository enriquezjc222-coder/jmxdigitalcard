// Shared Playwright harness: routes Firebase CDN modules to the local mocks, blocks all
// other external hosts, seeds the mock DB and the signed-in user.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { buildFixtures } from './fixtures.mjs';

const MOCK_DIR = fileURLToPath(new URL('./mock-firebase/', import.meta.url));
export async function loadPlaywright() {
  for (const c of ['playwright', process.env.PLAYWRIGHT_MODULE, '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return await import(c); } catch { /* next */ }
  }
  throw new Error('Playwright not found: npm i -D playwright && npx playwright install chromium');
}
export async function createHarness() {
  const { chromium } = await loadPlaywright();
  const srv = await startServer(0);
  const base = `http://127.0.0.1:${srv.port}`;
  const browser = await chromium.launch();
  const external = [];
  async function newContext({ viewport = { width: 1280, height: 900 }, dpr = 1, user = null, fixtures = buildFixtures(), isMobile = false } = {}) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile, hasTouch: isMobile });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => { external.push(route.request().url()); route.fulfill({ status: 200, contentType: route.request().url().endsWith('.css') ? 'text/css' : 'text/javascript', body: '' }); });
    await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z]+)\.js/, async (route) => {
      const name = route.request().url().match(/(firebase-[a-z]+)\.js/)[1];
      route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(`${MOCK_DIR}${name}.js`, 'utf8') });
      // (registered after the catch-all so it takes precedence)
    });
    // Firebase Storage download URLs → the local in-memory store (no CORS headers on purpose)
    await ctx.route(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)/, (route) => {
      const key = decodeURIComponent(route.request().url().match(/\/o\/([^?]+)/)[1]);
      const f = srv.storage.get(key);
      if (!f) return route.fulfill({ status: 404, body: '' });
      route.fulfill({ status: 200, contentType: f.type, body: f.body });
    });
    const init = { db: fixtures, user };
    await ctx.addInitScript((s) => {
      if (!localStorage.getItem('__jmx_mock_db__')) localStorage.setItem('__jmx_mock_db__', JSON.stringify(s.db));
      if (!localStorage.getItem('__jmx_mock_seeded__')) { localStorage.setItem('__jmx_mock_seeded__', '1'); if (s.user) localStorage.setItem('__jmx_mock_user__', JSON.stringify(s.user)); }
    }, init);
    return ctx;
  }
  async function page(ctx) {
    // eslint-disable-next-line
    const p = await ctx.newPage();
    p.errors = [];
    p.on('pageerror', (e) => p.errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') p.errors.push(`console: ${m.text()}`); });
    return p;
  }
  return { browser, base, srv, newContext, page, external, close: async () => { await browser.close(); srv.server.close(); } };
}
