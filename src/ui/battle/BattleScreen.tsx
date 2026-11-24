import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createTacticalBattle,
  orderTactical,
  runTactical,
  stepTactical,
  tacticalOutcome,
  tacticalResult,
  tacticalTally,
  yieldTactical,
  type BattleOutcome,
  type BattleSetup,
  type Content,
  type EmpireId,
  type HullRole,
  type TacticalBattle,
  type TacticalOptions,
  type TacticalOrder,
  type TacticalResult,
} from '../../sim';
import { HullIcon } from '../fleet/HullIcon';
import { bakeBackdrop, drawBattle, driftWrecks, effectsForStep, fitView, toWorld, unitAt, type BattleView, type Effect, type Wreck } from './battleRenderer';

interface Props {
  content: Content;
  setup: BattleSetup;
  options: TacticalOptions;
  title: string;
  /** Display name and colour of each empire in the battle. */
  sides: Record<EmpireId, { name: string; color: string }>;
  /** Called with the result once the player leaves the finished battle. */
  onFinish: (outcome: BattleOutcome) => void;
}

const SPEEDS = [0, 1, 2, 4] as const;
type Speed = (typeof SPEEDS)[number];

/** At most this many ticks are simulated per frame, so a stalled tab does not freeze when it wakes. */
const MAX_TICKS_PER_FRAME = 12;

const RESULT_TEXT: Record<TacticalResult, string> = {
  fighting: 'Fighting',
  won: 'Victory',
  lost: 'Defeat',
  withdrew: 'Withdrawn',
  unfinished: 'Stalemate',
};

/**
 * A battle fought in real time, top down. Select ships with a click or by
 * dragging a box; right-click an enemy to attack it or empty space to move
 * there. The battle runs until no armed ship has an enemy left on the field.
 */
