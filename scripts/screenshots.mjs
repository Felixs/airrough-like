// Takes the README screenshots: serves the production build, plays through it in headless Chromium
// and saves PNGs to docs/screenshots/. Run after `npm run build`:
//   npx vite preview --port 4173 & node scripts/screenshots.mjs
// With SHOTS=buildings only the building close-ups (look/wings-*, support-*, facing-*) are taken.
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

// `SHOTS=buildings` takes only the building close-ups (a quick check after changing the buildings)
const buildingsOnly = process.env.SHOTS === 'buildings';
if (!buildingsOnly) {
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
}

// ---- The look: the Live Day at five times of day, and close-ups, all at the best quality and 1.5x pixel density.
// The Day plays at Low quality (software rendering is slow); each picture switches to High and waits for it to draw.
const look = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
const lp = await look.newPage();
lp.setDefaultTimeout(180_000); // a frame at the best quality takes seconds with software rendering
lp.on('pageerror', (e) => console.error('page error:', e.message));
await lp.goto(`${url}?seed=7&debug&quality=low`);
await lp.waitForSelector('.menu-card');
await lp.click('[data-tab="options"]');
await lp.uncheck('input[data-opt="eventPopups"]');
await lp.click('[data-tab="play"]');
await lp.click('[data-go="new"]');
await lp.waitForSelector('.start');
await lp.click('.start');
await lp.uncheck('#auto-slow');
await lp.addStyleTag({ content: '.clean :is(#top-bar, .rail, .panel, .hours, .chips) { visibility: hidden !important; }' });
const lookClock = () => lp.$eval('#clock', (el) => el.textContent ?? '');
// speed buttons are pressed in the page itself: the Playwright click waits for frames, which are slow here
const speedTo = async (s) => {
  const cover = await lp.$eval(`[data-speed="${s}"]`, (b) => {
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    b.click();
    return top && top !== b && !b.contains(top) ? `${top.tagName}.${top.className}` : '';
  });
  if (cover) console.warn(`speed ${s}: the button is covered by ${cover}`);
};
const playTo = async (time) => {
  // watched and paused inside the page: Playwright's own clicks wait for frames and let the Day run on meanwhile
  await lp.evaluate(
    (time) =>
      new Promise((done) => {
        document.querySelector('[data-speed="8"]').click();
        const tick = () => {
          document.querySelector('#alert-banner:not([hidden]) button[data-ack]')?.click();
          if ((document.querySelector('#clock').textContent ?? '') < time) return void setTimeout(tick, 20);
          document.querySelector('[data-speed="0"]').click();
          done();
        };
        tick();
      }),
    time,
  );
};
/** Aims the camera (null: the starting view over the whole airport) and saves a picture at High quality. */
const best = (name, aim = null, clean = true) =>
  takeBest(name, aim, clean).catch(async (e) => {
    console.error(`look/${name} failed: ${e.message}`);
    await lp.evaluate(() => {
      window.aab.view.setQuality('low');
      document.documentElement.classList.remove('clean');
    });
  });
const takeBest = async (name, aim, clean) => {
  const ok = await lp.evaluate(([aim, clean]) => {
    document.documentElement.classList.toggle('clean', clean);
    const { view, sim, layout } = window.aab;
    if (!aim) {
      view.resetCamera();
      return true;
    }
    const T = 8; // TILE_SIZE
    const flights = sim().flights.filter((f) => f.position);
    const big = ['B748F', 'B77W', 'A350', 'B738F', 'B738', 'A320', 'Q400', 'C208F', 'C208']; // the biggest aircraft first
    const rank = (f) => (big.includes(f.type) ? big.indexOf(f.type) : big.length);
    const pick = (phases) => flights.filter((f) => phases.includes(f.phase)).sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0];
    const terminal = layout().structures.find((s) => s.kind === 'terminal');
    const centre = (r) => ({ x: (r.x + r.w / 2) * T, y: (r.y + r.h / 2) * T });
    if (aim.what === 'airport') {
      // straight down over the starting view's centre (the camera is private in TypeScript, plain here)
      view.resetCamera();
      const c = view.camera;
      view.lookAt(c.target.x, -c.target.z, c.radius * aim.r, aim.a, aim.b);
      return true;
    }
    if (aim.what === 'tile') {
      view.lookAt(aim.x * T, aim.y * T, aim.r, aim.a, aim.b);
      return true;
    }
    const f = aim.what === 'parked' ? pick(['onStand']) : aim.what === 'moving' ? pick(['taxiIn', 'taxiOut', 'holdShort']) : null;
    const at = f ? f.position : terminal ? centre(terminal) : null;
    if (!at) return false;
    view.lookAt(at.x, at.y, aim.r, aim.a, aim.b);
    return Boolean(f) || aim.what === 'terminal';
  }, [aim, clean]);
  if (!ok) console.warn(`${name}: nothing to aim at; framed the Terminal instead`);
  await lp.evaluate(() => window.aab.view.setQuality('high'));
  const from = await lp.evaluate(() => window.aab.frames());
  await lp.waitForFunction((from) => window.aab.frames() >= from + 5, from, { timeout: 180_000, polling: 500 });
  await lp.screenshot({ path: `docs/screenshots/look/${name}.jpg`, type: 'jpeg', quality: 90 });
  await lp.evaluate(() => {
    window.aab.view.setQuality('low');
    document.documentElement.classList.remove('clean'); // the speed buttons again
  });
  console.log(`look/${name}: ${await lookClock()}`);
};
const parked = (a, b = 1.15, r = 34) => ({ what: 'parked', r, a, b });
const terminal = (a, b = 0.95) => ({ what: 'terminal', r: 95, a, b });
/** A point of the map in tiles. */
const tile = (x, y, r, a, b = 0.95) => ({ what: 'tile', x, y, r, a, b });

