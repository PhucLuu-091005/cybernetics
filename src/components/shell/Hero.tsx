function Flag({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g stroke={color} fill={color}>
      <line x1={x} y1={y} x2={x} y2={y - 18} strokeWidth="1.5" />
      <path d={`M${x} ${y - 18} l10 4 -10 4 z`} />
    </g>
  );
}

export function Hero() {
  const label = { textAnchor: 'middle', fontSize: 12, fill: 'var(--ink-2)' } as const;
  const event = { r: 7, fill: 'var(--surface)', stroke: 'var(--proceed)', strokeWidth: 2.5 };
  return (
    <svg
      className="hero-svg"
      viewBox="0 0 560 172"
      role="img"
      aria-label="Two work items on a project graph: events along each row, a planned finish that moved with a reason, and the milestone they lead to"
    >
      <line x1="10" y1="34" x2="550" y2="34" stroke="var(--trunk)" strokeWidth="3" />
      <polygon
        points="480,26 488,34 480,42 472,34"
        fill="var(--surface)"
        stroke="var(--trunk)"
        strokeWidth="2"
      />
      <text x="480" y="16" {...label}>
        Go-live
      </text>
      <path className="draw" d="M40 84 H290" fill="none" stroke="var(--proceed)" strokeWidth="3" />
      <g className="pop" style={{ animationDelay: '.5s' }}>
        <circle cx="60" cy="84" {...event} />
        <text x="60" y="66" {...label}>
          Message
        </text>
      </g>
      <g className="pop" style={{ animationDelay: '1s' }}>
        <circle cx="170" cy="84" {...event} />
        <text x="170" y="66" {...label}>
          Handoff
        </text>
      </g>
      <g className="pop" style={{ animationDelay: '1.5s' }}>
        <circle cx="290" cy="84" r="7" fill="var(--proceed)" />
        <text x="290" y="66" {...label}>
          Done
        </text>
      </g>
      <path
        className="draw"
        d="M290 84 C318 84 306 136 334 136 H450"
        fill="none"
        stroke="var(--route)"
        strokeWidth="3"
      />
      <g className="pop" style={{ animationDelay: '2s' }}>
        <path d="M450 136 H500" fill="none" stroke="var(--danger)" strokeWidth="3" />
        <Flag x={400} y={136} color="var(--ink-3)" />
        <Flag x={450} y={136} color="var(--danger)" />
        <path d="M406 106 H440" stroke="var(--ink-3)" strokeWidth="1" />
        <path d="M444 106 l-6 -3.5 v7 z" fill="var(--ink-3)" />
        <text x="425" y="162" {...label}>
          Moved, with a reason
        </text>
      </g>
      <line
        className="pop"
        style={{ animationDelay: '2.4s' }}
        x1="500"
        y1="136"
        x2="480"
        y2="42"
        stroke="var(--ink-3)"
        strokeWidth="1"
      />
    </svg>
  );
}
