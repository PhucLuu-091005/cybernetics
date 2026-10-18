import type { CardInfo } from './CardNode';
import { ActIcon, SourceIcon } from './icons';

/** What the pointer is over when the event cards are hidden: one or more stacked events, a branch, or a milestone. */
export type Hover = (
  | {
      kind: 'events';
      loopTitle: string;
      department: string;
      color: string;
      events: CardInfo[];
      x: number;
      y: number;
      radius: number;
    }
  | { kind: 'label'; title: string; detail: string; x: number; y: number }
) & { stageWidth: number; stageHeight: number };

function EventBody({
  info,
  full,
  onViewRecord,
}: {
  info: CardInfo;
  full: boolean;
  onViewRecord(info: CardInfo): void;
}) {
  const { link, app, label } = info.source;
  return (
    <>
      <div className="ev-h">
        <ActIcon type={info.type} />
        <b>{info.label}</b>
        <span className="d">{info.day}</span>
      </div>
      <div className="ev-p">
        <span>{info.person}</span>
        <span className="d">{info.time}</span>
      </div>
      <div className={`ev-q${info.quote === null ? ' unavailable' : ''}${full ? '' : ' one'}`}>
        {info.quote ?? 'Unavailable evidence'}
      </div>
      {full && (
        <a
          className="ev-s"
          href={link.href}
          target={link.external ? '_blank' : undefined}
          rel={link.external ? 'noopener noreferrer' : undefined}
          aria-label={`${link.text}${label ? `: ${label}` : ''}`}
          onClick={(event) => {
            if (link.external) return;
            event.preventDefault();
            onViewRecord(info);
          }}
        >
          {app && <SourceIcon app={app} />}
          <span>{label ?? link.text}</span>
          <span aria-hidden="true">{link.external ? '↗' : '→'}</span>
        </a>
      )}
    </>
  );
}

const MAX_LISTED = 6,
  CARD_WIDTH = 248;

/** Shown when the zoom hides the event cards. The pointer can move into it, so its source link stays clickable. */
export function HoverCard({
  hover,
  onKeep,
  onLeave,
  onViewRecord,
}: {
  hover: Hover;
  onKeep(): void;
  onLeave(): void;
  onViewRecord(info: CardInfo): void;
}) {
  if (hover.kind === 'label')
    return (
      <div className="line-tag" style={{ left: hover.x + 12, top: hover.y - 30 }} role="tooltip">
        <b>{hover.title}</b>
        <span> · {hover.detail}</span>
      </div>
    );
  const { events } = hover,
    single = events.length === 1,
    stage = { width: hover.stageWidth, height: hover.stageHeight };
  const left = Math.min(Math.max(hover.x - CARD_WIDTH / 2, 8), stage.width - CARD_WIDTH - 8);
  const above = hover.y > stage.height / 2;
  return (
    <div
      className="hover-card"
      role="tooltip"
      style={{
        left,
        width: CARD_WIDTH,
        ['--tone' as string]: hover.color,
        ...(above
          ? { bottom: stage.height - hover.y + hover.radius + 6 }
          : { top: hover.y + hover.radius + 6 }),
      }}
      onPointerEnter={onKeep}
      onPointerLeave={onLeave}
    >
      <div className="hc-loop">
        <b>{hover.loopTitle}</b> · {hover.department}
      </div>
      {single ? (
        <EventBody info={events[0]} full onViewRecord={onViewRecord} />
      ) : (
        <div className="hc-list">
          {events.slice(0, MAX_LISTED).map((info) => (
            <div key={info.recordVersionId + info.day + info.time + info.label}>
              <EventBody info={info} full={false} onViewRecord={onViewRecord} />
            </div>
          ))}
          {events.length > MAX_LISTED && (
            <div className="hc-more">{events.length - MAX_LISTED} more events</div>
          )}
        </div>
      )}
    </div>
  );
}
