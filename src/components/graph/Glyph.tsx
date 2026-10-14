import type { ActType } from '../../contracts/graph';

/** Act glyph shapes from the approved design (SRD 7.1); colour is passed in so the branch tone carries through. */
export function Glyph({
  type,
  x,
  y,
  color,
  r = 5,
}: {
  type: ActType;
  x: number;
  y: number;
  color: string;
  r?: number;
}) {
  const stroke = { stroke: color, strokeWidth: 2 };
  switch (type) {
    case 'request':
      return <circle cx={x} cy={y} r={r} fill="var(--surface)" {...stroke} />;
    case 'promise':
      return <circle cx={x} cy={y} r={r} fill={color} />;
    case 'counter':
    case 'renegotiate':
      return (
        <polygon
          points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`}
          fill="var(--surface)"
          {...stroke}
        />
      );
    case 'agree_change':
      return (
        <g>
          <circle cx={x} cy={y} r={r + 1} fill="var(--surface)" {...stroke} />
          <path d={`M${x - 3} ${y} l2 2.4 l4 -4.6`} fill="none" {...stroke} />
        </g>
      );
    case 'report_done':
      return (
        <g>
          <circle cx={x} cy={y} r={r} fill="var(--surface)" {...stroke} />
          <path d={`M${x} ${y - r} A${r} ${r} 0 0 1 ${x} ${y + r} Z`} fill={color} />
        </g>
      );
    case 'accept':
      return (
        <circle cx={x} cy={y} r={r - 1} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
      );
    case 'reject':
      return (
        <path
          d={`M${x - r} ${y - r} L${x + r} ${y + r} M${x - r} ${y + r} L${x + r} ${y - r}`}
          stroke={color}
          strokeWidth={2.6}
        />
      );
    case 'follow_up':
      return <circle cx={x} cy={y} r={2.6} fill={color} />;
    case 'decline':
    case 'cancel':
      return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} fill={color} />;
  }
}
