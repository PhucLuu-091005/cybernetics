'use client';
import { useEffect, useRef, useState } from 'react';

export type Preset = 'project' | 'week' | 'month' | 0.5 | 1 | 2;
const PRESETS: readonly (readonly [Preset, string] | null)[] = [
  ['project', 'Fit the project'],
  ['week', 'Fit this week'],
  ['month', 'Fit this month'],
  null,
  [0.5, '50%'],
  [1, '100%'],
  [2, '200%'],
];

const Icon = ({ d }: { d: string }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

export function CanvasControls({
  zoom,
  onStep,
  onPreset,
  minimap,
  onMinimap,
  fullscreen,
  fullscreenEnabled,
  onFullscreen,
}: {
  zoom: number;
  onStep(direction: 1 | -1): void;
  onPreset(preset: Preset): void;
  minimap: boolean;
  onMinimap(): void;
  fullscreen: boolean;
  fullscreenEnabled: boolean;
  onFullscreen(): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="canvas-controls-wrap">
      {open && (
        <div className="canvas-menu" role="menu" aria-label="Zoom presets">
          {PRESETS.map((item, index) =>
            item === null ? (
              <hr key={index} />
            ) : (
              <button
                key={item[1]}
                type="button"
                role="menuitem"
                onClick={() => {
                  onPreset(item[0]);
                  setOpen(false);
                }}
              >
                {item[1]}
              </button>
            ),
          )}
        </div>
      )}
      <div className="canvas-controls" role="toolbar" aria-label="Canvas controls">
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => onStep(-1)}>
          <Icon d="M5 12h14" />
        </button>
        <button
          type="button"
          className="pct"
          aria-label="Zoom level"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => onStep(1)}>
          <Icon d="M12 5v14M5 12h14" />
        </button>
        <span className="sep" aria-hidden="true" />
        <button
          type="button"
          aria-label="Fit the project"
          title="Fit the project"
          onClick={() => onPreset('project')}
        >
          <Icon d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
        </button>
        <button
          type="button"
          aria-label="Minimap"
          title="Minimap"
          aria-pressed={minimap}
          onClick={onMinimap}
        >
          <Icon d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM12 12h6v5h-6z" />
        </button>
        {fullscreenEnabled && (
          <button
            type="button"
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            title={fullscreen ? 'Exit full screen' : 'Full screen'}
            onClick={onFullscreen}
          >
            <Icon
              d={
                fullscreen
                  ? 'M14 10l7-7M20 10h-6V4M3 21l7-7M4 14h6v6'
                  : 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7'
              }
            />
          </button>
        )}
      </div>
    </div>
  );
}