// ---- Buildings a Day 1 airport lacks, drawn in place of the Run's layout (`aab.showLayout`; only the picture changes):
// the Terminal and the Cargo Hub grown by two wings each (they merge into one building each and meet), and away from
// the Starting Airport every Support Building facing south, a Terminal facing north (its Stands on its north side), a
// Cargo Hub facing east and every Support Building again facing west.
const showBuilt = () =>
  lp.evaluate(() => {
    const roles = ['rampAgentStation', 'adminOffice', 'airlineOffice', 'fireRescueStation', 'fuelFarm', 'deIcingPad'];
    const stand = (id, x, y, serves, facing = 'south', size = 'medium') =>
      ({ kind: 'stand', id, x, y, w: size === 'small' ? 2 : 3, h: 3, size, serves, placement: 'contact', facing });
    const structures = window.aab.layout().structures.map((s) =>
      s.kind === 'terminal' ? { ...s, w: s.w + 6 } : s.kind === 'cargoHub' ? { ...s, x: s.x - 6, w: s.w + 6 } : s);
    const terminal = structures.find((s) => s.kind === 'terminal');
    const cargo = structures.find((s) => s.kind === 'cargoHub');
    const sy = terminal.y + terminal.h;
    structures.push(
      // Contact Stands under the wings
      stand('W1', terminal.x + terminal.w - 6, sy, 'terminal'), stand('W2', terminal.x + terminal.w - 3, sy, 'terminal'),
      stand('W3', cargo.x, sy, 'cargoHub'), stand('W4', cargo.x + 3, sy, 'cargoHub'),
      // south of the Runway: a Taxiway, a Terminal facing north, and every Support Building (facing south)
      { kind: 'taxiway', x: 6, y: 28, w: 36, h: 3 },
      stand('N1', 10, 31, 'terminal', 'north', 'small'), stand('N2', 12, 31, 'terminal', 'north'), stand('N3', 15, 31, 'terminal', 'north'),
      { kind: 'terminal', x: 10, y: 34, w: 10, h: 4 },
      ...roles.map((role, i) => ({ kind: 'supportBuilding', role, x: 22 + i * 4, y: 34, w: 3, h: 2 })),
      // east: a Cargo Hub facing east, a Taxiway, and every Support Building facing west onto it
      { kind: 'cargoHub', x: 46, y: 0, w: 4, h: 7 },
      stand('E1', 50, 0, 'cargoHub', 'east'), stand('E2', 50, 3, 'cargoHub', 'east'),
      { kind: 'taxiway', x: 53, y: -2, w: 3, h: 22 },
      ...roles.map((role, i) => ({ kind: 'supportBuilding', role, x: 56, y: i * 3, w: 3, h: 2 })),
    );
    window.aab.showLayout(structures);
  });
const showRun = () => lp.evaluate(() => window.aab.showLayout());
const builtByDay = async () => {
  await showBuilt();
  await best('wings-day', tile(24, 6, 120, -Math.PI / 2 + 0.45));
  await best('support-day', tile(33, 35, 125, -Math.PI / 2 + 0.35, 1.0));
  await best('facing-north', tile(15, 33, 105, Math.PI / 2 - 0.45));
  await best('facing-east', tile(48, 3.5, 100, 0.35));
  await best('facing-west', tile(57, 8.5, 105, Math.PI - 0.35));
  await showRun();
};
const builtByNight = async () => {
  await showBuilt();
  await best('support-night', tile(33, 35, 125, -Math.PI / 2 + 0.35, 1.0));
  await best('wings-night', tile(24, 6, 120, -Math.PI / 2 + 0.45));
  await showRun();
};

if (buildingsOnly) {
  await playTo('12:30');
  await builtByDay();
  await playTo('21:15');
  await builtByNight();
  await browser.close();
  console.log('building screenshots saved to docs/screenshots/look/');
  process.exit(0);
}

await playTo('05:45');
await best('1-dawn', null, false);
await playTo('08:30');
await best('2-morning', null, false);
await best('parked-morning', parked(-Math.PI / 2 - 0.7));
await best('overhead', { what: 'airport', r: 1.1, a: -Math.PI / 2, b: 0.12 });
await playTo('12:30');
await best('3-midday', null, false);
await best('terminal-midday', terminal(-Math.PI / 2 + 0.6));
await builtByDay();
// wait at 1x for an aircraft on the move
await speedTo('1');
await lp.waitForFunction(() => window.aab.sim().flights.some((f) => f.position && ['taxiIn', 'taxiOut', 'holdShort'].includes(f.phase)), null, { timeout: 120_000, polling: 200 }).catch(() => {});
await speedTo('0');
await best('taxiing-midday', { what: 'moving', r: 40, a: -Math.PI / 2 + 0.9, b: 1.2 });
await playTo('19:15');
await best('4-evening', null, false);
await best('parked-evening', parked(Math.PI / 2 + 0.6, 1.2, 40));
await playTo('21:15'); // on Day 1 a curfew ends traffic before 22:00, and the Day then skips to its end
await best('5-night', null, false);
await best('parked-night', parked(-Math.PI / 2 - 0.7));
await best('terminal-night', terminal(-Math.PI / 2 + 0.6, 1.05));
await builtByNight();

await browser.close();
console.log('screenshots saved to docs/screenshots/');
