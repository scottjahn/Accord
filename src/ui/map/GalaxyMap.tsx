import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Content, EmpireId, GameState, SystemId } from '../../sim';
import { fitCamera, pan, pickNearest, screenToWorld, zoomAt, SECTOR_SIZE, type Camera, type Point } from './camera';
import { MapRenderer } from './mapRenderer';
import { buildScene, type MapScene } from './scene';

interface Props {
  state: GameState;
  content: Content;
  player: EmpireId;
  selected: SystemId | null;
  onSelect: (id: SystemId) => void;
}

/** Pointer travel in pixels before a press counts as a drag instead of a click. */
const DRAG_THRESHOLD = 5;
const PICK_RADIUS = SECTOR_SIZE * 0.45;

/**
 * The galaxy map: drag to pan, wheel or buttons to zoom, click a system to select it.
 * React owns the camera and input; MapRenderer owns the PixiJS canvas.
 */
export function GalaxyMap({ state, content, selected, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const dragRef = useRef<{ start: Point; last: Point; moved: boolean } | null>(null);
  const [ready, setReady] = useState(false);
  const [hovering, setHovering] = useState(false);

  const scene = useMemo(() => buildScene(state, content), [state, content]);
  const sceneRef = useRef<MapScene>(scene);
  sceneRef.current = scene;

  const applyCamera = (camera: Camera) => {
    cameraRef.current = camera;
    rendererRef.current?.setCamera(camera);
  };
  const fit = () => {
    const renderer = rendererRef.current;
    if (renderer) applyCamera(fitCamera(sceneRef.current, renderer.viewport));
  };
  const localPoint = (e: { clientX: number; clientY: number }): Point => {
    const rect = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const systemAt = (screen: Point) =>
    pickNearest(sceneRef.current.systems, screenToWorld(cameraRef.current, screen), PICK_RADIUS);

  // Create the renderer once. Initialisation is async, so a cleanup that runs
  // first (React strict mode) is honoured when it finishes.
  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new MapRenderer();
    let disposed = false;
    renderer
      .init(host)
      .then(() => {
        if (disposed) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        applyCamera(fitCamera(sceneRef.current, renderer.viewport));
        setReady(true);
      })
      .catch((error: unknown) => console.error('Galaxy map failed to start', error));

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyCamera(zoomAt(cameraRef.current, localPoint(e), e.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    host.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      disposed = true;
      host.removeEventListener('wheel', onWheel);
      rendererRef.current = null;
      renderer.destroy();
    };
  }, []);

  useEffect(() => {
    if (ready) rendererRef.current?.setScene(scene, selected);
  }, [ready, scene, selected]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const point = localPoint(e);
    dragRef.current = { start: point, last: point, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const point = localPoint(e);
    const drag = dragRef.current;
    if (!drag) {
      setHovering(systemAt(point) !== null);
      return;
    }
    if (!drag.moved && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < DRAG_THRESHOLD) return;
    drag.moved = true;
    applyCamera(pan(cameraRef.current, point.x - drag.last.x, point.y - drag.last.y));
    drag.last = point;
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved) return;
    const hit = systemAt(localPoint(e));
    if (hit) onSelect(hit.id);
  };

  const zoomBy = (factor: number) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const { width, height } = renderer.viewport;
    applyCamera(zoomAt(cameraRef.current, { x: width / 2, y: height / 2 }, factor));
  };

  return (
    <div className="galaxy-map">
      <div
        ref={hostRef}
        className="galaxy-canvas"
        style={{ cursor: dragRef.current?.moved ? 'grabbing' : hovering ? 'pointer' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (dragRef.current = null)}
      />
      <div className="map-controls">
        <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => zoomBy(1.3)}>
          +
        </button>
        <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.3)}>
          −
        </button>
        <button type="button" className="icon-btn" aria-label="Show whole galaxy" onClick={fit}>
          ⤢
        </button>
      </div>
      <p className="map-hint muted">Drag to pan · scroll to zoom · click a system</p>
    </div>
  );
}
