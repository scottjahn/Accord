import { useMemo, useState } from 'react';
import { planetRows, systemRows, type Content, type EmpireId, type GameState, type PlanetRow, type SystemId, type SystemRow } from '../../sim';
import { sectorLabel, signed } from '../format';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  /** Jumps to a system on the main screen. */
  onSelect: (id: SystemId) => void;
  onClose: () => void;
}

type SortKey = 'name' | 'status' | 'planets' | 'room' | 'population' | 'food' | 'energy' | 'distance';
type Filter = 'all' | 'free' | 'yours' | 'others';
type PlanetSortKey = 'name' | 'type' | 'status' | 'room' | 'food' | 'energy' | 'distance';

const PLANET_COLUMNS: { key: PlanetSortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'Planet', numeric: false },
  { key: 'type', label: 'Type', numeric: false },
  { key: 'status', label: 'Status', numeric: false },
  { key: 'room', label: 'Room', numeric: true },
  { key: 'food', label: 'Food', numeric: true },
  { key: 'energy', label: 'Energy', numeric: true },
  { key: 'distance', label: 'Distance', numeric: true },
];

const keeps = (filter: Filter, status: SystemRow['status']): boolean =>
  filter === 'all' ? true : filter === 'free' ? status === 'free' : filter === 'yours' ? status === 'yours' : status === 'rival' || status === 'minor';

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'System', numeric: false },
  { key: 'status', label: 'Status', numeric: false },
  { key: 'planets', label: 'Planets', numeric: true },
  { key: 'room', label: 'Room', numeric: true },
  { key: 'population', label: 'People', numeric: true },
  { key: 'food', label: 'Food', numeric: true },
  { key: 'energy', label: 'Energy', numeric: true },
  { key: 'distance', label: 'Distance', numeric: true },
];

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All known' },
  { key: 'free', label: 'Free to settle' },
  { key: 'yours', label: 'Yours' },
  { key: 'others', label: 'Others' },
];

