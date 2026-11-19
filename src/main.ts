import { Application } from 'pixi.js';
import './style.css';
import { drawAirfield, fitToScreen } from './render/airfield';
import { advance, createDay, formatClock, isDayOver, type Speed } from './sim/clock';
import { startingAirport } from './sim/layout';
import { mountTopBar } from './ui/topBar';

async function start(): Promise<void> {
  const mapEl = document.querySelector<HTMLElement>('#map')!;
  const app = new Application();
  await app.init({ resizeTo: mapEl, background: '#0b1210', antialias: true, autoDensity: true, resolution: window.devicePixelRatio });
  mapEl.appendChild(app.canvas);

  const layout = startingAirport();
  const airfield = drawAirfield(layout);
  app.stage.addChild(airfield);
  const fit = () => fitToScreen(airfield, layout, app.screen.width, app.screen.height);
  fit();
  app.renderer.on('resize', fit);

  let day = createDay();
  let speed: Speed = 1;
  const topBar = mountTopBar(document.querySelector<HTMLElement>('#top-bar')!, speed, (s) => (speed = s));

  app.ticker.add((ticker) => {
    day = advance(day, ticker.deltaMS, speed);
    topBar.showClock(formatClock(day), isDayOver(day));
  });
}

void start();
