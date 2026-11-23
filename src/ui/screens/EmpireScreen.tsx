import { useMemo, useState } from 'react';
import {
  coloniesOf,
  fleetPlan,
  fleetsOf,
  forecastColony,
  getColonyEconomy,
  idleReport,
  systemAt,
  type Content,
  type EmpireId,
  type Fleet,
  type FleetId,
  type GameState,
  type SystemId,
} from '../../sim';
import { HullIcon } from '../fleet/HullIcon';
import { GOVERNOR_LABELS, fleetOrderText, idleText, placeName, sectorLabel, signed, turns } from '../format';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  onSelectSystem: (id: SystemId) => void;
  onSelectFleet: (id: FleetId) => void;
  onClose: () => void;
}

type Tab = 'colonies' | 'fleets';
type Value = number | string;

interface Column<Row> {
  key: string;
  label: string;
  /** Sorts high-to-low first and, unless `textCell`, sits right-aligned. */
  numeric: boolean;
  textCell?: boolean;
  value: (row: Row) => Value;
}

interface ColonyRow {
  id: SystemId;
  name: string;
  sectorText: string;
  population: number;
  maxPopulation: number;
  morale: number;
  food: number;
  industry: number;
  research: number;
  governor: string;
  building: string;
  /** Turns until the first item is done; null if the queue is empty or stalled. */
  buildTurns: number | null;
  queued: number;
  needs: string[];
}

interface FleetRow {
  id: FleetId;
  where: string;
  sectorText: string;
  ships: Fleet['ships'];
  shipText: string;
  orders: string;
  /** Turns to the destination; null when holding. */
  arrives: number | null;
  stance: string;
  needs: string[];
}

const COLONY_COLUMNS: Column<ColonyRow>[] = [
  { key: 'name', label: 'Colony', numeric: false, value: (r) => r.name },
  { key: 'population', label: 'People', numeric: true, value: (r) => r.population },
  { key: 'morale', label: 'Morale', numeric: true, value: (r) => r.morale },
  { key: 'food', label: 'Food', numeric: true, value: (r) => r.food },
  { key: 'industry', label: 'Industry', numeric: true, value: (r) => r.industry },
  { key: 'research', label: 'Research', numeric: true, value: (r) => r.research },
  { key: 'governor', label: 'Governor', numeric: false, value: (r) => r.governor },
  { key: 'building', label: 'Building', numeric: false, value: (r) => r.building },
  { key: 'buildTurns', label: 'Done in', numeric: true, value: (r) => r.buildTurns ?? Number.MAX_SAFE_INTEGER },
  { key: 'queued', label: 'Queued', numeric: true, value: (r) => r.queued },
];

const FLEET_COLUMNS: Column<FleetRow>[] = [
  { key: 'where', label: 'Fleet at', numeric: false, value: (r) => r.where },
  { key: 'ships', label: 'Ships', numeric: true, textCell: true, value: (r) => r.ships.length },
  { key: 'orders', label: 'Orders', numeric: false, value: (r) => r.orders },
  { key: 'arrives', label: 'Arrives in', numeric: true, value: (r) => r.arrives ?? Number.MAX_SAFE_INTEGER },
  { key: 'stance', label: 'Stance', numeric: false, value: (r) => r.stance },
];

function sortRows<Row>(rows: Row[], column: Column<Row>, descending: boolean, tie: (row: Row) => string): Row[] {
  return [...rows].sort((a, b) => {
    const x = column.value(a);
    const y = column.value(b);
    const order = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y;
    return (descending ? -order : order) || tie(a).localeCompare(tie(b));
  });
}

