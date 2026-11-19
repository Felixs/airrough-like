import type { SizeClass } from './layout';

export type Purpose = 'passenger' | 'cargo';

export interface AircraftType {
  readonly id: string;
  readonly name: string;
  readonly size: SizeClass;
  readonly purpose: Purpose;
  /** Paid once as Arrival Fee and once as Departure Fee. *(first guess)* */
  readonly fee: number;
}

/** The eight v1 Aircraft Types (docs/v1-content.md). */
export const AIRCRAFT_TYPES = {
  C208: { id: 'C208', name: 'Cessna 208 Caravan', size: 'small', purpose: 'passenger', fee: 150 },
  C208F: { id: 'C208F', name: 'Cessna 208 Cargomaster', size: 'small', purpose: 'cargo', fee: 160 },
  Q400: { id: 'Q400', name: 'Dash 8-Q400', size: 'small', purpose: 'passenger', fee: 300 },
  A320: { id: 'A320', name: 'A320', size: 'medium', purpose: 'passenger', fee: 600 },
  B738: { id: 'B738', name: 'B737-800', size: 'medium', purpose: 'passenger', fee: 600 },
  B738F: { id: 'B738F', name: 'B737-800BCF', size: 'medium', purpose: 'cargo', fee: 700 },
  B77W: { id: 'B77W', name: 'B777-300ER', size: 'large', purpose: 'passenger', fee: 1400 },
  A350: { id: 'A350', name: 'A350', size: 'large', purpose: 'passenger', fee: 1400 },
  B748F: { id: 'B748F', name: 'B747-8F', size: 'large', purpose: 'cargo', fee: 1800 },
} as const satisfies Record<string, AircraftType>;

export type AircraftTypeId = keyof typeof AIRCRAFT_TYPES;

const SIZE_ORDER: Record<SizeClass, number> = { small: 1, medium: 2, large: 3 };
export const sizeRank = (s: SizeClass) => SIZE_ORDER[s];
