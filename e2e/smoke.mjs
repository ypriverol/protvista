/**
 * End-to-end smoke tests against the built demo, driven by Playwright.
 *
 * Covers the behaviour that unit tests cannot see (and that has already
 * regressed once in each case during development):
 *  - Go-to navigation actually moves the display window (manager event
 *    keys), residue validation, no layout overlap
 *  - 1D->3D: feature clicks and the per-track "3D" checkbox reach the
 *    structure viewer's highlight
 *  - 3D->1D: structure selections navigate the 1D view
 *  - click tooltip lifecycle
 *
 * Usage:  node e2e/smoke.mjs [baseUrl]
 * The demo must be built (yarn build:demo) and served at baseUrl
 * (default http://localhost:4573). Requires network access to the EBI
 * APIs. Set E2E_PROXY=1 to route API traffic through Node's fetch
 * (needed in sandboxes where the browser has no direct egress).
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:4573';
const results = [];
const consoleErrors = [];
const check = (name, ok, detail = '') =>
  results.push(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`
  );

const browser = await chromium.launch({ args: ['--disable-http2'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') {
    consoleErrors.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
  }
});
page.on('requestfailed', (r) =>
  consoleErrors.push(`[requestfailed] ${r.url().slice(0, 120)} ${r.failure()?.errorText}`)
);

// On any hard failure (e.g. the viewer never renders), dump everything we
// know instead of dying with a bare TimeoutError
const bail = async (stage, error) => {
  console.log(`FATAL at stage "${stage}": ${error.message.split('\n')[0]}`);
  console.log(results.join('\n'));
  console.log(
    `\nBrowser console/network (${consoleErrors.length}):\n` +
      [...new Set(consoleErrors)].slice(0, 20).join('\n')
  );
  try {
    await page.screenshot({ path: 'e2e-failure.png', fullPage: true });
    console.log('screenshot saved to e2e-failure.png');
  } catch {
    /* page may be gone */
  }
  await browser.close();
  process.exit(1);
};

if (process.env.E2E_PROXY) {
  await page.route(
    /https:\/\/([a-z0-9.-]+\.)?(ebi\.ac\.uk|uniprot\.org|systemsbiology\.net)\/.*/,
    async (route) => {
      try {
        const resp = await fetch(route.request().url(), {
          headers: { Accept: route.request().headers()['accept'] || '*/*' },
        });
        const body = Buffer.from(await resp.arrayBuffer());
        await route.fulfill({
          status: resp.status,
          body,
          headers: {
            'content-type':
              resp.headers.get('content-type') || 'application/octet-stream',
            'access-control-allow-origin': '*',
          },
        });
      } catch {
        await route.abort();
      }
    }
  );
}

