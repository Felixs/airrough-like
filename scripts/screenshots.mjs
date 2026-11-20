// Takes the README screenshots: serves the production build, plays through it in headless Chromium
// and saves PNGs to docs/screenshots/. Run after `npm run build`:
//   npx vite preview --port 4173 & node scripts/screenshots.mjs
import { chromium } from 'playwright';

const url = process.env.GAME_URL ?? 'http://localhost:4173/';
const out = (name) => `docs/screenshots/${name}.png`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`${url}?seed=7`);
await page.evaluate(() => localStorage.clear());
await page.goto(`${url}?seed=7`);
const settle = (ms = 600) => page.waitForTimeout(ms);

// Main Menu
await page.waitForSelector('.menu-card');
await settle();
await page.screenshot({ path: out('main-menu') });
await page.click('[data-tab="shop"]');
await settle(300);
await page.screenshot({ path: out('unlockables-boosts') });

// No pop-ups while we fast-forward, then a New Run
await page.click('[data-tab="options"]');
await page.uncheck('input[data-opt="eventPopups"]');
await page.click('[data-tab="play"]');
await page.click('[data-go="new"]');

// Plan Mode: Overview and Build
await page.waitForSelector('.plan-body');
await settle();
await page.screenshot({ path: out('plan-mode') });
await page.click('.plan-head [data-tab="build"]');
await page.waitForSelector('.build-map canvas');
await settle(1200);
await page.screenshot({ path: out('build-mode') });
await page.click('.plan-head [data-tab="overview"]');
await page.waitForSelector('.start');
await page.click('.start');

// Live Day: fast-forward to the morning peak, then pause
await page.uncheck('#auto-slow');
await page.click('[data-speed="8"]');
const clock = () => page.$eval('#clock', (el) => el.textContent ?? '');
const until = async (time, limitMs) => {
  const start = Date.now();
  while ((await clock()) < time && Date.now() - start < limitMs) {
    const ack = await page.$('#alert-banner:not([hidden]) button[data-ack]');
    if (ack) await ack.click();
    await page.waitForTimeout(150);
  }
};
await until('08:40', 90_000);
await page.click('[data-speed="0"]');
await settle(800);
await page.screenshot({ path: out('live-day') });

// End of the Day: the Day report
await page.click('[data-speed="8"]');
const start = Date.now();
while (!(await page.$('.report')) && Date.now() - start < 180_000) {
  const ack = await page.$('#alert-banner:not([hidden]) button[data-ack]');
  if (ack) await ack.click();
  await page.waitForTimeout(250);
}
await settle();
await page.screenshot({ path: out('day-report') });

await browser.close();
console.log('screenshots saved to docs/screenshots/');
