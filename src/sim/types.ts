import type { BuildingId, EmpireId, FactionId, FleetId, HullId, MinorId, ShipId, SystemId } from './ids';
import type { RngState } from './rng';

/** Bump when GameState changes shape; deserialize rejects other versions. */
export const SAVE_VERSION = 6;

/** Things that move morale. Each has a value, a duration and a label in content rules. */
export const MORALE_EVENTS = [
  'battleWon',
  'battleLost',
  'colonyCaptured',
  'colonyLost',
  'conquered',
  'warDeclared',
  'starvation',
  'colonyFounded',
  'minorJoined',
  'minorConquered',
] as const;
export type MoraleEventKind = (typeof MORALE_EVENTS)[number];

/** One timed cause of a colony's morale. */
export interface MoraleEffect {
  source: MoraleEventKind;
  value: number;
  /** Turns until it wears off; null would mean permanent. */
  turnsLeft: number | null;
}

/** What a minor race can want from an empire courting it. */
export const MINOR_WANTS = ['protection', 'technology', 'neighbours', 'influence'] as const;
export type MinorWant = (typeof MINOR_WANTS)[number];

/** An independent minor race living in a system. */
export interface MinorState {
  race: MinorId;
  population: number;
  /** 0-100 toward each empire that has found it. */
  attitude: Record<EmpireId, number>;
  /** The empire currently over the joining threshold and ahead of all others, if any. */
  leader: EmpireId | null;
  /** Turns in a row that empire has led. */
  leadTurns: number;
}

/**
 * How a fleet fights: engage goes for armed enemies; raid goes for unarmed
 * ships; escort draws raiders' fire onto itself; evade does not fire and
 * falls back after one round.
 */
export const STANCES = ['engage', 'raid', 'escort', 'evade'] as const;
export type Stance = (typeof STANCES)[number];

/** Any value that survives JSON.stringify unchanged. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Difficulty changes the output of AI-controlled empires only; the rules stay the same. */
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

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
  /** 100 is neutral. Kept in step with its causes by the sim; see moraleBreakdown. */
  morale: number;
  moraleEffects: MoraleEffect[];
  /** Set when this colony is a minor race that joined its owner; it then grants that race's bonus. */
  minorRace: MinorId | null;
}

export interface StarSystem {
  id: SystemId;
  name: string;
  sector: Sector;
  planets: Planet[];
  /** null while the system is unowned. */
  colony: Colony | null;
  /** An independent minor race living here, until it joins or is conquered. */
  minor: MinorState | null;
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
export type FleetOrder = 'none' | 'colonise' | 'invade';

export interface Fleet {
  id: FleetId;
  owner: EmpireId;
  sector: Sector;
  ships: Ship[];
  /** Where the fleet is heading, or null if it is holding position. */
  destination: Sector | null;
  /** 'invade' lands troops on an enemy colony when the fleet reaches its destination. */
  order: FleetOrder;
  stance: Stance;
}

export interface Empire {
  id: EmpireId;
  faction: FactionId;
  controller: 'human' | 'ai';
  homeSystem: SystemId;
  research: ResearchState;
  intelPool: number;
  /** True once the empire has lost its last colony and colony ship. */
  eliminated: boolean;
  /** The last turn this empire was at war with anyone; 0 if never. */
  lastWarTurn: number;
  /** Minor races that have joined and whose home this empire still holds, sorted. */
  members: MinorId[];
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
  difficulty: Difficulty;
  /** Pairs of empires at war (see warKey), with the turn war was declared. Everyone else is at peace. */
  wars: Record<string, number>;
  /** Set when only one empire is left; the game is then over. */
  winner: EmpireId | null;
  /**
   * What each AI player remembers between turns. The sim never reads it; it is
   * here so a saved game resumes with the same AI plans.
   */
  agentMemory: Record<EmpireId, Json>;
}

export interface GameConfig {
  seed: number;
  /** Galaxy preset id from content. */
  galaxyPreset: string;
  empires: { faction: string; controller: 'human' | 'ai' }[];
  /** Defaults to 'normal'. */
  difficulty?: Difficulty;
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

/** A ship or orbital battery that took part in a battle. */
export interface CombatUnit {
  id: string;
  empire: EmpireId;
  name: string;
  role: string;
}

export interface CombatShot {
  attacker: string;
  target: string;
  /** The seeded roll, as a percent of the attacker's full strength. */
  roll: number;
  damage: number;
  destroyed: boolean;
}

/** Everything that happened in one sector's battle this turn, shot by shot. */
export interface CombatReport {
  sector: Sector;
  units: CombatUnit[];
  sides: { empire: EmpireId; before: number; after: number }[];
  rounds: CombatShot[][];
  /** 'ongoing' if enemies still face each other and will fight again next turn. */
  outcome: 'ongoing' | 'decided';
}

export interface InvasionReport {
  system: SystemId;
  attacker: EmpireId;
  /** The empire that held the colony, or null if it was an independent minor race. */
  defender: EmpireId | null;
  minor: MinorId | null;
  attack: OutputBreakdown;
  defence: OutputBreakdown;
  /** Percent of the attack strength that counted; the colony falls if that beats the defence. */
  roll: number;
  captured: boolean;
  populationLost: number;
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
  | { type: 'coloniseFailed'; empire: EmpireId; system: SystemId | null }
  | { type: 'warDeclared'; by: EmpireId; on: EmpireId }
  | { type: 'battle'; empires: EmpireId[]; report: CombatReport }
  | { type: 'invasion'; empires: EmpireId[]; report: InvasionReport }
  | { type: 'empireEliminated'; empire: EmpireId }
  | { type: 'gameWon'; empire: EmpireId }
  | { type: 'minorJoined'; empire: EmpireId; system: SystemId; race: MinorId }
  | { type: 'minorConquered'; empire: EmpireId; system: SystemId; race: MinorId };
