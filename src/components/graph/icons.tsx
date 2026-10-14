import type { ReactNode } from 'react';
import type { ActType } from '../../contracts/graph';
import type { SourceApp } from '../../lib/source-app';

// Lucide 1.48 shapes (ISC licence) on a 24 px grid; Gmail and Linear are Simple Icons 16.32 marks (CC0).
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const CALENDAR_CLOCK = (
  <g {...STROKE}>
    <path d="M16 14v2.2l1.6 1" />
    <path d="M16 2v3" />
    <path d="M21 7.338V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2.338" />
    <path d="M3 9h5.859" />
    <path d="M8 2v3" />
    <circle cx="16" cy="16" r="6" />
  </g>
);
const BAN = (
  <g {...STROKE}>
    <circle cx="12" cy="12" r="10" />
    <path d="m4.9 4.9 14.2 14.2" />
  </g>
);

const ACT_ICON: Record<ActType, ReactNode> = {
  request: (
    <g {...STROKE}>
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </g>
  ),
  promise: (
    <g {...STROKE}>
      <path d="m11 17 2 2a1 1 0 1 0 3-3" />
      <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
      <path d="m21 3 1 11h-2" />
      <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
      <path d="M3 4h8" />
    </g>
  ),
  report_done: (
    <g {...STROKE}>
      <path d="M12 22V12" />
      <path d="m16 17 2 2 4-4" />
      <path d="M21 11.127V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l1.32-.753" />
      <path d="M3.29 7 12 12l8.71-5" />
      <path d="m7.5 4.27 8.997 5.148" />
    </g>
  ),
  accept: (
    <g {...STROKE} strokeWidth={2.4}>
      <path d="M18 6 7 17l-5-5" />
      <path d="m22 10-7.5 7.5L13 16" />
    </g>
  ),
  reject: (
    <g {...STROKE} strokeWidth={2.4}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </g>
  ),
  counter: CALENDAR_CLOCK,
  renegotiate: CALENDAR_CLOCK,
  agree_change: CALENDAR_CLOCK,
  follow_up: (
    <g {...STROKE}>
      <path d="M10.268 21a2 2 0 0 0 3.464 0" />
      <path d="M22 8c0-2.3-.8-4.3-2-6" />
      <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
      <path d="M4 2C2.8 3.7 2 5.7 2 8" />
    </g>
  ),
  decline: BAN,
  cancel: BAN,
};

const SOURCE_ICON: Record<SourceApp, ReactNode> = {
  slack: (
    <g {...STROKE} strokeWidth={2.6}>
      <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
    </g>
  ),
  gmail: (
    <path
      fill="currentColor"
      d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"
    />
  ),
  linear: (
    <path
      fill="currentColor"
      d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z"
    />
  ),
  paste: (
    <g {...STROKE}>
      <path d="M11 14h10" />
      <path d="M16 4h2a2 2 0 0 1 2 2v1.344" />
      <path d="m17 18 4-4-4-4" />
      <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
    </g>
  ),
  agent: (
    <g {...STROKE}>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
    </g>
  ),
};

/** For use inside an SVG: the icon centred on (x, y). */
export function ActIconAt({
  type,
  x,
  y,
  size,
}: {
  type: ActType;
  x: number;
  y: number;
  size: number;
}) {
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${size / 24})`}>
      {ACT_ICON[type]}
    </g>
  );
}

export function ActIcon({ type, size = 14 }: { type: ActType; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {ACT_ICON[type]}
    </svg>
  );
}

export function SourceIcon({ app, size = 12 }: { app: SourceApp; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {SOURCE_ICON[app]}
    </svg>
  );
}
