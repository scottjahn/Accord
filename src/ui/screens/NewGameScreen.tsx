import { useState, type ChangeEvent, type FormEvent } from 'react';
import { humanEmpire, startNewGame } from '../../game/session';
import { DIFFICULTIES, deserialize, sortedKeys, type Content, type Difficulty, type GameState } from '../../sim';
import { modifiersText, signed } from '../format';

interface Props {
  content: Content;
  /** An autosaved game that can be continued, if there is one. */
  saved: GameState | null;
  onStart: (state: GameState) => void;
}

const randomSeed = () => Math.floor(Math.random() * 1_000_000);

export function NewGameScreen({ content, saved, onStart }: Props) {
  const factions = sortedKeys(content.factions);
  const presets = Object.values(content.galaxyPresets).sort((a, b) => a.systems - b.systems);

  const [faction, setFaction] = useState<string>(factions[0]);
  const [preset, setPreset] = useState(presets[0].id);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [seed, setSeed] = useState(randomSeed);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!Number.isInteger(seed) || seed < 0) {
      setError('Seed must be a whole number of 0 or more.');
      return;
    }
    onStart(startNewGame(content, { seed, preset, faction, difficulty }));
  };

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const loaded = deserialize(await file.text());
    if (!loaded.ok) setError(loaded.error.message);
    else if (!humanEmpire(loaded.value)) setError('That save has no human player.');
    else onStart(loaded.value);
  };

  const savedFaction = saved ? content.factions[saved.empires[humanEmpire(saved)!].faction]?.name : null;

  return (
    <main className="setup">
      <header className="setup-head">
        <h1>Accord of Stars</h1>
        <p>Union or conquest. Choose a power and take your first turn.</p>
      </header>

      {saved && (
        <section className="card setup-continue">
          <div>
            <h2>Continue</h2>
            <p className="muted">
              {savedFaction}, turn {saved.turn}, {saved.difficulty}, seed {saved.seed}
            </p>
          </div>
          <button type="button" className="btn primary" onClick={() => onStart(saved)}>
            Continue game
          </button>
        </section>
      )}

      <form className="card setup-form" onSubmit={submit} noValidate>
        <h2>New game</h2>

        <fieldset>
          <legend>Power</legend>
          <div className="faction-list">
            {factions.map((id) => {
              const def = content.factions[id];
              return (
                <label key={id} className={`faction-card${faction === id ? ' selected' : ''}`}>
                  <input type="radio" name="faction" value={id} checked={faction === id} onChange={() => setFaction(id)} />
                  <span className="dot" style={{ background: def.color }} />
                  <span className="faction-name">{def.name}</span>
                  <span className="muted">{modifiersText(def.outputModifiers)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="setup-row">
          <label className="field">
            <span>Galaxy</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id[0].toUpperCase() + p.id.slice(1)} ({p.systems} systems)
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Difficulty</span>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
              {DIFFICULTIES.map((d) => {
                const bonus = content.rules.difficulty[d];
                return (
                  <option key={d} value={d}>
                    {d[0].toUpperCase() + d.slice(1)} ({bonus === 0 ? 'AI plays by your rules' : `AI output ${signed(bonus)}%`})
                  </option>
                );
              })}
            </select>
          </label>

          <label className="field">
            <span>Seed</span>
            <span className="seed-input">
              <input
                type="number"
                min={0}
                step={1}
                value={Number.isNaN(seed) ? '' : seed}
                onChange={(e) => setSeed(e.target.valueAsNumber)}
              />
              <button type="button" className="btn" onClick={() => setSeed(randomSeed())}>
                Random
              </button>
            </span>
          </label>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="setup-actions">
          <label className="btn file-btn">
            Load save file
            <input type="file" accept="application/json,.json" onChange={importFile} />
          </label>
          <button type="submit" className="btn primary">
            Start game
          </button>
        </div>
      </form>
    </main>
  );
}
