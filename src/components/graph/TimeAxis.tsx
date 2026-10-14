import type { GraphContext } from '../../contracts/graph';
import { BASE_PX_PER_DAY, createTimeScale, tickStep, type Viewport } from '../../lib/graph-layout';

const label = (date: string, month: boolean) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(
    'en-GB',
    month
      ? { month: 'short', timeZone: 'UTC' }
      : { day: 'numeric', month: 'short', timeZone: 'UTC' },
  );
// A label is about 44 px wide; the T badge is 88 px.
const LABEL_GAP = 48,
  T_HALF = 44;
const nextDate = (date: string) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

export function TimeAxis({
  context,
  T,
  tLabel,
  viewport,
  width,
}: {
  context: GraphContext;
  T: string;
  tLabel: string;
  viewport: Viewport;
  width: number;
}) {
  const scale = createTimeScale(context, BASE_PX_PER_DAY);
  const step = tickStep(BASE_PX_PER_DAY * viewport.zoom);
  const xT = viewport.x + scale.x(T) * viewport.zoom;
  const candidates: { x: number; text: string; month: boolean }[] = [];
  for (let date = context.windowStart; date <= context.windowEnd; date = nextDate(date)) {
    const x = viewport.x + (scale.dateEndX(date) - BASE_PX_PER_DAY) * viewport.zoom;
    if (x < -80 || x > width + 10) continue;
    const month = date.endsWith('-01'),
      monday = new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
    if (month || step === 'day' || (step === 'week' && monday))
      candidates.push({ x, text: label(date, month), month });
  }
  // Month labels win a collision; no label sits under the T badge.
  const ticks: typeof candidates = [];
  for (const tick of [...candidates].sort((a, b) => Number(b.month) - Number(a.month))) {
    const clear =
      Math.abs(tick.x - xT) > T_HALF + 8 &&
      ticks.every((other) => Math.abs(other.x - tick.x) >= LABEL_GAP);
    if (clear) ticks.push(tick);
  }
  return (
    <svg className="time-axis" data-testid="time-axis" width={width} height={28} aria-hidden="true">
      {ticks.map((tick) => (
        <g key={tick.x}>
          <line x1={tick.x} y1={tick.month ? 0 : 18} x2={tick.x} y2={28} stroke="var(--rule)" />
          <text x={tick.x + 4} y={17} fontSize="11" fontWeight={tick.month ? 600 : 400}>
            {tick.text}
          </text>
        </g>
      ))}
      <rect x={xT - T_HALF} y={5} width={T_HALF * 2} height={18} rx={9} fill="var(--ink)" />
      <text x={xT} y={18} textAnchor="middle" fontSize="10.5" fontWeight="600" className="t-label">
        T {tLabel}
      </text>
    </svg>
  );
}
