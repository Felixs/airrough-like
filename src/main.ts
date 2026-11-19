import { Application } from 'pixi.js';
import './style.css';
import { drawAirfield, fitToScreen } from './render/airfield';
import { FlightLayer } from './render/flights';
import { advance, formatClock, isDayOver, type Speed } from './sim/clock';
import { buyUpgrade } from './sim/plan';
import { dayPlan, endDay, startLiveDay, startRun, type RunState } from './sim/run';
import { acknowledgeAlert, runTo, useAction, type Simulation } from './sim/simulation';
import { dayName, showDayEnd } from './ui/dayEnd';
import { mountLiveDay } from './ui/liveDay';
import { showPlanMode } from './ui/planMode';
import { mountTopBar } from './ui/topBar';

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
    dayLabel.textContent = dayName(run.week, run.weekday);
    mountAirfield();
  };
  const openPlan = () => {
    dayLabel.textContent = dayName(run.week, run.weekday);
    mountAirfield();
    showPlanMode(appEl, run, {
      onBuy(id) {
        run = buyUpgrade(run, id);
        return run;
      },
      onBuilt(next) {
        run = next;
        mountAirfield();
      },
      onStartDay: beginDay,
    });
  };
  openPlan();

  app.ticker.add((ticker) => {
    if (!ended) sim = runTo(sim, advance(sim.clock, ticker.deltaMS, speed));
    flightLayer.update(sim.flights);
    topBar.showClock(formatClock(sim.clock), isDayOver(sim.clock));
    liveDay.update(sim, quota);
    if (!ended && isDayOver(sim.clock)) {
      ended = true;
      run = endDay(run, sim);
      if (run.status === 'lost') {
        showDayEnd(appEl, run, () => {}, () => {
          run = startRun(newSeed());
          openPlan();
        });
      } else {
        openPlan();
      }
    }
  });
}

void start();
