import './style.css';
import { airportBounds } from './render/bounds';
import { AirportView } from './render/view';
import { advance, formatClock, isDayOver, REAL_TIME, stepFraction, type Speed } from './sim/clock';
import { buyUpgrade } from './sim/plan';
import { continueEndless, dayPlan, dayTwists, endDay, runInfo, setBonusTwist, startLiveDay, startRun, type RunState } from './sim/run';
import { acknowledgeAlert, daySettled, resolveFuel, finishDay, runTo, useAction, type Simulation } from './sim/simulation';
import { dayName, showScoreScreen } from './ui/dayEnd';
import { mountLiveDay } from './ui/liveDay';
import { showOptionsDialog } from './ui/options';
import { showPlanMode } from './ui/planMode';
import { mountTopBar } from './ui/topBar';
import { MusicPlayer } from './audio/music';
import { type Options, browserStore, clearRun, loadMeta, loadOptions, loadRun, reduceMotion, resetProgress, saveMeta, saveOptions, saveRun } from './sim/save';
import { awardRun } from './sim/meta';
import { showMainMenu } from './ui/mainMenu';
import { showDayReport } from './ui/dayReport';
import { showNotice } from './ui/resume';
import { BUILD, copyText } from './ui/seed';

// `?seed=123` makes every New Run use that seed (used for README screenshots and bug reports).
const fixedSeed = Number(new URLSearchParams(location.search).get('seed'));
const newSeed = () => (Number.isFinite(fixedSeed) && fixedSeed > 0 ? fixedSeed : Math.floor(Math.random() * 2 ** 31));

