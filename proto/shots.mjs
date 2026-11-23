// Renders the buildings prototype in headless Chromium (software WebGL) and saves pictures to proto/shots/.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('proto/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
page.setDefaultTimeout(180_000);
await page.goto('http://localhost:8000/proto/buildings.html');
await page.waitForFunction(() => window.proto?.ready, null, { timeout: 120_000 });
await page.addStyleTag({ content: '#panel{display:none}' });
const shot = async (name, style, view, hour) => {
  await page.evaluate(([s, v, h]) => { window.proto.setStyle(s); window.proto.view(v); window.proto.setTime(h); }, [style, view, hour]);
  const from = await page.evaluate(() => window.proto.frames());
  await page.waitForFunction((f) => window.proto.frames() >= f + 4, from, { polling: 300 });
  await page.screenshot({ path: `proto/shots/${name}.jpg`, type: 'jpeg', quality: 88 });
  console.log(name);
};
const list = [
  ['deck-game-midday', 'deck', 'Game view', 13], ['deck-airside-midday', 'deck', 'Terminal airside', 13],
  ['deck-airside-dusk', 'deck', 'Terminal airside', 19.8], ['deck-airside-night', 'deck', 'Terminal airside', 22.5],
  ['deck-landside-dawn', 'deck', 'Terminal landside', 6.2], ['overhead-midday', 'deck', 'Overhead', 13],
  ['hall-airside-midday', 'hall', 'Terminal airside', 13], ['hall-airside-night', 'hall', 'Terminal airside', 22.5],
  ['hall-game-dusk', 'hall', 'Game view', 19.8],
  ['cargo-midday', 'deck', 'Cargo Hub', 13], ['cargo-night', 'deck', 'Cargo Hub', 22.5],
  ['tower-dawn', 'deck', 'Tower', 6.2], ['tower-night', 'deck', 'Tower', 22.5],
  ['fire-offices-morning', 'deck', 'Fire & offices', 9], ['fire-offices-night', 'deck', 'Fire & offices', 22.5],
  ['fuel-deicing-midday', 'deck', 'Fuel & de-icing', 13],
];
for (const s of list) await shot(...s).catch((e) => logs.push(`shot ${s[0]} failed: ${e.message}`));
logs.push('errors: ' + JSON.stringify(await page.evaluate(() => window.protoErrors)));
writeFileSync('proto/shots/log.txt', logs.join('\n'));
await browser.close();
