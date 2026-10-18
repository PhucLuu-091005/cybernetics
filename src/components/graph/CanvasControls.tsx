'use client';

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
  onFit,
  fullscreen,
  fullscreenEnabled,
  onFullscreen,
  onResetLayout,
  listOpen,
  onList,
}: {
  zoom: number;
  onStep(direction: 1 | -1): void;
  onFit(): void;
  fullscreen: boolean;
  fullscreenEnabled: boolean;
  onFullscreen(): void;
  /** Present only when the user moved something. */
  onResetLayout: (() => void) | null;
  listOpen: boolean;
  onList(): void;
}) {
  return (
    <div className="canvas-controls-wrap">
      <div className="canvas-controls" role="toolbar" aria-label="Canvas controls">
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => onStep(-1)}>
          <Icon d="M5 12h14" />
        </button>
        <output className="pct" aria-label="Zoom level">
          {Math.round(zoom * 100)}%
        </output>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => onStep(1)}>
          <Icon d="M12 5v14M5 12h14" />
        </button>
        <span className="sep" aria-hidden="true" />
        {onResetLayout && (
          <button
            type="button"
            aria-label="Reset layout"
            title="Reset layout"
            onClick={onResetLayout}
          >
            <Icon d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
          </button>
        )}
        <button type="button" aria-label="Fit the project" title="Fit the project" onClick={onFit}>
          <Icon d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
        </button>
        <button
          type="button"
          aria-label="Loop list"
          title="Loop list"
          aria-pressed={listOpen}
          onClick={onList}
        >
          <Icon d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
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
