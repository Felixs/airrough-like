import { mixSeed } from './random';

/**
 * What went wrong, in a line, for Go-Arounds, Rejected Takeoffs, Incidents and Crashes. Flavour only: the outcome and
 * its cost are rolled by the simulation as before; the story is picked from the event itself (seed, flight, minute),
 * so it draws nothing from the Day's random rolls and a replayed seed tells the same stories.
 */
export type StoryKind = 'goAround' | 'rejectedTakeoff' | 'landingIncident' | 'takeoffIncident' | 'taxiIncident' | 'landingCrash' | 'takeoffCrash' | 'fuelCrash';

/** Stories by kind and by who caused it (the Tower or the crew); taxi and fuel stories have no cause. */
export const STORIES: Record<StoryKind, { readonly atc: readonly string[]; readonly pilot: readonly string[] }> = {
  goAround: {
    atc: [
      'cleared to land while the aircraft ahead was still on the Runway',
      'a vehicle was on the Runway when it reached short final',
      'two stations transmitted at once: the landing clearance never got through',
      'too close behind the aircraft ahead on final',
    ],
    pilot: [
      'unstable approach: too high and too fast on final',
      'wind shear on short final',
      'lost sight of the Runway in a rain shower',
      'bounced on touchdown and powered away',
    ],
  },
  rejectedTakeoff: {
    atc: [
      'the Tower cancelled the takeoff clearance: a vehicle crossed the Runway ahead',
      'radio trouble: the takeoff clearance was never confirmed',
      'a landing aircraft was slow to vacate the far end',
    ],
    pilot: [
      'engine fire warning on the takeoff roll',
      'bird strike on the takeoff roll',
      'a door warning light came on at speed',
      'configuration warning: the flaps were not set',
    ],
  },
  landingIncident: {
    atc: ['landed with a vehicle still near the Runway: a near miss to be reported'],
    pilot: ['a tyre burst on touchdown', 'hard landing: the gear has to be inspected', 'ran wide onto the grass at the exit'],
  },
  takeoffIncident: {
    atc: ['stopped hard for a crossing vehicle: the Runway has to be checked'],
    pilot: ['hot brakes after the rejected takeoff: fire crews cool them', 'a burst tyre left debris on the Runway'],
  },
  taxiIncident: {
    atc: [],
    pilot: [
      'a baggage tug broke down in front of it',
      'took a wrong turn and needs a tow back',
      'a fuel truck is blocking the Taxiway',
      'loose debris found on the Taxiway: a sweeper is on the way',
      'a hydraulic leak: it cannot steer',
      'a wingtip touched a service vehicle',
    ],
  },
  landingCrash: {
    atc: ['cleared onto a Runway that was not clear'],
    pilot: ['landed short of the Runway in a gust', 'the nose gear collapsed on touchdown', 'ran off the end of the Runway'],
  },
  takeoffCrash: {
    atc: ['collided with a vehicle the Tower had cleared across the Runway'],
    pilot: ['an engine failed at rotation', 'overran the end after a late rejected takeoff'],
  },
  fuelCrash: { atc: [], pilot: ['ran out of fuel short of the airport'] },
};

const hash = (text: string) => {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
};

/** The story for one event; empty when there is none for that kind and cause. */
export function storyFor(kind: StoryKind, cause: 'atc' | 'pilot' | null, seed: number, flightId: string, minute: number): string {
  const set = STORIES[kind];
  const pool = cause === 'atc' && set.atc.length ? set.atc : set.pilot.length ? set.pilot : set.atc;
  if (!pool.length) return '';
  return pool[mixSeed(seed, hash(flightId), Math.round(minute * 4), hash(kind)) % pool.length]!;
}
