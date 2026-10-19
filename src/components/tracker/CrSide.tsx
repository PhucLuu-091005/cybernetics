'use client';
import { useRef, type ReactNode } from 'react';
import { onlyMainNote } from '../../tracker';
import {
  firstUnpicked,
  pickedCount,
  SKIP_REASON,
  type ReviewChange,
  type ReviewModel,
} from '../../tracker/review';
import { Avatar } from './avatar';
import { isOpen, mergerNames, plural, trunc, type Session } from './ContextBar';
import { Icon, KindIcon } from './icons';
import type { TrackerActions } from './TrackerScreen';

export type SideTab = 'changes' | 'queue';
export const SIDE_ID = 'tk-side';

function ChangeIcon({ change, size }: { change: ReviewChange; size: number }) {
  return change.d.icon ? (
    <KindIcon kind={change.d.icon} size={size} />
  ) : (
    <Icon name="pencil" size={size} />
  );
}

function ClashBox({
  session,
  model,
  canPick,
  onPick,
  onPickAll,
  onShow,
}: {
  session: Session;
  model: ReviewModel;
  canPick: boolean;
  onPick: (key: string, side: 'main' | 'cr') => void;
  onPickAll: (side: 'main' | 'cr') => void;
  onShow: (key: string) => void;
}) {
  const { dir } = session;
  const { cr, picks, clashes } = model;
  const list = useRef<HTMLDivElement>(null);
  const picked = pickedCount(clashes, picks);
  const next = firstUnpicked(clashes, picks);
  const goToNext = () => {
    const at = next ? clashes.indexOf(next) : -1;
    const box = list.current?.querySelectorAll<HTMLElement>('.conf')[at];
    box?.scrollIntoView({ block: 'nearest' });
    box?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
  };
  return (
    <div className="res-box" role="region" aria-label="Clashes with Main">
      <div className="res-head">
        <h5>
          <KindIcon kind="issue" size={15} /> {plural(clashes.length, 'clash')} with Main
          {canPick && (
            <span className="res-count" aria-live="polite">
              {picked} of {clashes.length} picked
            </span>
          )}
        </h5>
        <p className="small muted">
          {canPick
            ? 'Main changed the same spot after this change request started. Pick the version to keep.'
            : `Main changed the same spot after this change request started. ${mergerNames(session)} picks a version when merging.`}
        </p>
        {canPick && (
          <div className="res-all">
            <button className="btn sm" type="button" onClick={() => onPickAll('main')}>
              Keep Main for all
            </button>
            <button className="btn sm" type="button" onClick={() => onPickAll('cr')}>
              Keep this change request for all
            </button>
            {next && (
              <button className="lnk" type="button" onClick={goToNext}>
                Next to pick: {trunc(next.label, 48)}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="res-list" ref={list}>
        {clashes.map((clash, i) => {
          const side = (value: 'main' | 'cr', label: string, text: string) => {
            const on = picks[clash.key] === value;
            const blocked = value === 'cr' && !clash.crApplies;
            const body = (
              <>
                <small>{label}</small>
                {canPick && (
                  <input
                    type="radio"
                    name={`rp${i}`}
                    value={value}
                    checked={on}
                    disabled={blocked}
                    aria-describedby={blocked ? `rp${i}-note` : undefined}
                    onChange={() => onPick(clash.key, value)}
                  />
                )}
                {text}
                {blocked && (
                  <span className="side-note" id={`rp${i}-note`}>
                    {onlyMainNote(clash.key)}
                  </span>
                )}
              </>
            );
            const cls = `side${on ? ' on' : ''}${blocked ? ' off' : ''}`;
            return canPick ? (
              <label className={cls}>{body}</label>
            ) : (
              <div className={cls}>{body}</div>
            );
          };
          return (
            <div className="conf" key={`${clash.key}-${clash.index}`}>
              <h5>
                <button
                  className="lnk conf-go"
                  type="button"
                  title="Show it on the graph"
                  onClick={() => onShow(clash.key)}
                >
                  {clash.label}
                </button>
              </h5>
              <div
                className="sides"
                role={canPick ? 'radiogroup' : undefined}
                aria-label={canPick ? clash.label : undefined}
              >
                {side(
                  'main',
                  `Main now · from #${clash.commit.crNum} by ${dir.name(clash.fromAuthor ?? clash.commit.mergedBy)}`,
                  clash.mainVal,
                )}
                {side(
                  'cr',
                  `This change request · by ${dir.name(clash.x.by || cr.author)}`,
                  clash.crVal,
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChangeRow({
  session,
  change,
  on,
  edit,
  busy,
  onSelect,
  onRemove,
}: {
  session: Session;
  change: ReviewChange;
  on: boolean;
  edit: boolean;
  busy: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { dir } = session;
  const { d, op, skipReason, clash, title } = change;
  return (
    <li className={`chg-row${on ? ' on' : ''}${skipReason ? ' skipped' : ''}`}>
      <button
        className="chg-pick"
        type="button"
        aria-current={on ? 'true' : undefined}
        onClick={onSelect}
      >
        <span className="pi">
          <ChangeIcon change={change} size={13} />
        </span>
        <span className="chg-txt">
          <b>{d.item}</b>: {skipReason ? 'no longer applies' : d.change}
          {title && title !== d.item && <small>{trunc(title, 60)}</small>}
          {skipReason ? (
            <small>{SKIP_REASON[skipReason]}</small>
          ) : (
            (d.before || d.after) && (
              <small>
                {d.before && (
                  <>
                    <span className="before">{d.before}</span> →{' '}
                  </>
                )}
                <span className="after">{d.after}</span>
              </small>
            )
          )}
          {d.why && <small>Why: {d.why}</small>}
          <span className="chg-by">
            <Avatar id={op.by} dir={dir} sm /> {dir.name(op.by)}
            {op.via && <small className="via">via key {trunc(op.via, 40)}</small>}
            {clash && <span className="chipx warn">Clash with #{clash.commit.crNum}</span>}
          </span>
        </span>
      </button>
      {edit && change.opIndex !== null && (
        <button
          className="x"
          type="button"
          aria-label={`Undo this change: ${d.item}, ${d.change}`}
          title="Undo this change"
          disabled={busy}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </li>
  );
}

export function CrSide({
  session,
  model,
  edit,
  tab,
  sel,
  canPick,
  busy,
  actions,
  queue,
  queueCount,
  onTab,
  onSelect,
  onPick,
  onPickAll,
  onShowClash,
  onHide,
}: {
  session: Session;
  model: ReviewModel;
  edit: boolean;
  tab: SideTab;
  sel: number | null;
  canPick: boolean;
  busy: boolean;
  actions: TrackerActions;
  queue: ReactNode;
  queueCount: number;
  onTab: (tab: SideTab) => void;
  onSelect: (index: number) => void;
  onPick: (key: string, side: 'main' | 'cr') => void;
  onPickAll: (side: 'main' | 'cr') => void;
  onShowClash: (key: string) => void;
  onHide: () => void;
}) {
  const { cr, changes, clashes, applying, stale } = model;
  const shown = edit ? tab : 'changes';
  const tabButton = (value: SideTab, label: string, count: number) => (
    <button type="button" aria-pressed={shown === value} onClick={() => onTab(value)}>
      {label} <span className="n">{count}</span>
    </button>
  );
  return (
    <aside className="p-side cr-side" id={SIDE_ID} aria-label={`Change request #${cr.num}`}>
      <div className="side-top">
        {edit ? (
          <div className="qseg" role="group" aria-label="Show in the side panel">
            {tabButton('changes', 'Changes', applying)}
            {tabButton('queue', 'Queue', queueCount)}
          </div>
        ) : (
          <h4>
            Changes <span className="n">{applying}</span>
          </h4>
        )}
        <button
          className="ib"
          type="button"
          aria-label="Hide the side panel"
          title="Hide the side panel"
          aria-expanded="true"
          aria-controls={SIDE_ID}
          onClick={onHide}
        >
          <Icon name="sidebar" size={15} />
        </button>
      </div>
      {shown === 'queue' ? (
        queue
      ) : (
        <div className="side-list">
          {isOpen(cr) && clashes.length > 0 && (
            <ClashBox
              session={session}
              model={model}
              canPick={canPick}
              onPick={onPick}
              onPickAll={onPickAll}
              onShow={onShowClash}
            />
          )}
          {stale.length > 0 && (
            <p className="chg-stale" role="note" aria-label="Changes that no longer apply">
              {stale.length === 1
                ? '1 change no longer applies.'
                : `${stale.length} changes no longer apply.`}
              {edit && (
                <button
                  className="btn sm btn-quiet"
                  type="button"
                  aria-label="Clear the changes that no longer apply"
                  disabled={busy}
                  onClick={actions.clearStale}
                >
                  Clear
                </button>
              )}
            </p>
          )}
          {changes.length > 0 ? (
            <ol className="chg-list" aria-label="Changes">
              {changes.map((change, i) => (
                <ChangeRow
                  key={`${i}-${change.opIndex}`}
                  session={session}
                  change={change}
                  on={sel === i}
                  edit={edit}
                  busy={busy}
                  onSelect={() => onSelect(i)}
                  onRemove={() => change.opIndex !== null && actions.removeChange(change.opIndex)}
                />
              ))}
            </ol>
          ) : (
            <div className="qempty">
              <Icon name="inbox" size={26} />
              {model.inMain
                ? 'Every change is already in Main. Cancel the change request to close it.'
                : edit
                  ? 'No changes yet. Drag an event or a work item from the Queue onto the graph.'
                  : 'This change request has no change.'}
              {edit && (
                <button className="btn sm" type="button" onClick={() => onTab('queue')}>
                  Open the Queue
                </button>
              )}
            </div>
          )}
          {model.dropped.length > 0 && (
            <ol className="chg-list" aria-label="Not merged">
              {model.dropped.map((x, i) => (
                <li className="chg-row skipped" key={i}>
                  <span className="pi">
                    <Icon name="x" size={13} />
                  </span>
                  <span className="chg-txt">
                    <b>{x.label}</b>: not merged
                    <small>
                      {session.dir.name(x.by)} kept Main&apos;s version from #{x.from}: &quot;
                      {x.mainVal}&quot;
                    </small>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {edit && changes.length > 0 && (
            <div className="side-foot">
              <button className="btn" type="button" disabled={busy} onClick={actions.undo}>
                <Icon name="undo" /> Undo the last change
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
