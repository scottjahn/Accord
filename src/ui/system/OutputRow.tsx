import { useState } from 'react';
import type { OutputBreakdown, OutputKind } from '../../sim';
import { OUTPUT_LABELS, lineValue } from '../format';

interface Props {
  kind: OutputKind;
  workers: number;
  /** The most workers this slider may take: its own plus everyone idle. */
  maxWorkers: number;
  population: number;
  output: OutputBreakdown;
  onChange: (workers: number) => void;
}

/** One output: a worker slider, the total it produces, and the causes behind that total. */
export function OutputRow({ kind, workers, maxWorkers, population, output, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const label = OUTPUT_LABELS[kind];
  const detailsId = `breakdown-${kind}`;

  return (
    <li className={`output-row kind-${kind}`}>
      <div className="output-main">
        <span className="output-label">{label}</span>
        <input
          type="range"
          aria-label={`${label} workers`}
          min={0}
          max={population}
          step={1}
          value={workers}
          onChange={(e) => onChange(Math.min(maxWorkers, Number(e.target.value)))}
        />
        <span className="output-workers" data-testid={`workers-${kind}`}>
          {workers}
        </span>
        <button
          type="button"
          className="output-total"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={`${label} ${output.total}, show breakdown`}
          onClick={() => setOpen(!open)}
        >
          <span data-testid={`total-${kind}`}>{output.total}</span>
          <span className="chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
        </button>
      </div>
      {open && (
        <table className="breakdown" id={detailsId}>
          <tbody>
            {output.lines.length === 0 && (
              <tr>
                <td className="muted">Nothing produces {label.toLowerCase()} here</td>
                <td />
              </tr>
            )}
            {output.lines.map((line, i) => (
              <tr key={i}>
                <td>{line.source}</td>
                <td className="num">{lineValue(line)}</td>
              </tr>
            ))}
            <tr className="breakdown-total">
              <td>Total</td>
              <td className="num">{output.total}</td>
            </tr>
          </tbody>
        </table>
      )}
    </li>
  );
}
