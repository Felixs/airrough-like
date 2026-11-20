/**
 * Airlines and ATC-style callsigns ("LH 347" = Lufthansa 347). Small passenger Cessnas fly as general
 * aviation with a German registration ("D-FKAB").
 */
import type { AircraftTypeId } from './aircraft';
import type { Random } from './random';

export interface Airline {
  /** Short code shown in strips (IATA-style). */
  readonly code: string;
  readonly name: string;
}

const A = (code: string, name: string): Airline => ({ code, name });

/** Who flies each Aircraft Type *(flavour only)*. */
export const AIRLINES: Record<AircraftTypeId, readonly Airline[]> = {
  C208: [],
  C208F: [A('FX', 'FedEx Feeder'), A('QY', 'DHL')],
  Q400: [A('LG', 'Luxair'), A('EN', 'Air Dolomiti'), A('WX', 'CityJet')],
  A320: [A('LH', 'Lufthansa'), A('EW', 'Eurowings'), A('DE', 'Condor'), A('U2', 'easyJet'), A('AF', 'Air France'), A('BA', 'British Airways')],
  B738: [A('FR', 'Ryanair'), A('KL', 'KLM'), A('TK', 'Turkish Airlines'), A('X3', 'TUIfly'), A('SK', 'SAS')],
  B738F: [A('QY', 'DHL'), A('W8', 'Cargojet')],
  B77W: [A('EK', 'Emirates'), A('LH', 'Lufthansa'), A('TK', 'Turkish Airlines'), A('AF', 'Air France')],
  A350: [A('QR', 'Qatar Airways'), A('LH', 'Lufthansa'), A('SQ', 'Singapore Airlines'), A('DE', 'Condor')],
  B748F: [A('LH', 'Lufthansa Cargo'), A('CV', 'Cargolux'), A('5Y', 'Atlas Air')],
};

export interface Callsign {
  readonly callsign: string;
  /** Spoken form for tooltips, e.g. "Lufthansa 347". */
  readonly spoken: string;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A callsign for a new flight of this type; `taken` avoids duplicates within a Day. */
export function makeCallsign(type: AircraftTypeId, rng: Random, taken: Set<string>): Callsign {
  for (;;) {
    const airlines = AIRLINES[type];
    let c: Callsign;
    if (airlines.length === 0) {
      const reg = `D-E${Array.from({ length: 3 }, () => LETTERS[rng.int(26)]).join('')}`;
      c = { callsign: reg, spoken: `Private ${reg}` };
    } else {
      const airline = rng.pick(airlines);
      const number = 100 + rng.int(9_800);
      c = { callsign: `${airline.code} ${number}`, spoken: `${airline.name} ${number}` };
    }
    if (!taken.has(c.callsign)) {
      taken.add(c.callsign);
      return c;
    }
  }
}
