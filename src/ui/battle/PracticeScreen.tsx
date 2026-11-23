import { useState } from 'react';
import {
  practiceSetup,
  sortedKeys,
  type BattleOutcome,
  type BattleSetup,
  type Content,
  type EmpireId,
  type FactionId,
  type HullId,
  type TacticalOptions,
} from '../../sim';
import { HullIcon } from '../fleet/HullIcon';
import { BattleScreen } from './BattleScreen';

interface Props {
  content: Content;
  onClose: () => void;
}

const YOU = 'emp-1' as EmpireId;
const THEM = 'emp-2' as EmpireId;

interface SideChoice {
  faction: FactionId;
  ships: Record<string, number>;
}

/**
 * A battle outside any game, for trying the battle screen: pick two powers
 * and what each brings, then fight it. Ships start at full hull with no
 * research bonuses.
 */
export function PracticeScreen({ content, onClose }: Props) {
  const factions = sortedKeys(content.factions);
  const warships = (faction: FactionId) =>
    sortedKeys(content.hulls).filter((id) => content.hulls[id].faction === null || content.hulls[id].faction === faction);
  const [you, setYou] = useState<SideChoice>({ faction: factions[0], ships: { frigate: 4, destroyer: 2 } });
  const [them, setThem] = useState<SideChoice>({ faction: factions[1] ?? factions[0], ships: { frigate: 5, destroyer: 1 } });
  const [batteries, setBatteries] = useState(0);
  const [fight, setFight] = useState<{ setup: BattleSetup; options: TacticalOptions; seed: number } | null>(null);
  const [last, setLast] = useState<string | null>(null);

  const hullsOf = (side: SideChoice) =>
    warships(side.faction).flatMap((id) => Array.from({ length: side.ships[id] ?? 0 }, () => id as string));

  const start = () => {
    const setup = practiceSetup(content, [
      { empire: YOU, hulls: hullsOf(you), batteries },
      { empire: THEM, hulls: hullsOf(them), batteries: 0 },
    ]);
    const seed = (fight?.seed ?? 0) + 1;
    setFight({ setup, options: { wars: [[YOU, THEM]], player: YOU, seed }, seed });
  };

  const finish = (outcome: BattleOutcome) => {
    const left = (empire: EmpireId) => {
      const ids = new Set(fight!.setup.units.filter((u) => u.empire === empire).map((u) => u.id));
      const mine = outcome.units.filter((u) => ids.has(u.id));
      return `${mine.filter((u) => u.hp > 0 && !u.withdrawn).length} holding, ${mine.filter((u) => u.withdrawn).length} withdrew, ${mine.filter((u) => u.hp === 0).length} lost`;
    };
    setLast(`You: ${left(YOU)}. Them: ${left(THEM)}.`);
    setFight(null);
  };

  if (fight) {
    const sides = {
      [YOU]: { name: `You (${content.factions[you.faction].name})`, color: content.factions[you.faction].color },
      [THEM]: { name: content.factions[them.faction].name, color: content.factions[them.faction].color },
    } as Record<EmpireId, { name: string; color: string }>;
    return (
      <BattleScreen
        key={fight.seed}
        content={content}
        setup={fight.setup}
        options={fight.options}
        title="Practice battle"
        sides={sides}
        onFinish={finish}
      />
    );
  }

  const ready = hullsOf(you).length + batteries > 0 && hullsOf(them).length > 0 && [...hullsOf(you), ...hullsOf(them)].some((id) => content.hulls[id as HullId].attack > 0);

  return (
    <main className="setup">
      <header className="setup-head">
        <h1>Practice battle</h1>
        <p>Set up two fleets and fight it out. Nothing here touches a saved game.</p>
      </header>
      <div className="practice-sides">
        <SidePicker content={content} title="Your fleet" side={you} hulls={warships(you.faction)} onChange={setYou} />
        <SidePicker content={content} title="Enemy fleet" side={them} hulls={warships(them.faction)} onChange={setThem} />
      </div>
      <section className="card">
        <label className="practice-row">
          <span>Orbital batteries around your planet</span>
          <input type="number" min={0} max={8} value={batteries} onChange={(e) => setBatteries(clampCount(e.target.value, 8))} aria-label="Batteries" />
        </label>
      </section>
      {last && (
        <p className="muted" role="status">
          Last battle — {last}
        </p>
      )}
      <div className="setup-actions">
        <button type="button" className="btn" onClick={onClose}>
          Back
        </button>
        <button type="button" className="btn primary" onClick={start} disabled={!ready}>
          Fight
        </button>
      </div>
    </main>
  );
}

const clampCount = (value: string, max: number) => Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));

function SidePicker({
  content,
  title,
  side,
  hulls,
  onChange,
}: {
  content: Content;
  title: string;
  side: SideChoice;
  hulls: HullId[];
  onChange: (side: SideChoice) => void;
}) {
  const faction = content.factions[side.faction];
  return (
    <section className="card">
      <h2>{title}</h2>
      <label className="practice-row">
        <span>Power</span>
        <select value={side.faction} onChange={(e) => onChange({ ...side, faction: e.target.value as FactionId })} aria-label={`${title} power`}>
          {sortedKeys(content.factions).map((id) => (
            <option key={id} value={id}>
              {content.factions[id].name}
            </option>
          ))}
        </select>
      </label>
      {hulls.map((id) => {
        const hull = content.hulls[id];
        return (
          <label key={id} className="practice-row">
            <span>
              <HullIcon role={hull.role} tier={hull.tier} color={faction.color} /> {hull.name}
              <span className="muted">
                {' '}
                {hull.attack > 0 ? `attack ${hull.attack}, ` : 'unarmed, '}hull {hull.hp}
              </span>
            </span>
            <input
              type="number"
              min={0}
              max={30}
              value={side.ships[id] ?? 0}
              onChange={(e) => onChange({ ...side, ships: { ...side.ships, [id]: clampCount(e.target.value, 30) } })}
              aria-label={`${title}: ${hull.name}`}
            />
          </label>
        );
      })}
    </section>
  );
}
