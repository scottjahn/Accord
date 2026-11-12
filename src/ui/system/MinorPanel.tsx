import {
  attitudeChange,
  minorGarrison,
  minorOf,
  minorStanding,
  validateCommand,
  type Command,
  type Content,
  type EmpireId,
  type GameState,
  type MinorWant,
  type StarSystem,
} from '../../sim';
import { bonusText, lineValue, signed } from '../format';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  system: StarSystem;
  dispatch: (command: Command) => boolean;
}

const WANT_LABELS: Record<MinorWant, string> = {
  protection: 'Protection: keep a warship stationed here',
  technology: 'Technology',
  neighbours: 'Neighbours: have a colony close by',
  influence: 'Influence: responds twice as well to courting',
};

const STANDING_TEXT = {
  alone: 'No rival has found them yet.',
  ahead: 'You are ahead of every rival.',
  level: 'A rival stands level with you.',
  behind: 'A rival is ahead of you.',
};

const SPEND = [10, 25, 50];

/** An independent minor race: what it wants, how it feels about you, and what it would bring. */
export function MinorPanel({ state, content, player, system, dispatch }: Props) {
  const minor = system.minor!;
  const def = minorOf(system, content)!;
  const rules = content.rules.minors;
  const attitude = minor.attitude[player];
  const met = attitude !== undefined;
  const change = met ? attitudeChange(state, system, player, content) : null;
  const garrison = minorGarrison(system, content);
  const met_want = (want: MinorWant) => change?.lines.some((l) => l.source.toLowerCase().startsWith(want)) ?? false;
  const pool = state.empires[player].intelPool;

  return (
    <>
      <section>
        <h3>The {def.name}</h3>
        <p>{def.description}</p>
        <dl className="stat-grid">
          <div>
            <dt>Population</dt>
            <dd>{minor.population}</dd>
          </div>
          <div>
            <dt>Garrison</dt>
            <dd data-testid="minor-garrison">{garrison.total}</dd>
          </div>
          <div>
            <dt>If they join you</dt>
            <dd data-testid="minor-bonus">{bonusText(def, content)}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h3>What they want</h3>
        <ul className="planet-list" aria-label="Wants">
          {def.wants.map((want) => (
            <li key={want}>
              <span>
                {want === 'technology'
                  ? `Technology: reach ${content.fields[def.favouredField].name} level ${def.techLevel}`
                  : WANT_LABELS[want]}
              </span>
              {want !== 'influence' && <span className={met_want(want) ? 'good' : 'muted'}>{met_want(want) ? 'Met' : 'Not met'}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Their attitude to you</h3>
        {!met ? (
          <p className="muted">First contact will be made at the end of this turn.</p>
        ) : (
          <>
            <p>
              <strong data-testid="attitude">{attitude} / 100</strong>{' '}
              <span className="muted" data-testid="attitude-change">
                ({signed(change!.total)} per turn)
              </span>
            </p>
            <progress max={100} value={attitude} aria-label="Attitude" />
            <table className="breakdown">
              <tbody>
                {change!.lines.length === 0 && (
                  <tr>
                    <td className="muted">Nothing is changing their mind</td>
                    <td />
                  </tr>
                )}
                {change!.lines.map((line, i) => (
                  <tr key={i}>
                    <td>{line.source}</td>
                    <td className="num">{lineValue(line)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted hint">
              They join at {rules.joinAt} once you have been ahead for {rules.joinTurns} turns in a row.{' '}
              <span data-testid="standing">{STANDING_TEXT[minorStanding(system, player)]}</span>
              {minor.leader === player && ` They are leaning your way: ${minor.leadTurns} of ${rules.joinTurns} turns.`}
            </p>
          </>
        )}
      </section>

      {met && (
        <section>
          <h3>Court them</h3>
          <p className="muted hint">
            Spend intel to win them over: {rules.influenceCost} intel per point of attitude
            {def.wants.includes('influence') && ', doubled for this people'}. You have {pool} intel.
          </p>
          <div className="fleet-actions">
            {SPEND.map((points) => {
              const command: Command = { type: 'courtMinor', empire: player, system: system.id, points };
              const reason = validateCommand(state, command, content)?.message;
              return (
                <button key={points} type="button" className="btn" disabled={reason !== undefined} title={reason} onClick={() => dispatch(command)}>
                  Spend {points} intel
                </button>
              );
            })}
          </div>
          <p className="muted hint">Taking their world by force gains the system but not their bonus, and costs morale.</p>
        </section>
      )}
    </>
  );
}
