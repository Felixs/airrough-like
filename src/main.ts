import { Application, Graphics } from 'pixi.js';
import './style.css';
import { drawAirfield, fitToScreen } from './render/airfield';
import { FlightLayer } from './render/flights';
import { advance, daylight, formatClock, isDayOver, type Speed } from './sim/clock';
import { buyUpgrade } from './sim/plan';
import { continueEndless, dayPlan, dayTwists, endDay, runInfo, setBonusTwist, startLiveDay, startRun, type RunState } from './sim/run';
import { acknowledgeAlert, daySettled, finishDay, runTo, useAction, type Simulation } from './sim/simulation';
import { dayName, showScoreScreen } from './ui/dayEnd';
import { mountLiveDay } from './ui/liveDay';
import { showPlanMode } from './ui/planMode';
import { mountTopBar } from './ui/topBar';
import { browserStore, clearRun, loadMeta, loadOptions, loadRun, resetProgress, saveMeta, saveOptions, saveRun } from './sim/save';
import { awardRun } from './sim/meta';
import { showMainMenu } from './ui/mainMenu';
import { showDayReport } from './ui/dayReport';
import { showNotice } from './ui/resume';
import { BUILD, copyText } from './ui/seed';
import { TILE_SIZE, WORLD } from './sim/layout';

// `?seed=123` makes every New Run use that seed (used for README screenshots and bug reports).
const fixedSeed = Number(new URLSearchParams(location.search).get('seed'));
const newSeed = () => (Number.isFinite(fixedSeed) && fixedSeed > 0 ? fixedSeed : Math.floor(Math.random() * 2 ** 31));

