const LINES = [['var(--proceed)', undefined, 'Closed'], ['var(--route)', undefined, 'Open'], ['var(--danger)', undefined, '✕ Broken'], ['var(--caution)', undefined, '! Warning'], ['var(--isolated)', undefined, 'Declined or cancelled'], ['var(--route)', '7 5', 'Hedged promise'], ['var(--route)', '1.5 4', 'Waiting for reply']] as const;

export function Legend() {
  return (
    <div className="legend" aria-label="Line legend">
      {LINES.map(([color, dash, text]) => (
        <span key={text}><svg width="28" height="8" aria-hidden="true"><line x1="1" y1="4" x2="27" y2="4" stroke={color} strokeWidth="3" strokeDasharray={dash} strokeLinecap={dash ? 'round' : undefined} /></svg>{text}</span>
      ))}
      <span><svg width="28" height="8" aria-hidden="true"><line x1="3" y1="4" x2="25" y2="4" stroke="var(--caution)" strokeWidth="5" strokeLinecap="round" opacity=".85" /></svg>Due soon</span>
      <span><svg width="20" height="12" aria-hidden="true"><polygon points="10,1 16,6 10,11 4,6" fill="var(--surface)" stroke="var(--ink)" strokeDasharray="2 2" /></svg>Planned date, before a slip</span>
    </div>
  );
}
