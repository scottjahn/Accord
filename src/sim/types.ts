import type { BuildingId, EmpireId, FactionId, FleetId, HullId, ShipId, SystemId } from './ids';
import type { RngState } from './rng';

/** Bump when GameState changes shape; deserialize rejects other versions. */
export const SAVE_VERSION = 3;

/**
 * Who assigns a colony's workers. 'manual' leaves the allocation alone; the
 * others reassign workers every turn using the weights in content rules.
 */
export const GOVERNORS = ['manual', 'balanced', 'growth', 'industry', 'research'] as const;
export type Governor = (typeof GOVERNORS)[number];
export type AutoGovernor = Exclude<Governor, 'manual'>;

export const OUTPUT_KINDS = ['food', 'industry', 'energy', 'intel', 'research'] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];
export type Outputs = Record<OutputKind, number>;

export const FIELDS = ['biology', 'construction', 'energy', 'propulsion', 'computing', 'weapons'] as const;
export type FieldId = (typeof FIELDS)[number];
export const MAX_RESEARCH_LEVEL = 10;

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

/** Something a colony is building. `progress` is the industry already spent on it. */
export type BuildItem =
  | { kind: 'building'; building: BuildingId; progress: number }
  | { kind: 'ship'; hull: HullId; progress: number }
  | { kind: 'refit'; ship: ShipId; hull: HullId; progress: number };

export interface Colony {
  owner: EmpireId;
  population: number;
  growthProgress: number;
  foodStock: number;
  /** Workers per output. The sum never exceeds population; the rest are idle. */
  allocation: Outputs;
  governor: Governor;
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

export interface ResearchState {
  /** 0 to MAX_RESEARCH_LEVEL per field. */
  levels: Record<FieldId, number>;
  /** Research points banked toward the next level of each field. */
  progress: Record<FieldId, number>;
  /** How each turn's research is split: integer percents summing to 100. */
  allocation: Record<FieldId, number>;
}

export interface Ship {
  id: ShipId;
  hull: HullId;
  hp: number;
}

/** 'colonise' founds a colony with one colony ship when the fleet reaches its destination. */
export type FleetOrder = 'none' | 'colonise';

export interface Fleet {
  id: FleetId;
  owner: EmpireId;
  sector: Sector;
  ships: Ship[];
  /** Where the fleet is heading, or null if it is holding position. */
  destination: Sector | null;
  order: FleetOrder;
}

export interface Empire {
  id: EmpireId;
  faction: FactionId;
  controller: 'human' | 'ai';
  homeSystem: SystemId;
  research: ResearchState;
  intelPool: number;
  /**
   * Systems this empire has scanned, with the owner it last saw there
   * (null = unclaimed when last seen). Systems never scanned are absent.
   */
  knownSystems: Record<SystemId, EmpireId | null>;
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
  fleets: Record<FleetId, Fleet>;
  /** Counter for fleet and ship ids. */
  nextId: number;
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
  | { type: 'shipBuilt'; system: SystemId; hull: HullId; fleet: FleetId }
  | { type: 'refitCompleted'; system: SystemId; hull: HullId }
  | { type: 'populationGrew'; system: SystemId; population: number }
  | { type: 'starvation'; system: SystemId; lost: number; population: number }
  | { type: 'researchCompleted'; empire: EmpireId; field: FieldId; level: number }
  | { type: 'fleetArrived'; empire: EmpireId; fleet: FleetId; sector: Sector }
  | { type: 'fleetBlocked'; empire: EmpireId; fleet: FleetId }
  | { type: 'colonyFounded'; empire: EmpireId; system: SystemId }
  | { type: 'coloniseFailed'; empire: EmpireId; system: SystemId | null };
