import type { BuildingId, EmpireId, FactionId, SystemId } from './ids';
import type { RngState } from './rng';

/** Bump when GameState changes shape; deserialize rejects other versions. */
export const SAVE_VERSION = 1;

export const OUTPUT_KINDS = ['food', 'industry', 'energy', 'intel', 'research'] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];
export type Outputs = Record<OutputKind, number>;

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface Sector {
  x: number;
  y: number;
}

export interface Planet {
  /** Planet type id from content. */
  type: string;
  maxPopulation: number;
  /** Percent modifiers this planet applies to the system's output. */
  foodBonus: number;
  energyBonus: number;
}

export interface BuildItem {
  building: BuildingId;
  /** Industry points already spent on this item. */
  progress: number;
}

export interface Colony {
  owner: EmpireId;
  population: number;
  growthProgress: number;
  foodStock: number;
  /** Workers per output. The sum never exceeds population; the rest are idle. */
  allocation: Outputs;
  buildings: Record<BuildingId, number>;
  buildQueue: BuildItem[];
  /** 100 is neutral. Fixed until milestone 6, but already part of the output formula. */
  morale: number;
}

export interface StarSystem {
  id: SystemId;
  name: string;
  sector: Sector;
  planets: Planet[];
  /** null while the system is unowned. */
  colony: Colony | null;
}

export interface Empire {
  id: EmpireId;
  faction: FactionId;
  controller: 'human' | 'ai';
  homeSystem: SystemId;
  researchPool: number;
  intelPool: number;
}

export interface GameState {
  saveVersion: number;
  seed: number;
  rng: RngState;
  /** The turn about to be played; starts at 1. */
  turn: number;
  galaxy: { width: number; height: number };
  systems: Record<SystemId, StarSystem>;
  empires: Record<EmpireId, Empire>;
}

export interface GameConfig {
  seed: number;
  /** Galaxy preset id from content. */
  galaxyPreset: string;
  empires: { faction: string; controller: 'human' | 'ai' }[];
}

export interface BreakdownLine {
  /** Human-readable cause, e.g. "6 workers" or "Farm x2". */
  source: string;
  /** base and flat lines add up; percent lines then scale the sum. */
  kind: 'base' | 'flat' | 'percent';
  value: number;
}

/** A number plus every cause that produced it. Computed on demand, never stored. */
export interface OutputBreakdown {
  total: number;
  lines: BreakdownLine[];
}

export type TurnEvent =
  | { type: 'buildCompleted'; system: SystemId; building: BuildingId }
  | { type: 'populationGrew'; system: SystemId; population: number }
  | { type: 'starvation'; system: SystemId; lost: number; population: number };