async function start(): Promise<void> {
  const appEl = document.querySelector<HTMLElement>('#app')!;
  const mapEl = document.querySelector<HTMLElement>('#map')!;
  const app = new Application();
  await app.init({ resizeTo: mapEl, background: '#0b1210', antialias: true, autoDensity: true, resolution: window.devicePixelRatio });
  mapEl.appendChild(app.canvas);

  const store = browserStore();
  let meta = loadMeta(store);
  let options = loadOptions(store);
  let run: RunState = startRun(newSeed(), meta);
  let sim: Simulation = startLiveDay(run);
  let quota = dayPlan(run).quota;
  let ended = true; // the Run opens in Plan Mode

  const flightLayer = new FlightLayer();
  // Daylight: a tint over the map (and the aircraft) that follows the Live Day's clock.
  const light = new Graphics();
  light.rect(WORLD.x0 * TILE_SIZE, WORLD.y0 * TILE_SIZE, WORLD.width * TILE_SIZE, WORLD.height * TILE_SIZE).fill(0xffffff);
  light.eventMode = 'none';
  const showDaylight = (minute: number | null) => {
    const { darkness, warmth } = minute === null ? { darkness: 0, warmth: 0 } : daylight(minute);
    const mix = (a: number, b: number) => Math.round(a + (b - a) * warmth);
    light.tint = (mix(0x04, 0x3a) << 16) | (mix(0x0a, 0x1c) << 8) | mix(0x1e, 0x08);
    light.alpha = darkness;
  };
  let airfield = drawAirfield(run.layout);
  const fit = () => fitToScreen(airfield, run.layout, app.screen.width, app.screen.height);
  const mountAirfield = () => {
    airfield.removeChild(flightLayer.container, light);
    airfield.destroy({ children: true });
    airfield = drawAirfield(run.layout);
    airfield.addChild(flightLayer.container, light);
    app.stage.addChild(airfield);
    fit();
  };
  airfield.addChild(flightLayer.container, light);
  app.stage.addChild(airfield);
  fit();
  app.renderer.on('resize', fit);

  let speed: Speed = 1;
  let speedReady = false;
  const topBar = mountTopBar(document.querySelector<HTMLElement>('#top-bar')!, speed, (s) => {
    speed = s;
    // Remember the last speed played at (not a pause), so the next Day starts at it.
    if (speedReady && s !== 0 && s !== options.defaultSpeed) {
      options = { ...options, defaultSpeed: s };
      saveOptions(store, options);
    }
  });
  speedReady = true;
  const dayLabel = document.querySelector<HTMLElement>('#day-name')!;
  const autoSlow = document.querySelector<HTMLInputElement>('#auto-slow')!;
  autoSlow.checked = options.autoSlow;
  autoSlow.addEventListener('change', () => {
    options = { ...options, autoSlow: autoSlow.checked };
    saveOptions(store, options);
  });
  const liveDay = mountLiveDay(appEl, {
    onAction(id, targetId) {
      try {
        sim = useAction(sim, id, targetId);
        liveDay.message('');
      } catch (e) {
        liveDay.message((e as Error).message);
      }
    },
    onAcknowledgeAlert() {
      sim = acknowledgeAlert(sim);
    },
  });

  const beginDay = () => {
    sim = { ...startLiveDay(run), pauseOnEvents: options.eventPopups };
    topBar.setSpeed(options.defaultSpeed);
    quota = dayPlan(run).quota;
    ended = false;
    const twists = dayTwists(run);
    dayLabel.textContent = dayName(run.week, run.weekday) + (run.endless ? ' · Endless' : '') + twists.map((t) => ` · ${t.name}`).join('');
    dayLabel.title = [...twists.map((t) => `${t.name}: ${t.description}`), runInfo(run, BUILD)].join('\n');
    mountAirfield();
  };
  const openPlan = () => {
    saveRun(store, run);
    dayLabel.textContent = dayName(run.week, run.weekday);
    mountAirfield();
    showPlanMode(appEl, run, {
      onBuy(id) {
        run = buyUpgrade(run, id);
        saveRun(store, run);
        return run;
      },
      onBuilt(next) {
        run = next;
        saveRun(store, run);
        mountAirfield();
      },
      onBonusTwist(on) {
        run = setBonusTwist(run, on);
        saveRun(store, run);
        return run;
      },
      onStartDay: beginDay,
    });
  };
  const showScore = () => {
    meta = awardRun(meta, run);
    saveMeta(store, meta);
    showScoreScreen(appEl, run, {
      onFinish() {
        clearRun(store);
        openMenu();
      },
      onEndless() {
        run = continueEndless(run);
        openPlan();
      },
    });
  };

  // Something broke: tell the Player, with the bug-report info to send along.
  const reportError = (message: string) => {
    const info = runInfo(run, BUILD);
    showNotice(appEl, `Something went wrong: ${message}. Bug-report info (copied): ${info}`);
    void copyText(`${info}\nError: ${message}`);
  };
  window.addEventListener('error', (e) => reportError(e.message));
  window.addEventListener('unhandledrejection', (e) => reportError(String((e as PromiseRejectionEvent).reason)));

  const openMenu = () => {
    ended = true;
    const saved = loadRun(store);
    if (saved.kind === 'discarded') showNotice(appEl, saved.reason);
    showMainMenu(appEl, { meta, saved: saved.kind === 'run' ? saved.run : null, options }, {
      onContinue() {
        if (saved.kind !== 'run') return;
        run = saved.run;
        if (run.status === 'won') showScore();
        else openPlan();
      },
      onNewRun(seed) {
        clearRun(store);
        run = startRun(seed ?? newSeed(), meta);
        openPlan();
      },
      onMeta(next) {
        meta = next;
        saveMeta(store, meta);
      },
      onOptions(next) {
        options = next;
        saveOptions(store, options);
        autoSlow.checked = options.autoSlow;
      },
      onResetProgress() {
        resetProgress(store);
        meta = loadMeta(store);
        openMenu();
      },
    });
  };
  openMenu();

  app.ticker.add((ticker) => {
    // Auto-slow: watch landings and takeoffs at 1×, rush through the quiet minutes.
    const moving = sim.flights.some((f) => f.phase === 'landing' || f.phase === 'takeoff');
    const effective: Speed = autoSlow.checked && moving && speed > 1 ? 1 : speed;
    document.querySelector('.speed')?.classList.toggle('slowed', effective !== speed);
    if (!ended) sim = runTo(sim, advance(sim.clock, ticker.deltaMS, effective));
    // Nothing left to happen today (last departure gone, the rest parked for the night): end the Day now.
    if (!ended && !sim.pendingAlert && daySettled(sim)) sim = finishDay(sim);
    flightLayer.update(sim.flights);
    showDaylight(ended ? null : sim.clock.minute);
    topBar.showClock(formatClock(sim.clock), isDayOver(sim.clock));
    liveDay.update(sim, quota);
    if (!ended && isDayOver(sim.clock)) {
      ended = true;
      run = endDay(run, sim);
      if (run.status === 'lost') clearRun(store);
      if (run.status === 'won') saveRun(store, run);
      // Every Day ends with its report; a lost or won Run goes on to the Score Screen.
      showDayReport(appEl, run, () => {
        if (run.status === 'lost' || run.status === 'won') showScore();
        else openPlan();
      });
    }
  });
}

void start();