async function start(): Promise<void> {
  const appEl = document.querySelector<HTMLElement>('#app')!;
  const mapEl = document.querySelector<HTMLElement>('#map')!;
  // the airfield in 3D (Babylon.js): a fixed top-down view of the whole airport
  const view = new AirportView(mapEl, 'live');

  const store = browserStore();
  let meta = loadMeta(store);
  let options = loadOptions(store);
  const music = new MusicPlayer();
  const applyMusic = () => {
    music.setVolume((options.musicVolume ?? 40) / 100);
    music.setChoice(options.music ?? 'random');
  };
  applyMusic();
  // browsers start audio only after a click or key press
  for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => music.unlock());
  document.addEventListener('visibilitychange', () => music.setHidden(document.hidden && !options.runInBackground));
  let run: RunState = startRun(newSeed(), meta);
  let sim: Simulation = startLiveDay(run);
  let quota = dayPlan(run).quota;
  let ended = true; // the Run opens in Plan Mode

  /** Shows the Run's layout (rebuilt only when it changed), framed to the whole airport. */
  const mountAirfield = () => {
    view.setLayout(run.layout);
    view.fit(airportBounds(run.layout));
  };
  mountAirfield();
  document.querySelector('#view-reset')!.addEventListener('click', () => view.resetCamera());

  let speed: Speed = 1;
  let lastRunning: Speed = 1; // what Space resumes to
  let speedReady = false;
  const topBar = mountTopBar(document.querySelector<HTMLElement>('#top-bar')!, speed, (s) => {
    speed = s;
    if (s !== 0) lastRunning = s;
    // Remember the last speed played at (not a pause, not Live), so the next Day starts at it.
    if (speedReady && (s === 1 || s === 2 || s === 4 || s === 8) && s !== options.defaultSpeed) {
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
    onFuelChoice(choice) {
      sim = resolveFuel(sim, choice);
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
      onOpenOptions: () => openOptions(),
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
      onOptions: (next) => applyOptions(next),
      onResetProgress() {
        resetProgress(store);
        meta = loadMeta(store);
        openMenu();
      },
    });
  };
  openMenu();

  // Reduce motion (Options, else the system setting), refreshed when the system setting changes
  let calmLights = reduceMotion(options);
  if (typeof matchMedia === 'function') matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => (calmLights = reduceMotion(options)));

  /** Takes new Options from the Main Menu or the in-game dialog. */
  const applyOptions = (next: Options) => {
    options = next;
    saveOptions(store, options);
    autoSlow.checked = options.autoSlow;
    calmLights = reduceMotion(options);
    applyMusic();
    if (!ended) sim = { ...sim, pauseOnEvents: options.eventPopups };
  };
  /** The Options over the game (Plan Mode or a Live Day); a running Day pauses while it is open. */
  const openOptions = () => {
    if (document.querySelector('.options-dialog')) return;
    const before = speed;
    if (!ended) topBar.setSpeed(0);
    showOptionsDialog(document.body, options, applyOptions, () => {
      if (!ended && before !== 0) topBar.setSpeed(before);
    });
  };
  document.querySelector('#options-button')!.addEventListener('click', openOptions);
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if ((e.key === 'o' || e.key === 'O') && !e.ctrlKey && !e.metaKey && !e.altKey && !['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
      && !document.querySelector('.menu')) openOptions();
  });

  // Live Day keys: Space pause/resume, 1–5 Live / 1× / 2× / 4× / 8×, D / M answer a low-fuel decision, V resets the camera
  const SPEED_KEYS: Record<string, Speed> = { '1': REAL_TIME, '2': 1, '3': 2, '4': 4, '5': 8 };
  window.addEventListener('keydown', (e) => {
    if (ended || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, select, textarea')) return;
    const key = e.key.toLowerCase();
    if (sim.pendingAlert?.kind === 'fuel' && (key === 'd' || key === 'm')) {
      e.preventDefault();
      sim = resolveFuel(sim, key === 'd' ? 'divert' : 'mayday');
    } else if (e.key === ' ' && !target.closest('button')) {
      e.preventDefault();
      topBar.setSpeed(speed === 0 ? lastRunning : 0);
    } else if (SPEED_KEYS[e.key] !== undefined) {
      topBar.setSpeed(SPEED_KEYS[e.key]!);
    } else if (key === 'v') {
      view.resetCamera();
    }
  });

  /** Runs the Day on by `realMs` of real time. */
  const play = (realMs: number) => {
    // Auto-slow: watch landings and takeoffs at 1×, rush through the quiet minutes.
    const moving = sim.flights.some((f) => f.phase === 'landing' || f.phase === 'takeoff');
    const effective: Speed = autoSlow.checked && moving && speed > 1 ? 1 : speed;
    document.querySelector('.speed')?.classList.toggle('slowed', effective !== speed);
    if (!ended) sim = runTo(sim, advance(sim.clock, realMs, effective));
    // Nothing left to happen today (last departure gone, the rest parked for the night): end the Day now.
    if (!ended && !sim.pendingAlert && daySettled(sim)) sim = finishDay(sim);
  };
  // A hidden tab gets no animation frames, so the Day stops; with "Keep running in the background" a timer runs it
  // on by the real time that passed (drawing catches up when the tab is shown again).
  let lastBackground = performance.now();
  setInterval(() => {
    const now = performance.now();
    const elapsed = now - lastBackground;
    lastBackground = now;
    if (document.hidden && options.runInBackground) play(Math.min(elapsed, 5_000));
  }, 1_000);
  let frames = 0;
  view.onFrame((ms) => {
    lastBackground = performance.now();
    play(Math.min(ms, 100));
    view.aircraft.calm = calmLights;
    view.aircraft.highlight = liveDay.highlighted();
    const darkness = view.setTime(ended ? null : sim.clock.minute);
    view.aircraft.update(sim.flights, darkness, performance.now(), sim.clock.minute, stepFraction(sim.clock), view.cabinLight());
    // between Days, build the aircraft models a Day may need, one at a time, so none stutters on first sight
    if (ended && ++frames % 20 === 0) view.aircraft.prewarmStep();
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
