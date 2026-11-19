import { Application } from 'pixi.js';
import './style.css';
import { drawAirfield, fitToScreen } from './render/airfield';
import { FlightLayer } from './render/flights';
import { advance, formatClock, isDayOver, type Speed } from './sim/clock';
import { startingAirport } from './sim/layout';
import { planDay } from './sim/schedule';
import { createSimulation, runTo } from './sim/simulation';
import { mountTopBar } from './ui/topBar';

async function start(): Promise<void> {
  const mapEl = document.querySelector<HTMLElement>('#map')!;
  const app = new Application();
  await app.init({ resizeTo: mapEl, background: '#0b1210', antialias: true, autoDensity: true, resolution: window.devicePixelRatio });
  mapEl.appendChild(app.canvas);

  const layout = startingAirport();
  const airfield = drawAirfield(layout);
  const flightLayer = new FlightLayer();
  airfield.addChild(flightLayer.container);
  app.stage.addChild(airfield);
  const fit = () => fitToScreen(airfield, layout, app.screen.width, app.screen.height);
  fit();
  app.renderer.on('resize', fit);

  // Week 1 Monday until the Run loop ticket lands.
  const seed = Math.floor(Math.random() * 2 ** 31);
  const plan = planDay({ layout, week: 1, weekday: 0, seed });
  let sim = createSimulation({ layout, seed, schedule: plan.schedule });
  let speed: Speed = 1;
  const topBar = mountTopBar(document.querySelector<HTMLElement>('#top-bar')!, speed, (s) => (speed = s));

  app.ticker.add((ticker) => {
    sim = runTo(sim, advance(sim.clock, ticker.deltaMS, speed));
    flightLayer.update(sim.flights);
    topBar.showClock(formatClock(sim.clock), isDayOver(sim.clock));
    topBar.showStats(sim.money, sim.movements, plan.quota);
  });
}

void start();