/** Every system the player has scanned, or every planet in them, in a table that sorts by any column. */
export function SystemsScreen({ state, content, player, onSelect, onClose }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'room', descending: true });
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<'systems' | 'planets'>('systems');
  const [planetSort, setPlanetSort] = useState<{ key: PlanetSortKey; descending: boolean }>({ key: 'room', descending: true });
  const planets = useMemo(() => planetRows(state, player, content), [state, player, content]);
  const rows = useMemo(() => systemRows(state, player, content), [state, player, content]);

  const statusText = (row: Pick<SystemRow, 'status' | 'owner' | 'inRange'> & { id: SystemId }): string => {
    if (row.status === 'yours') return 'Yours';
    if (row.status === 'free') return row.inRange ? 'Free, in range' : 'Free';
    if (row.status === 'minor') return content.minors[state.systems[row.id].minor!.race]?.name ?? 'Minor race';
    return content.factions[state.empires[row.owner!].faction]?.name ?? 'Rival';
  };

  const shown = useMemo(() => {
    const kept = rows.filter((row) => keeps(filter, row.status));
    const value = (row: SystemRow): number | string => {
      if (sort.key === 'name') return row.name;
      if (sort.key === 'status') return statusText(row);
      if (sort.key === 'population') return row.population ?? -1;
      return row[sort.key];
    };
    return [...kept].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const order = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y;
      return (sort.descending ? -order : order) || a.name.localeCompare(b.name);
    });
    // statusText depends only on state and content, which rows already follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, sort]);

  const planetName = (row: PlanetRow) => `${row.systemName} ${row.number}`;
  const planetStatus = (row: PlanetRow) => statusText({ ...row, id: row.system });
  const typeName = (row: PlanetRow) => content.planetTypes[row.type]?.name ?? row.type;
  const shownPlanets = useMemo(() => {
    const value = (row: PlanetRow): number | string => {
      if (planetSort.key === 'name') return planetName(row);
      if (planetSort.key === 'type') return typeName(row);
      if (planetSort.key === 'status') return planetStatus(row);
      return row[planetSort.key];
    };
    return planets
      .filter((row) => keeps(filter, row.status))
      .sort((a, b) => {
        const x = value(a);
        const y = value(b);
        const order = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y;
        return (planetSort.descending ? -order : order) || planetName(a).localeCompare(planetName(b));
      });
    // The text helpers depend only on state and content, which planets already follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planets, filter, planetSort]);
  const sortPlanetsBy = (key: PlanetSortKey, numeric: boolean) =>
    setPlanetSort((current) => (current.key === key ? { key, descending: !current.descending } : { key, descending: numeric }));

  // First click sorts a number column high-to-low and a text column A-to-Z; a second click reverses it.
  const sortBy = (key: SortKey, numeric: boolean) =>
    setSort((current) => (current.key === key ? { key, descending: !current.descending } : { key, descending: numeric }));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Systems" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Systems</h2>
            <p className="muted">
              {view === 'systems'
                ? `${shown.length} of ${rows.length} systems you have scanned. Click a column to sort, or a system to go to it.`
                : `${shownPlanets.length} of ${planets.length} planets in systems you have scanned. Click a column to sort, or a planet to go to its system.`}
            </p>
          </div>
          <button type="button" className="btn primary" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="governors" role="radiogroup" aria-label="List">
          {(
            [
              ['systems', 'Systems'],
              ['planets', 'Planets'],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={view === key} className={`chip${view === key ? ' selected' : ''}`} onClick={() => setView(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="governors" role="radiogroup" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" role="radio" aria-checked={filter === f.key} className={`chip${filter === f.key ? ' selected' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>

        {view === 'planets' && (
          <div className="table-scroll">
            <table className="systems-table">
              <thead>
                <tr>
                  {PLANET_COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={column.numeric ? 'num' : undefined}
                      aria-sort={planetSort.key === column.key ? (planetSort.descending ? 'descending' : 'ascending') : 'none'}
                    >
                      <button type="button" className="sort" onClick={() => sortPlanetsBy(column.key, column.numeric)}>
                        {column.label}
                        <span aria-hidden="true">{planetSort.key === column.key ? (planetSort.descending ? ' ▾' : ' ▴') : ''}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownPlanets.map((row) => (
                  <tr key={`${row.system}:${row.number}`} className={row.status === 'yours' ? 'own' : undefined}>
                    <th scope="row">
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          onSelect(row.system);
                          onClose();
                        }}
                      >
                        {planetName(row)}
                      </button>{' '}
                      <span className="muted">{sectorLabel(row.sector)}</span>
                    </th>
                    <td>{typeName(row)}</td>
                    <td>{planetStatus(row)}</td>
                    <td className="num">{row.room}</td>
                    <td className="num">{signed(row.food)}%</td>
                    <td className="num">{signed(row.energy)}%</td>
                    <td className="num">{row.distance}</td>
                  </tr>
                ))}
                {shownPlanets.length === 0 && (
                  <tr>
                    <td colSpan={PLANET_COLUMNS.length} className="muted">
                      No planets match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-scroll" hidden={view !== 'systems'}>
          <table className="systems-table">
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.numeric ? 'num' : undefined}
                    aria-sort={sort.key === column.key ? (sort.descending ? 'descending' : 'ascending') : 'none'}
                  >
                    <button type="button" className="sort" onClick={() => sortBy(column.key, column.numeric)}>
                      {column.label}
                      <span aria-hidden="true">{sort.key === column.key ? (sort.descending ? ' ▾' : ' ▴') : ''}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id} className={row.status === 'yours' ? 'own' : undefined}>
                  <th scope="row">
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        onSelect(row.id);
                        onClose();
                      }}
                    >
                      {row.name}
                    </button>{' '}
                    <span className="muted">{sectorLabel(row.sector)}</span>
                  </th>
                  <td>{statusText(row)}</td>
                  <td className="num">{row.planets}</td>
                  <td className="num">{row.room}</td>
                  <td className="num">{row.population ?? '?'}</td>
                  <td className="num">{signed(row.food)}%</td>
                  <td className="num">{signed(row.energy)}%</td>
                  <td className="num">{row.distance}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="muted">
                    No systems match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