/** Every colony and fleet the player owns, with what each is doing, in tables that sort by any column. */
export function EmpireScreen({ state, content, player, onSelectSystem, onSelectFleet, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('colonies');
  const [colonySort, setColonySort] = useState({ key: 'population', descending: true });
  const [fleetSort, setFleetSort] = useState({ key: 'where', descending: false });
  const color = content.factions[state.empires[player].faction].color;

  const idle = useMemo(() => idleReport(state, player, content), [state, player, content]);

  const colonies = useMemo<ColonyRow[]>(
    () =>
      coloniesOf(state, player).map((system) => {
        const colony = system.colony!;
        const economy = getColonyEconomy(state, system.id, content);
        const forecast = forecastColony(state, system, content);
        const first = forecast.queue[0];
        return {
          id: system.id,
          name: system.name,
          sectorText: sectorLabel(system.sector),
          population: colony.population,
          maxPopulation: economy.maxPopulation,
          morale: colony.morale,
          food: forecast.foodSurplus,
          industry: economy.outputs.industry.total,
          research: economy.outputs.research.total,
          governor: GOVERNOR_LABELS[colony.governor],
          building: first?.name ?? 'Nothing',
          buildTurns: first?.turnsLeft ?? null,
          queued: forecast.queue.length,
          needs: idle.filter((item) => 'system' in item && item.system === system.id).map((item) => idleText(item, state)),
        };
      }),
    [state, player, content, idle],
  );

  const fleets = useMemo<FleetRow[]>(
    () =>
      fleetsOf(state, player).map((fleet) => {
        const plan = fleet.destination ? fleetPlan(state, fleet, fleet.destination, content) : null;
        const counts = new Map<string, number>();
        for (const ship of fleet.ships) {
          const name = content.hulls[ship.hull]?.name ?? ship.hull;
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        const here = systemAt(state, fleet.sector);
        return {
          id: fleet.id,
          where: here && here.id in state.empires[player].knownSystems ? here.name : placeName(state, fleet.sector),
          sectorText: sectorLabel(fleet.sector),
          ships: fleet.ships,
          shipText: [...counts].map(([name, n]) => (n > 1 ? `${n} ${name}` : name)).join(', '),
          orders: fleetOrderText(state, fleet, plan ? plan.turns : null),
          arrives: plan ? plan.turns : null,
          stance: fleet.stance[0].toUpperCase() + fleet.stance.slice(1),
          needs: idle.filter((item) => 'fleet' in item && item.fleet === fleet.id).map((item) => idleText(item, state)),
        };
      }),
    [state, player, content, idle],
  );

  const colonyColumn = COLONY_COLUMNS.find((c) => c.key === colonySort.key)!;
  const fleetColumn = FLEET_COLUMNS.find((c) => c.key === fleetSort.key)!;
  const shownColonies = sortRows(colonies, colonyColumn, colonySort.descending, (r) => r.name);
  const shownFleets = sortRows(fleets, fleetColumn, fleetSort.descending, (r) => r.id);
  const waiting = colonies.filter((r) => r.needs.length > 0).length + fleets.filter((r) => r.needs.length > 0).length;

  // First click sorts a number column high-to-low and a text column A-to-Z; a second click reverses it.
  const toggle = (current: { key: string; descending: boolean }, column: { key: string; numeric: boolean }) =>
    current.key === column.key ? { key: column.key, descending: !current.descending } : { key: column.key, descending: column.numeric };

  const head = <Row,>(columns: Column<Row>[], sort: { key: string; descending: boolean }, onSort: (column: Column<Row>) => void) => (
    <thead>
      <tr>
        {columns.map((column) => (
          <th
            key={column.key}
            scope="col"
            className={column.numeric && !column.textCell ? 'num' : undefined}
            aria-sort={sort.key === column.key ? (sort.descending ? 'descending' : 'ascending') : 'none'}
          >
            <button type="button" className="sort" onClick={() => onSort(column)}>
              {column.label}
              <span aria-hidden="true">{sort.key === column.key ? (sort.descending ? ' ▾' : ' ▴') : ''}</span>
            </button>
          </th>
        ))}
      </tr>
    </thead>
  );

  const needsMark = (needs: string[]) =>
    needs.length > 0 && (
      <span className="needs" title={needs.join('\n')} aria-label={`Needs you: ${needs.join('; ')}`}>
        {' '}
        ●
      </span>
    );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Your empire" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Your empire</h2>
            <p className="muted">
              {colonies.length} {colonies.length === 1 ? 'colony' : 'colonies'} and {fleets.length} {fleets.length === 1 ? 'fleet' : 'fleets'}
              {waiting > 0 ? `; ${waiting} marked ● need you` : ''}. Click a column to sort, or a name to go to it.
            </p>
          </div>
          <button type="button" className="btn primary" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="governors" role="radiogroup" aria-label="List">
          {(
            [
              ['colonies', `Colonies (${colonies.length})`],
              ['fleets', `Fleets (${fleets.length})`],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={tab === key} className={`chip${tab === key ? ' selected' : ''}`} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'colonies' ? (
          <div className="table-scroll">
            <table className="systems-table" aria-label="Colonies">
              {head(COLONY_COLUMNS, colonySort, (column) => setColonySort((s) => toggle(s, column)))}
              <tbody>
                {shownColonies.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          onSelectSystem(row.id);
                          onClose();
                        }}
                      >
                        {row.name}
                      </button>
                      {needsMark(row.needs)} <span className="muted">{row.sectorText}</span>
                    </th>
                    <td className="num">
                      {row.population} / {row.maxPopulation}
                    </td>
                    <td className="num">{row.morale}</td>
                    <td className="num">{signed(row.food)}</td>
                    <td className="num">{row.industry}</td>
                    <td className="num">{row.research}</td>
                    <td>{row.governor}</td>
                    <td>{row.building}</td>
                    <td className="num">{row.queued === 0 ? '' : row.buildTurns === null ? 'stalled' : turns(row.buildTurns)}</td>
                    <td className="num">{row.queued}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="systems-table" aria-label="Fleets">
              {head(FLEET_COLUMNS, fleetSort, (column) => setFleetSort((s) => toggle(s, column)))}
              <tbody>
                {shownFleets.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          onSelectFleet(row.id);
                          onClose();
                        }}
                      >
                        {row.where}
                      </button>
                      {needsMark(row.needs)} <span className="muted">{row.sectorText}</span>
                    </th>
                    <td>
                      {row.ships.map((ship) => {
                        const hull = content.hulls[ship.hull];
                        return hull ? <HullIcon key={ship.id} role={hull.role} tier={hull.tier} color={color} /> : null;
                      })}{' '}
                      {row.shipText}
                    </td>
                    <td>{row.orders}</td>
                    <td className="num">{row.arrives === null ? '' : turns(row.arrives)}</td>
                    <td>{row.stance}</td>
                  </tr>
                ))}
                {shownFleets.length === 0 && (
                  <tr>
                    <td colSpan={FLEET_COLUMNS.length} className="muted">
                      You have no fleets.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
