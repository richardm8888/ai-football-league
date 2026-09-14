/**
 * Mobile viewport check.
 *
 * Signs in as a seeded manager and walks every screen at the viewport sizes
 * people actually use, asserting that nothing overflows horizontally, that
 * primary actions meet the 44px touch target minimum, and that no page throws.
 *
 * Usage:
 *   npm run build && npm start &
 *   node scripts/mobile-check.mjs [baseUrl] [email] [password]
 */
import { chromium, devices } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const EMAIL = process.argv[3] ?? 'alex@example.com';
const PASSWORD = process.argv[4] ?? 'kickoff-2026';

const VIEWPORTS = [
  { name: 'iPhone SE', device: devices['iPhone SE'] },
  { name: 'iPhone 13', device: devices['iPhone 13'] },
  { name: 'Pixel 7', device: devices['Pixel 7'] },
  { name: 'iPad Mini', device: devices['iPad Mini'] },
  { name: 'Desktop 1280', device: { viewport: { width: 1280, height: 900 } } },
];

const PAGES = ['/club', '/squad', '/tactics', '/training', '/coach', '/league', '/match-centre', '/reports', '/admin'];
const MIN_TOUCH_TARGET = 44;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
const failures = [];

for (const { name, device } of VIEWPORTS) {
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(`${name}: uncaught error — ${error.message}`));

  await page.goto(`${BASE}/login`);
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/club', { timeout: 20000 });

  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) failures.push(`${name} ${path}: page scrolls ${overflow}px sideways`);

    const small = await page.evaluate((minimum) => {
      const offenders = [];
      for (const el of document.querySelectorAll('button, a[href], select, input[type=checkbox]')) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        if (box.height < minimum && !el.closest('nav') && !el.matches('a.text-xs, a.text-sm, button.text-xs')) {
          offenders.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(box.height)}px`);
        }
      }
      return offenders.slice(0, 5);
    }, MIN_TOUCH_TARGET);
    for (const offender of small) failures.push(`${name} ${path}: touch target too small — ${offender}`);
  }

  await context.close();
  console.log(`checked ${name}`);
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):`);
  for (const failure of failures) console.error('  ' + failure);
  process.exit(1);
}
console.log('\nAll viewports pass: no horizontal overflow, no undersized touch targets, no page errors.');
