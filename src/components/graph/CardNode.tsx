import type { Node, NodeProps } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import type { ActType } from '../../contracts/graph';
import type { ActGlyph } from '../../contracts/layout';
import { CARD } from '../../lib/graph-layout';
import { ActIcon, SourceIcon } from './icons';
import type { ActSource } from './source-link';
import { useGraphUi } from './ui-context';

/** What an event card shows; GraphScreen builds it from the engine act and the graph view sources. */
export type CardInfo = {
  type: ActType;
  label: string;
  when: string;
  person: string;
  quote: string | null;
  source: ActSource;
};
export type CardNodeType = Node<{ glyph: ActGlyph; info: CardInfo; color: string }, 'card'>;

export function CardNode({ data }: NodeProps<CardNodeType>) {
  const ui = useGraphUi();
  const { glyph, info, color } = data,
    { link, app, label } = info.source;
  const faded = ui.faded.has(glyph.loopId);
  // A mouse press on a card drags the card, not the canvas; touches still reach the canvas, so a pinch over a card zooms.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const stop = (event: MouseEvent) => event.stopPropagation();
    element.addEventListener('mousedown', stop);
    return () => element.removeEventListener('mousedown', stop);
  }, []);
  return (
    <div
      ref={root}
      className={`ev-card${ui.currentActId === glyph.id ? ' cur' : ''}`}
      data-act={glyph.id}
      title={info.quote ?? undefined}
      style={{
        width: CARD.width,
        height: CARD.height,
        ['--tone' as string]: color,
        opacity: faded ? 0.4 : 1,
      }}
      onPointerDown={(event) => ui.startDrag(event, glyph)}
    >
      <div className="ev-h">
        <ActIcon type={info.type} />
        <b>{info.label}</b>
        <span className="d">{info.when}</span>
      </div>
      <div className="ev-p">{info.person}</div>
      <div className={info.quote === null ? 'ev-q unavailable' : 'ev-q'}>
        {info.quote ?? 'Unavailable evidence'}
      </div>
      <a
        className="ev-s"
        href={link.href}
        target={link.external ? '_blank' : undefined}
        rel={link.external ? 'noopener noreferrer' : undefined}
        aria-label={`${link.text}${label ? `: ${label}` : ''}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {app && <SourceIcon app={app} />}
        <span>{label ?? link.text}</span>
        <span aria-hidden="true">{link.external ? '↗' : '→'}</span>
      </a>
    </div>
  );
}
