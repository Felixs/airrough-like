import { Application } from 'pixi.js';
import './style.css';
import { drawAirfield, fitToScreen } from './render/airfield';
import { FlightLayer } from './render/flights';
import { advance, formatClock, isDayOver, type Speed } from './sim/clock';
import { buyUpgrade } from './sim/plan';
import { continueEndless, dayPlan, dayTwists, endDay, startLiveDay, startRun, type RunState } from './sim/run';
import { acknowledgeAlert, runTo, useAction, type Simulation } from './sim/simulation';
import { dayName, showScoreScreen } from './ui/dayEnd';
import { mountLiveDay } from './ui/liveDay';
import { showPlanMode } from './ui/planMode';
import { mountTopBar } from './ui/topBar';
import { browserStore, clearRun, loadRun, saveRun } from './sim/save';
import { showNotice, showResume } from './ui/resume';

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

async function start(): Promise<void> {
  const appEl = document.querySelector<HTMLElement>('#app')!;
  const mapEl = document.querySelector<HTMLElement>('#map')!;
  const app = new Application();
  await app.init({ resizeTo: mapEl, background: '#0b1210', antialias: true, autoDensity: true, resolution: window.devicePixelRatio });
  mapEl.appendChild(app.canvas);

  let run: RunState = startRun(newSeed());
  let sim: Simulation = startLiveDay(run);
  let quota = dayPlan(run).quota;
  let ended = true; // the Run opens in Plan Mode

  const flightLayer = new FlightLayer();
  let airfield = drawAirfield(run.layout);
  const fit = () => fitToScreen(airfield, run.layout, app.screen.width, app.screen.height);
  const mountAirfield = () => {
    airfield.removeChild(flightLayer.container);
    airfield.destroy({ children: true });
    airfield = drawAirfield(run.layout);
    airfield.addChild(flightLayer.container);
    app.stage.addChild(airfield);
    fit();
  };
  airfield.addChild(flightLayer.container);
  app.stage.addChild(airfield);
  fit();
  app.renderer.on('resize', fit);

  let speed: Speed = 1;
  const topBar = mountTopBar(document.querySelector<HTMLElement>('#top-bar')!, speed, (s) => (speed = s));
  const dayLabel = document.querySelector<HTMLElement>('#day-name')!;
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
    sim = startLiveDay(run);
    quota = dayPlan(run).quota;
    ended = false;
    const twists = dayTwists(run);
    dayLabel.textContent = dayName(run.week, run.weekday) + (run.endless ? ' · Endless' : '') + twists.map((t) => ` · ${t.name}`).join('');
    dayLabel.title = twists.map((t) => `${t.name}: ${t.description}`).join('\n');
    mountAirfield();
  };
  const store = browserStore();
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
      onStartDay: beginDay,
    });
  };
  const showScore = () =>
    showScoreScreen(appEl, run, {
      onNewRun() {
        run = startRun(newSeed());
        openPlan();
      },
      onEndless() {
        run = continueEndless(run);
        openPlan();
      },
    });

  const saved = loadRun(store);
  if (saved.kind === 'discarded') showNotice(appEl, saved.reason);
  if (saved.kind === 'run') {
    showResume(appEl, saved.run, () => {
      run = saved.run;
      if (run.status === 'won') showScore();
      else openPlan();
    }, () => {
      clearRun(store);
      openPlan();
    });
  } else {
    openPlan();
  }

  app.ticker.add((ticker) => {
    if (!ended) sim = runTo(sim, advance(sim.clock, ticker.deltaMS, speed));
    flightLayer.update(sim.flights);
    topBar.showClock(formatClock(sim.clock), isDayOver(sim.clock));
    liveDay.update(sim, quota);
    if (!ended && isDayOver(sim.clock)) {
      ended = true;
      run = endDay(run, sim);
      if (run.status === 'lost') clearRun(store);
      if (run.status === 'won') saveRun(store, run);
      if (run.status === 'lost' || run.status === 'won') {
        showScore();
      } else {
        openPlan();
      }
    }
  });
}

void start();
