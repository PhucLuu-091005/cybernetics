'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { Act, Department, EntityCollection, GraphOperation, Loop, Milestone, Person, RecordDecision } from '../../contracts';
import type { Citation } from '../inbox/selection';
import { ActEditor, type CitedText } from './ActEditor';
import { ConflictBanner } from './ConflictBanner';
import { ContextEditor } from './ContextEditor';
import type { ChangeKind } from './describe';
import { useDraftEdit, type EditTarget } from './draft-edit';
import { LoopEditor } from './LoopEditor';
import { actToForm, removeAct, type ActForm, type Citer } from './operations';

export type ChangeItem = { key: string; collection: EntityCollection; id: string; kind: ChangeKind; title: string; detail: string };
type Props = {
  projectId: string;
  target: Extract<EditTarget, { kind: 'proposal' }>;
  changes: ChangeItem[];
  acts: Record<string, Act>;
  /** Hiding or removing the last visible act on an included record must also return that record to pending. */
  citations: Citer[];
  records: Record<string, CitedText>;
  decisions: Record<string, RecordDecision['disposition']>;
  loops: Loop[];
  people: Person[];
  departments: Department[];
  milestones: Milestone[];
  cite: Citation | null;
  citeActor: string | null;
};
type Selection = 'cite' | 'new-loop' | 'context' | string;

export function ProposalWorkspace({ projectId, target, changes, acts, citations, records, decisions, loops, people, departments, milestones, cite, citeActor }: Props) {
  const edit = useDraftEdit(projectId, target);
  const [selected, setSelected] = useState<Selection | null>(cite ? 'cite' : null);
  const [saved, setSaved] = useState(0);
  const [newActId] = useState(() => crypto.randomUUID());
  const fallbackParty = people.find(person => person.side !== 'unknown')?.id ?? 'side:client';

  const save = async (operations: GraphOperation[], title: string) => {
    const ok = await edit.apply(operations, title);
    if (!ok) return;
    setSaved(count => count + 1);
    const first = operations[0];
    if (selected === 'cite' && first?.op === 'put' && first.collection === 'acts') setSelected(`acts/${first.value.id}`);
    else if (first?.op === 'remove') setSelected(null);
    else if (selected === 'new-loop' && first?.op === 'put' && first.collection === 'loops') setSelected(`loops/${first.value.id}`);
  };

  let editor: React.ReactNode;
  const change = changes.find(item => item.key === selected);
  if (selected === 'cite' && cite) {
    const actor = citeActor ?? fallbackParty;
    const initial: ActForm = { id: newActId, type: 'request', actor, customer: actor, performer: actor, action: '', dueDate: '', duePrecision: 'day', hedged: false, loopId: null, hidden: false, origin: 'human', confidence: null, decision: decisions[cite.recordVersionId] ?? null };
    editor = <ActEditor key={`cite:${saved}`} initial={initial} citation={cite} expectedQuote={cite.quote} record={records[cite.recordVersionId] ?? null} people={people} loops={loops} isNew busy={edit.busy} editable={edit.editable} removeOperations={null} citers={citations} onSave={save} />;
  } else if (selected === 'new-loop') {
    editor = <LoopEditor key={`new-loop:${saved}`} loop={null} people={people} departments={departments} milestones={milestones} busy={edit.busy} editable={edit.editable} onSave={save} />;
  } else if (selected === 'context') {
    editor = <ContextEditor key={`context:${saved}`} people={people} departments={departments} milestones={milestones} busy={edit.busy} editable={edit.editable} onSave={save} />;
  } else if (change?.collection === 'acts' && acts[change.id]) {
    const act = acts[change.id];
    editor = <ActEditor key={`${change.key}:${saved}`} initial={actToForm(act, decisions[act.citation.recordVersionId] ?? null)} citation={act.citation} expectedQuote={null} record={records[act.citation.recordVersionId] ?? null}
      people={people} loops={loops} isNew={false} busy={edit.busy} editable={edit.editable} removeOperations={removeAct(act, decisions[act.citation.recordVersionId] ?? null, citations)} citers={citations} onSave={save} />;
  } else if (change?.collection === 'loops' && change.kind !== 'removed') {
    const loop = loops.find(item => item.id === change.id) ?? null;
    editor = <LoopEditor key={`${change.key}:${saved}`} loop={loop} people={people} departments={departments} milestones={milestones} busy={edit.busy} editable={edit.editable} onSave={save} />;
  } else if (change) {
    editor = <div className="pad"><h3 style={{ marginBottom: 6 }}>{change.title}</h3><p className="faint" style={{ fontSize: 13 }}>{change.detail}. This change has no editor here; the review lists its before and after values.</p></div>;
  } else {
    editor = <p className="pad faint" style={{ fontSize: 13 }}>Select a change to edit it. To add an act, select its text in a record in the inbox and choose “Start act from selection”.</p>;
  }

  return (
    <div className="pbody">
      <div className="ops">
        <h3 style={{ margin: '0 0 8px' }}>Changes against the base, {changes.length}</h3>
        <div role="listbox" aria-label="Changes in this proposal" className="stack" style={{ gap: 2 }}>
          {cite && <button type="button" className="op" role="option" aria-selected={selected === 'cite'} onClick={() => setSelected('cite')}><b>New act from selection</b><small>not saved yet, “{cite.quote.slice(0, 40)}{cite.quote.length > 40 ? '…' : ''}”</small></button>}
          {changes.map(item => (
            <button key={item.key} type="button" className="op" role="option" aria-selected={selected === item.key} onClick={() => setSelected(item.key)}>
              <b>{item.title}</b><small>{item.detail}</small>
            </button>
          ))}
          {changes.length === 0 && !cite && <p className="faint" style={{ fontSize: 13 }}>No changes yet. The draft equals its base.</p>}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <Link className="btn" href={`/projects/${projectId}/inbox?proposal=${target.proposalId}`}>Add act from inbox</Link>
          <button type="button" className="btn" aria-pressed={selected === 'new-loop'} onClick={() => setSelected('new-loop')} disabled={!edit.editable}>New loop</button>
          <button type="button" className="btn" aria-pressed={selected === 'context'} onClick={() => setSelected('context')} disabled={!edit.editable}>People and dates</button>
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        {edit.failure && (
          <div style={{ padding: '12px 16px 0' }}>
            <ConflictBanner title={edit.failure.status === 409 ? 'Conflict: the draft or the evidence changed since this page loaded.' : 'The change was not saved.'}
              message={edit.failure.status === 409 ? 'Your edits are kept. Reload to see the current revision, then save again.' : undefined} error={edit.failure}
              actions={edit.failure.status === 409 ? <button className="btn" type="button" onClick={edit.reload}>Reload</button> : undefined} />
          </div>
        )}
        {editor}
      </div>
    </div>
  );
}
