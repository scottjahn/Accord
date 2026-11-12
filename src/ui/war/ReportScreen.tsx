import type { CombatReport, Content, EmpireId, GameState, InvasionReport, OutputBreakdown, TurnEvent } from '../../sim';
import { lineValue, placeName } from '../format';

type ReportEvent = Extract<TurnEvent, { type: 'battle' | 'invasion' }>;

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  event: ReportEvent;
  onClose: () => void;
}

/** A battle or an invasion in full, so every result can be traced to its rolls. */
export function ReportScreen({ state, content, player, event, onClose }: Props) {
  const factionName = (id: EmpireId | null): string => {
    if (id === null) {
      const race = event.type === 'invasion' ? event.report.minor : null;
      return race ? `the ${content.minors[race]?.name ?? race}` : 'the defenders';
    }
    return id === player ? 'You' : (content.factions[state.empires[id].faction]?.name ?? id);
  };
  const title =
    event.type === 'battle'
      ? `Battle at ${placeName(state, event.report.sector)}`
      : `Invasion of ${state.systems[event.report.system]?.name ?? 'a colony'}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn primary" onClick={onClose}>
            Close
          </button>
        </header>
        {event.type === 'battle' ? (
          <Battle report={event.report} factionName={factionName} />
        ) : (
          <Invasion report={event.report} factionName={factionName} />
        )}
      </div>
    </div>
  );
}

function Battle({ report, factionName }: { report: CombatReport; factionName: (id: EmpireId) => string }) {
  const unit = new Map(report.units.map((u) => [u.id, u]));
  const label = (id: string) => {
    const u = unit.get(id);
    return u ? `${u.name} (${factionName(u.empire)})` : id;
  };
  return (
    <>
      <ul className="planet-list">
        {report.sides.map((side) => (
          <li key={side.empire}>
            <span>{factionName(side.empire)}</span>
            <span className="muted">
              {side.before} in the fight, {side.before - side.after} lost
            </span>
          </li>
        ))}
      </ul>
      <p className="muted report-outcome">
        {report.outcome === 'ongoing' ? 'Both sides hold the sector; the battle continues next turn.' : 'The battle is over.'}
      </p>
      {report.rounds.map((shots, i) => (
        <section key={i}>
          <h3>Round {i + 1}</h3>
          <ol className="shot-list">
            {shots.map((shot, n) => (
              <li key={n} className={shot.destroyed ? 'bad' : undefined}>
                {label(shot.attacker)} hit {label(shot.target)} for {shot.damage}
                <span className="muted"> (roll {shot.roll}%)</span>
                {shot.destroyed && ' — destroyed'}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

function Strength({ title, value }: { title: string; value: OutputBreakdown }) {
  return (
    <table className="breakdown">
      <tbody>
        <tr className="breakdown-total">
          <td>{title}</td>
          <td className="num">{value.total}</td>
        </tr>
        {value.lines.map((line, i) => (
          <tr key={i}>
            <td>{line.source}</td>
            <td className="num">{lineValue(line)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Invasion({ report, factionName }: { report: InvasionReport; factionName: (id: EmpireId | null) => string }) {
  const landed = Math.floor((report.attack.total * report.roll) / 100);
  return (
    <>
      <p className={report.captured ? undefined : 'bad'}>
        {factionName(report.attacker)} {report.captured ? 'captured the colony from' : 'failed to take the colony from'}{' '}
        {factionName(report.defender)}.
      </p>
      <Strength title={`${factionName(report.attacker)}: troops`} value={report.attack} />
      <Strength title={`${factionName(report.defender).replace(/^the /, 'The ')}: garrison`} value={report.defence} />
      <p className="muted report-outcome">
        Roll {report.roll}%: {landed} of {report.attack.total} troops counted against a garrison of {report.defence.total}. The colony
        falls if the troops that count outnumber the garrison.
        {report.captured && ` ${report.populationLost} population was lost in the fighting.`} The transports are used up either way.
      </p>
    </>
  );
}
