import { Application } from 'pixi.js';
import './style.css';
import { drawAirfield, fitToScreen } from './render/airfield';
import { FlightLayer } from './render/flights';
import { advance, formatClock, isDayOver, type Speed } from './sim/clock';
import { dayPlan, endDay, startLiveDay, startRun, type RunState } from './sim/run';
import { runTo, type Simulation } from './sim/simulation';
import { dayName, showDayEnd } from './ui/dayEnd';
import { mountLiveDay } from './ui/liveDay';
import { mountTopBar } from './ui/topBar';

async function start(): Promise<void> {
  const mapEl = document.querySelector<HTMLElement>('#map')!;
  const app = new Application();
  await app.init({ resizeTo: mapEl, background: '#0b1210', antialias: true, autoDensity: true, resolution: window.devicePixelRatio });
  mapEl.appendChild(app.canvas);

  let run: RunState = startRun(Math.floor(Math.random() * 2 ** 31));
  let sim: Simulation = startLiveDay(run);
  let quota = dayPlan(run).quota;
  let ended = false;

  let airfield = drawAirfield(run.layout);
  const flightLayer = new FlightLayer();
  const mountAirfield = () => {
    airfield.removeChild(flightLayer.container);
    airfield.destroy({ children: true });
    airfield = drawAirfield(run.layout);
    airfield.addChild(flightLayer.container);
    app.stage.addChild(airfield);
    fit();
  };
  const fit = () => fitToScreen(airfield, run.layout, app.screen.width, app.screen.height);
  airfield.addChild(flightLayer.container);
  app.stage.addChild(airfield);
  fit();
  app.renderer.on('resize', fit);

  let speed: Speed = 1;
  const topBar = mountTopBar(document.querySelector<HTMLElement>('#top-bar')!, speed, (s) => (speed = s));
  const dayLabel = document.querySelector<HTMLElement>('#day-name')!;
  const liveDay = mountLiveDay(document.querySelector<HTMLElement>('#app')!);

  const beginDay = () => {
    sim = startLiveDay(run);
    quota = dayPlan(run).quota;
    ended = false;
    dayLabel.textContent = dayName(run.week, run.weekday);
    mountAirfield();
  };
  dayLabel.textContent = dayName(run.week, run.weekday);

  app.ticker.add((ticker) => {
    if (!ended) sim = runTo(sim, advance(sim.clock, ticker.deltaMS, speed));
    flightLayer.update(sim.flights);
    topBar.showClock(formatClock(sim.clock), isDayOver(sim.clock));
    liveDay.update(sim, quota);
    if (!ended && isDayOver(sim.clock)) {
      ended = true;
      run = endDay(run, sim);
      showDayEnd(document.querySelector<HTMLElement>('#app')!, run, beginDay, () => {
        run = startRun(Math.floor(Math.random() * 2 ** 31));
        beginDay();
      });
    }
  });
}

void start();