export function BattleScreen({ content, setup, options, title, sides, onFinish }: Props) {
  const battleRef = useRef<TacticalBattle | null>(null);
  if (battleRef.current === null) battleRef.current = createTacticalBattle(setup, content, options);
  const battle = battleRef.current;
  const player = options.player;
  const colors = useMemo(() => Object.fromEntries(Object.entries(sides).map(([id, s]) => [id, s.color])) as Record<EmpireId, string>, [sides]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [speed, setSpeed] = useState<Speed>(1);
  const speedRef = useRef<Speed>(1);
  speedRef.current = speed;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  /** Bumped a few times a second so the side panel follows the battle. */
  const [, setFrame] = useState(0);
  const [over, setOver] = useState(false);

  const effects = useRef<Effect[]>([]);
  const wrecks = useRef<Wreck[]>([]);
  const memory = useRef({ lastProjectile: 0 });
  const weapons = content.rules.combat.tactical.weapons;
  const view = useRef<BattleView>({ scale: 1, ox: 0, oy: 0 });
  const backdrop = useRef<HTMLCanvasElement | null>(null);
  const size = useRef({ width: 0, height: 0 });
  const drag = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const hover = useRef<string | null>(null);

  // Keep the canvas the size of its box, at the screen's pixel density.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const width = Math.max(200, wrap.clientWidth);
      const height = Math.max(200, wrap.clientHeight);
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      size.current = { width, height };
      view.current = fitView(battle, width, height);
      backdrop.current = bakeBackdrop(battle, view.current, width, height, ratio);
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [battle]);

  // The frame loop: step the battle at the chosen speed, age the effects, draw.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let carry = 0;
    let sincePanel = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!battle.over && speedRef.current > 0) {
        carry += dt * battle.ticksPerSecond * speedRef.current;
        let n = 0;
        while (carry >= 1 && n < MAX_TICKS_PER_FRAME && !battle.over) {
          stepTactical(battle, content);
          effects.current.push(...effectsForStep(battle, colors, weapons, memory.current, wrecks.current));
          carry -= 1;
          n++;
        }
        if (n === MAX_TICKS_PER_FRAME) carry = 0;
        if (battle.over) setOver(true);
      }
      const visualDt = dt * Math.max(1, speedRef.current);
      for (const e of effects.current) e.age += speedRef.current === 0 ? 0 : visualDt;
      if (speedRef.current > 0) driftWrecks(wrecks.current, visualDt);
      effects.current = effects.current.filter((e) => e.age < e.life);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const ratio = canvas.width / Math.max(1, size.current.width);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawBattle(ctx, battle, view.current, backdrop.current, size.current.width, size.current.height, {
          colors,
          weapons,
          wrecks: wrecks.current,
          player,
          selected: selectedRef.current,
          effects: effects.current,
          box: drag.current,
          hover: hover.current,
        });
      }
      sincePanel += dt;
      if (sincePanel > 0.2) {
        sincePanel = 0;
        // Lost and departed ships drop out of the selection.
        const alive = [...selectedRef.current].filter((id) => battle.units.find((u) => u.id === id)?.status === 'active');
        if (alive.length !== selectedRef.current.size) setSelected(new Set(alive));
        setFrame((f) => f + 1);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [battle, content, colors, player, weapons]);

  const mine = player ? battle.units.filter((u) => u.empire === player && u.status === 'active') : [];
  const chosen = mine.filter((u) => selected.has(u.id));

  const give = (order: TacticalOrder, ids = chosen.map((u) => u.id)) => {
    if (!player || ids.length === 0) return;
    orderTactical(battle, player, ids, order);
    setFrame((f) => f + 1);
  };

  const pointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const p = pointer(e);
    drag.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointer(e);
    const w = toWorld(view.current, p.x, p.y);
    hover.current = unitAt(battle, w.x, w.y, 8 / view.current.scale)?.id ?? null;
    if (drag.current) {
      drag.current.x1 = p.x;
      drag.current.y1 = p.y;
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = drag.current;
    drag.current = null;
    if (!box || e.button !== 0 || !player) return;
    const add = e.shiftKey;
    const next = new Set(add ? selected : []);
    if (Math.abs(box.x1 - box.x0) < 5 && Math.abs(box.y1 - box.y0) < 5) {
      const w = toWorld(view.current, box.x1, box.y1);
      const hit = unitAt(battle, w.x, w.y, 8 / view.current.scale);
      if (hit && hit.empire === player) {
        if (add && next.has(hit.id)) next.delete(hit.id);
        else next.add(hit.id);
      } else if (hit && chosen.length > 0 && !add) {
        // A left click on an enemy with ships selected is an attack order too.
        give({ kind: 'attack', target: hit.id });
        return;
      }
    } else {
      const a = toWorld(view.current, Math.min(box.x0, box.x1), Math.min(box.y0, box.y1));
      const b = toWorld(view.current, Math.max(box.x0, box.x1), Math.max(box.y0, box.y1));
      for (const u of mine) if (u.x >= a.x && u.x <= b.x && u.y >= a.y && u.y <= b.y) next.add(u.id);
    }
    setSelected(next);
  };

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!player || chosen.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const w = toWorld(view.current, e.clientX - rect.left, e.clientY - rect.top);
    const hit = unitAt(battle, w.x, w.y, 8 / view.current.scale);
    if (hit && hit.empire !== player) {
      give({ kind: 'attack', target: hit.id });
      return;
    }
    // Move as a group: each ship keeps its place relative to the group's centre, drawn in a little.
    const cx = chosen.reduce((s, u) => s + u.x, 0) / chosen.length;
    const cy = chosen.reduce((s, u) => s + u.y, 0) / chosen.length;
    for (const u of chosen) {
      const dx = (u.x - cx) * 0.6;
      const dy = (u.y - cy) * 0.6;
      const d = Math.hypot(dx, dy);
      const k = d > 120 ? 120 / d : 1;
      orderTactical(battle, player, [u.id], { kind: 'move', x: w.x + dx * k, y: w.y + dy * k });
    }
    setFrame((f) => f + 1);
  };

  const finishNow = () => {
    // The computer takes over the player's side and the battle plays out at once.
    if (player) yieldTactical(battle, player);
    runTactical(battle, content);
    setOver(true);
  };

  const tally = tacticalTally(battle);
  const result = player ? tacticalResult(battle, player) : battle.over ? 'won' : 'fighting';
  const seconds = Math.floor(battle.tick / battle.ticksPerSecond);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="battle-screen" role="dialog" aria-modal="true" aria-label={title}>
      <header className="battle-bar">
        <h2>{title}</h2>
        <span className="muted battle-clock" aria-label="Battle time">
          {clock}
        </span>
        <div className="battle-speed" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" className={`btn small${speed === s ? ' primary' : ''}`} aria-pressed={speed === s} onClick={() => setSpeed(s)} disabled={over}>
              {s === 0 ? 'Pause' : `${s}×`}
            </button>
          ))}
        </div>
        <button type="button" className="btn small" onClick={finishNow} disabled={over}>
          Finish automatically
        </button>
      </header>
      <div className="battle-body">
        <div className="battle-field" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            aria-label="Battlefield"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onContextMenu={onContextMenu}
          />
          {over && (
            <div className="battle-result" role="status">
              <h3>{RESULT_TEXT[result]}</h3>
              <ul className="planet-list">
                {tally.map((t) => (
                  <li key={t.empire}>
                    <span>
                      <span className="dot" style={{ background: sides[t.empire]?.color }} /> {sides[t.empire]?.name ?? t.empire}
                    </span>
                    <span className="muted">
                      {t.active} holding, {t.withdrawn} withdrew, {t.destroyed} lost
                    </span>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn primary" onClick={() => onFinish(tacticalOutcome(battle))}>
                Continue
              </button>
            </div>
          )}
        </div>
        <aside className="battle-side" aria-label="Battle orders">
          <section>
            <h3>Forces</h3>
            <ul className="planet-list">
              {tally.map((t) => (
                <li key={t.empire}>
                  <span>
                    <span className="dot" style={{ background: sides[t.empire]?.color }} /> {sides[t.empire]?.name ?? t.empire}
                  </span>
                  <span className="muted">
                    {t.active}/{t.started}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          {player && (
            <section>
              <h3>Orders</h3>
              <div className="battle-orders">
                <button type="button" className="btn small" onClick={() => setSelected(new Set(mine.map((u) => u.id)))} disabled={over}>
                  Select all
                </button>
                <button type="button" className="btn small" onClick={() => give({ kind: 'auto' })} disabled={over || chosen.length === 0} title="Fight as the fleet's stance says">
                  Engage
                </button>
                <button type="button" className="btn small" onClick={() => give({ kind: 'hold' })} disabled={over || chosen.length === 0} title="Stay put and fire at anything in range">
                  Hold
                </button>
                <button type="button" className="btn small" onClick={() => give({ kind: 'withdraw' })} disabled={over || chosen.length === 0} title="Leave through your own edge of the field">
                  Withdraw
                </button>
                <button type="button" className="btn small danger" onClick={() => give({ kind: 'withdraw' }, mine.map((u) => u.id))} disabled={over || mine.length === 0}>
                  Withdraw all
                </button>
              </div>
              <p className="muted battle-help">
                Click or drag to select. Right-click an enemy to attack it, or empty space to move there. Shift adds to the selection.
              </p>
            </section>
          )}
          <section>
            <h3>{chosen.length > 0 ? `Selected (${chosen.length})` : 'Your ships'}</h3>
            <ul className="battle-units">
              {(chosen.length > 0 ? chosen : mine).map((u) => (
                <li key={u.id} className={selected.has(u.id) ? 'selected' : undefined}>
                  <button type="button" className="link" onClick={(e) => setSelected(e.shiftKey ? new Set([...selected, u.id]) : new Set([u.id]))}>
                    {u.role !== 'battery' && <HullIcon role={u.role as HullRole} tier={u.tier} color={colors[u.empire]} />} {u.name}
                  </button>
                  <span className="battle-hp" aria-label={`Hull ${u.hp} of ${u.maxHp}`}>
                    <span style={{ width: `${(100 * u.hp) / u.maxHp}%` }} />
                  </span>
                  <span className="muted">{orderLabel(u.order)}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function orderLabel(order: TacticalOrder): string {
  if (order.kind === 'auto') return 'engaging';
  if (order.kind === 'move') return 'moving';
  if (order.kind === 'attack') return 'attacking';
  if (order.kind === 'hold') return 'holding';
  return 'withdrawing';
}