try {
  await page.goto(`${BASE}/?accession=P05067`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('.category-label', { timeout: 90000 });
  await page.waitForSelector('nightingale-structure', { timeout: 60000 });
} catch (error) {
  await bail('initial render', error);
}
await page.waitForTimeout(3000);

// ---------- Go-to box ----------
const form = await page.$('.protvista-goto');
check('goto box rendered', Boolean(form));
if (form) {
  const fb = await form.boundingBox();
  const mb = await (await page.$('nightingale-manager')).boundingBox();
  check(
    'goto box does not overlap the viewer',
    fb.y + fb.height <= mb.y + 2,
    `form bottom=${Math.round(fb.y + fb.height)} viewer top=${Math.round(mb.y)}`
  );
}
await page.fill('#protvista-goto-input', '185V'); // residue 185 of P05067 is V
await page.click('.protvista-goto button');
await page.waitForTimeout(1500);
const nav = await page.$('nightingale-navigation');
{
  const ds = Number(await nav.getAttribute('display-start'));
  const de = Number(await nav.getAttribute('display-end'));
  check(
    'goto 185V moves the window',
    ds <= 185 && de >= 185 && de - ds + 1 >= 21 && de - ds < 200,
    `window ${ds}-${de}`
  );
}
await page.fill('#protvista-goto-input', '185W');
await page.click('.protvista-goto button');
await page.waitForTimeout(600);
const gotoError = await page
  .$eval('.protvista-goto__error', (el) => el.textContent)
  .catch(() => null);
check(
  'goto 185W refuses with residue mismatch',
  Boolean(gotoError && /not W/i.test(gotoError)),
  (gotoError || '').trim()
);

// ---------- 1D -> 3D: feature click mirrors to structure ----------
const structure = await page.$('nightingale-structure');
const row = await page.$(
  '[data-id="category_MOLECULE_PROCESSING"] nightingale-track-canvas'
);
const box = await row.boundingBox();
await page.evaluate(() => {
  window.__sawFeatureHover = false;
  document
    .querySelector('protvista-uniprot')
    .addEventListener('change', (e) => {
      if (e.detail?.eventType === 'mouseover' && e.detail?.feature) {
        window.__sawFeatureHover = true;
      }
    });
});
let hit = null;
outer: for (const fy of [0.25, 0.4, 0.5, 0.6, 0.75]) {
  for (const fx of [0.3, 0.5, 0.7]) {
    const x = box.x + box.width * fx;
    const y = box.y + box.height * fy;
    await page.mouse.move(x, y);
    await page.waitForTimeout(250);
    if (await page.evaluate(() => window.__sawFeatureHover)) {
      hit = { x, y };
      break outer;
    }
  }
}
check('found a clickable feature on canvas', Boolean(hit));
if (hit) {
  await page.mouse.click(hit.x, hit.y);
  await page.waitForTimeout(1200);
  const hl = await structure.getAttribute('highlight');
  check(
    'feature click mirrors range onto the structure',
    Boolean(hl),
    `highlight="${hl || ''}"`
  );
  check(
    'click tooltip opens',
    Boolean(await page.$('.protvista-uniprot-tooltip'))
  );
  // click the document body itself: any viewport coordinate near the top
  // lands inside the component (goto box), which is not an outside click
  await page.evaluate(() => document.body.click());
  await page.waitForTimeout(800);
  check(
    'outside click clears tooltip and structure highlight',
    !(await structure.getAttribute('highlight')) &&
      !(await page.$('.protvista-uniprot-tooltip'))
  );
}

// ---------- 3D checkbox: whole-track group highlight ----------
await page.click('.category-label[data-category-toggle="DOMAINS"]');
await page.waitForTimeout(2500);
const checkbox = await page.$('.structure-toggle input');
check('3D checkbox rendered on expanded track', Boolean(checkbox));
if (checkbox) {
  await checkbox.click();
  await page.waitForTimeout(1200);
  const hl = await structure.getAttribute('highlight');
  check(
    '3D checkbox puts the track group on the structure',
    Boolean(hl),
    `highlight="${(hl || '').slice(0, 50)}"`
  );
  await checkbox.click();
  await page.waitForTimeout(800);
  check(
    'unchecking clears the group highlight',
    !(await structure.getAttribute('highlight'))
  );
}

// ---------- 3D -> 1D: structure selection navigates the view ----------
await page.evaluate(() => {
  document.querySelector('nightingale-structure').dispatchEvent(
    new CustomEvent('change', {
      detail: { highlight: '100:150' },
      bubbles: true,
      cancelable: true,
    })
  );
});
await page.waitForTimeout(1200);
{
  const ds = Number(await nav.getAttribute('display-start'));
  const de = Number(await nav.getAttribute('display-end'));
  check(
    '3D selection navigates the 1D view',
    ds <= 100 && de >= 150 && de - ds < 200,
    `window ${ds}-${de}`
  );
}

await browser.close();

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
if (consoleErrors.length) {
  console.log(
    `\nPage errors (${consoleErrors.length}):\n` +
      [...new Set(consoleErrors)].slice(0, 5).join('\n')
  );
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
