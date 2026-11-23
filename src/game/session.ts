import {
  battlesAhead,
  createGame,
  deserialize,
  processTurn,
  serialize,
  sortedKeys,
  submitCommand,
  tacticalOptionsFor,
  type Command,
  type CommandError,
  type Content,
  type Difficulty,
  type EmpireId,
  type GameState,
  type Result,
  type SaveError,
  type TurnEvent,
  type BattleOutcome,
  type BattleSetup,
  type TacticalOptions,
} from '../sim';
import { idleKeys, turnNeedsPlayer } from './skip';
import { prepareTurn } from './turn';

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
  /**
   * Set while the turn is waiting on the player to fight or auto-resolve the
   * battles their ships are in. The turn resolves once every one is decided.
   */
  battles: PendingBattles | null;
}

export interface PendingBattles {
  /** The battles the player's ships or colonies are in, as they will start. */
  setups: BattleSetup[];
  /** How to set each one up for fighting, by battle key, with the player in command. */
  options: Record<string, TacticalOptions>;
  /** What the player chose for each so far, by battle key. */
  decided: Record<string, BattleOutcome | 'auto'>;
}

/** A single-player game in progress. Holds the state and is the only thing that changes it. */
export interface GameSession {
  readonly content: Content;
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  /** Applies a command for any empire. Returns false if it was rejected. */
  dispatch(command: Command): boolean;
  /**
   * AI empires act, then the turn resolves. If the player is in a battle this
   * turn, it waits instead: `battles` is set and the turn resolves once
   * `decideBattle` has been called for each.
   */
  endTurn(): void;
  /** Settles one waiting battle: 'auto' to auto-resolve it, or the result of fighting it. */
  decideBattle(key: string, result: BattleOutcome | 'auto'): void;
  /**
   * Ends turns until something needs the player (see `turnNeedsPlayer`), a
   * battle of theirs is coming, or `maxTurns` have passed. Returns how many
   * turns were played; a turn left waiting on its battles is not counted.
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

  let snapshot: SessionSnapshot = { state: initial, player: firstPlayer, lastEvents: [], turnsPlayed: 0, lastError: null, battles: null };
  /** The turn waiting on its battles: the state after the AI's commands, and what came before it in a skip. */
  let waiting: { prepared: GameState; events: TurnEvent[]; played: number } | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: SessionSnapshot) => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  /**
   * If the player has a battle in the turn about to resolve, keeps the turn
   * waiting and publishes the battles. Meanwhile the snapshot shows `shown`,
   * the last resolved state: the AI's fresh commands are not the player's to
   * see. Returns true if the turn waits.
   */
  const holdForBattles = (shown: GameState, prepared: GameState, events: TurnEvent[], played: number): boolean => {
    const player = snapshot.player;
    const setups = battlesAhead(prepared, content).filter((b) => b.units.some((u) => u.empire === player));
    if (setups.length === 0) return false;
    waiting = { prepared, events: [...events], played };
    const report = played > 0 ? { lastEvents: [...events], turnsPlayed: played } : {};
    const options = Object.fromEntries(setups.map((b) => [b.key, tacticalOptionsFor(prepared, b, player)]));
    publish({ ...snapshot, ...report, state: shown, lastError: null, battles: { setups, options, decided: {} } });
    return true;
  };

  return {
    content,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(command) {
      if (waiting) return false;
      const result = submitCommand(snapshot.state, command, content);
      if (result.ok) publish({ ...snapshot, state: result.value, lastError: null });
      else publish({ ...snapshot, lastError: result.error });
      return result.ok;
    },
    endTurn() {
      if (waiting) return;
      const prepared = prepareTurn(snapshot.state, content);
      if (holdForBattles(snapshot.state, prepared, [], 0)) return;
      const { state, events } = processTurn(prepared, content);
      publish({ ...snapshot, state, lastEvents: events, turnsPlayed: 1, lastError: null, battles: null });
    },
    decideBattle(key, result) {
      if (!waiting || !snapshot.battles || !snapshot.battles.setups.some((b) => b.key === key)) return;
      const decided = { ...snapshot.battles.decided, [key]: result };
      if (snapshot.battles.setups.some((b) => !(b.key in decided))) {
        publish({ ...snapshot, battles: { ...snapshot.battles, decided } });
        return;
      }
      const commandedBattles: Record<string, BattleOutcome> = {};
      for (const [k, v] of Object.entries(decided)) if (v !== 'auto') commandedBattles[k] = v;
      const { prepared, events: before, played } = waiting;
      waiting = null;
      const { state, events } = processTurn(prepared, content, { commandedBattles });
      publish({ ...snapshot, state, lastEvents: [...before, ...events], turnsPlayed: played + 1, lastError: null, battles: null });
    },
    skipAhead(maxTurns) {
      if (waiting) return 0;
      const player = snapshot.player;
      // What was already idle when the player chose to skip is theirs to ignore.
      const accepted = idleKeys(snapshot.state, player, content);
      let state = snapshot.state;
      const all: TurnEvent[] = [];
      let played = 0;
      while (played < maxTurns && state.winner === null) {
        const prepared = prepareTurn(state, content);
        if (holdForBattles(state, prepared, all, played)) return played;
        const turn = processTurn(prepared, content);
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
      waiting = null;
      publish({ state: loaded.value, player, lastEvents: [], turnsPlayed: 0, lastError: null, battles: null });
      return { ok: true, value: undefined };
    },
  };
}
