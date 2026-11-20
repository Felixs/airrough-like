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
await page.keyboard.press('s'); // show the Stand tiles
await settle();
await page.screenshot({ path: out('build-mode') });
await page.keyboard.press('t');

// Leaving Build Mode with an unconfirmed change asks whether to build it: draw a Taxiway between the two links
// (tiles 18..32, row 15), then click Overview. The canvas tells where tiles are on screen.
const map = await page.$('.build-map canvas');
const box = await map.boundingBox();
const tiles = JSON.parse(await map.evaluate((c) => c.dataset.tiles));
const at = (x, y) => [box.x + tiles.x + (x + 0.5) * tiles.size, box.y + tiles.y + (y + 0.5) * tiles.size];
await page.mouse.move(...at(18, 15));
await page.mouse.down();
await page.mouse.move(...at(32, 15), { steps: 8 });
await page.mouse.up();
await settle();
if (!(await page.$('.pending li:not(.empty)'))) throw new Error('The scripted Taxiway was not placed; adjust its screen position');
await page.click('.plan-head [data-tab="overview"]');
await page.waitForSelector('.confirm-dialog');
await settle();
await page.screenshot({ path: out('build-confirm') });
await page.click('.confirm-dialog [data-choice="discard"]');
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
// Dawn: the first aircraft moving in the dark, to show the aircraft lights
await until('05:40', 90_000);
await page.click('[data-speed="1"]');
const moving = async () => page.$$eval('.strips[data-group="ground"] li .t', (els) =>
  els.some((el) => ['Landing', 'Taxi in', 'Taxi out', 'Hold short', 'Takeoff'].includes(el.textContent ?? '')));
for (const start = Date.now(); !(await moving()) && (await clock()) < '06:30' && Date.now() - start < 60_000;) {
  await page.waitForTimeout(100);
}
await page.click('[data-speed="0"]');
await settle(800);
await page.screenshot({ path: out('live-day-dawn') });
await page.click('[data-speed="8"]');
await until('08:40', 90_000);
await page.click('[data-speed="0"]');
// pick a taxiing aircraft from the flight strips: it is ringed on the map
const taxiing = await page.$('.strips[data-group="ground"] li[data-id]');
if (taxiing) await taxiing.click();
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
