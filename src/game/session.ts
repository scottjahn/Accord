import {
  createGame,
  deserialize,
  serialize,
  sortedKeys,
  submitCommand,
  type Command,
  type CommandError,
  type Content,
  type Difficulty,
  type EmpireId,
  type GameState,
  type Result,
  type SaveError,
  type TurnEvent,
} from '../sim';
import { idleKeys, turnNeedsPlayer } from './skip';
import { playTurn } from './turn';

export interface NewGameOptions {
  seed: number;
  /** Galaxy preset id. */
  preset: string;
  /** The human player's faction id. */
  faction: string;
  /** Faction ids of the AI opponents. Defaults to the faction's own rival. */
  opponents?: string[];
  /** How strong the AI opponents' economies are. Defaults to 'normal'. */
  difficulty?: Difficulty;
}

/** What the UI renders. A new object is published on every change. */
export interface SessionSnapshot {
  state: GameState;
  player: EmpireId;
  /** Events from the turn that just resolved. */
  lastEvents: TurnEvent[];
  /** How many turns that was: 1 for End Turn, more after skipping ahead. */
  turnsPlayed: number;
  /** Why the most recent command was rejected, or null if it was accepted. */
  lastError: CommandError | null;
}

/** A single-player game in progress. Holds the state and is the only thing that changes it. */
export interface GameSession {
  readonly content: Content;
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  /** Applies a command for any empire. Returns false if it was rejected. */
  dispatch(command: Command): boolean;
  /** AI empires act, then the turn resolves. */
  endTurn(): void;
  /**
   * Ends turns until something needs the player (see `turnNeedsPlayer`) or
   * `maxTurns` have passed. Returns how many turns were played.
   */
  skipAhead(maxTurns: number): number;
  exportSave(): string;
  importSave(json: string): Result<void, SaveError>;
}

/** The first human-controlled empire, or null in an all-AI game. */
export function humanEmpire(state: GameState): EmpireId | null {
  return sortedKeys(state.empires).find((id) => state.empires[id].controller === 'human') ?? null;
}

/**
 * Creates a game with one human empire and the chosen factions as AI
 * opponents. The player's home starts under the balanced governor so the first
 * turn works without touching a slider.
 */
export function startNewGame(content: Content, options: NewGameOptions): GameState {
  const rival = content.factions[options.faction as keyof typeof content.factions]?.rival;
  const opponents = (options.opponents ?? (rival ? [rival] : sortedKeys(content.factions))).filter((id) => id !== options.faction);
  const state = createGame(
    {
      seed: options.seed,
      galaxyPreset: options.preset,
      empires: [
        { faction: options.faction, controller: 'human' },
        ...opponents.map((faction) => ({ faction, controller: 'ai' as const })),
      ],
      difficulty: options.difficulty,
    },
    content,
  );
  const player = humanEmpire(state)!;
  const result = submitCommand(
    state,
    { type: 'setGovernor', empire: player, system: state.empires[player].homeSystem, governor: 'balanced' },
    content,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function createSession(content: Content, initial: GameState): GameSession {
  const firstPlayer = humanEmpire(initial);
  if (!firstPlayer) throw new Error('createSession: the game has no human empire');

  let snapshot: SessionSnapshot = { state: initial, player: firstPlayer, lastEvents: [], turnsPlayed: 0, lastError: null };
  const listeners = new Set<() => void>();
  const publish = (next: SessionSnapshot) => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  return {
    content,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(command) {
      const result = submitCommand(snapshot.state, command, content);
      if (result.ok) publish({ ...snapshot, state: result.value, lastError: null });
      else publish({ ...snapshot, lastError: result.error });
      return result.ok;
    },
    endTurn() {
      const { state, events } = playTurn(snapshot.state, content);
      publish({ ...snapshot, state, lastEvents: events, turnsPlayed: 1, lastError: null });
    },
    skipAhead(maxTurns) {
      const player = snapshot.player;
      // What was already idle when the player chose to skip is theirs to ignore.
      const accepted = idleKeys(snapshot.state, player, content);
      let state = snapshot.state;
      const all: TurnEvent[] = [];
      let played = 0;
      while (played < maxTurns && state.winner === null) {
        const turn = playTurn(state, content);
        state = turn.state;
        all.push(...turn.events);
        played++;
        if (turnNeedsPlayer(state, player, turn.events, content, accepted)) break;
      }
      if (played > 0) publish({ ...snapshot, state, lastEvents: all, turnsPlayed: played, lastError: null });
      return played;
    },
    exportSave: () => serialize(snapshot.state),
    importSave(json) {
      const loaded = deserialize(json);
      if (!loaded.ok) return loaded;
      const player = humanEmpire(loaded.value);
      if (!player) return { ok: false, error: { code: 'badShape', message: 'Save has no human empire' } };
      publish({ state: loaded.value, player, lastEvents: [], turnsPlayed: 0, lastError: null });
      return { ok: true, value: undefined };
    },
  };
}
