'use client';
import { useState, type FormEvent } from 'react';
import type { Department, GraphOperation, Loop, Milestone, Person } from '../../contracts';
import { PartyOptions, SelectField } from './fields';
import { useHydrated } from './hydrated';
import { partyFromValue, partyValue } from './operations';

type Props = {
  loop: Loop | null;
  people: readonly Person[];
  departments: readonly Department[];
  milestones: readonly Milestone[];
  busy: boolean;
  editable: boolean;
  onSave(operations: GraphOperation[], title: string): void;
};

/** A loop's customer, performer, lane and milestone; its state stays derived from its acts. */
export function LoopEditor({ loop, people, departments, milestones, busy, editable, onSave }: Props) {
  const firstPerson = people.find(person => person.side !== 'unknown')?.id ?? 'side:client';
  const [id] = useState(() => loop?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(loop?.title ?? '');
  const [customer, setCustomer] = useState(loop ? partyValue(loop.customer) : firstPerson);
  const [performer, setPerformer] = useState(loop ? partyValue(loop.performer) : firstPerson);
  const [departmentId, setDepartmentId] = useState(loop?.performerDepartmentId ?? departments[0]?.id ?? '');
  const [milestoneId, setMilestoneId] = useState(loop?.milestoneId ?? '');
  const hydrated = useHydrated();
  const disabled = !editable || busy || !hydrated;
  const chooseCustomer = (value: string) => setCustomer(value);
  const choosePerformer = (value: string) => {
    setPerformer(value);
    // The performer's own department is the usual lane; the field stays editable.
    const department = people.find(person => person.id === value)?.departmentId;
    if (department) setDepartmentId(department);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !departmentId) return;
    onSave([{ op: 'put', collection: 'loops', value: { id, title: title.trim(), customer: partyFromValue(customer), performer: partyFromValue(performer), performerDepartmentId: departmentId, milestoneId: milestoneId || null } }], loop ? `Edit loop ${title.trim()}` : `New loop ${title.trim()}`);
  };
  return (
    <form className="editor" aria-label="Loop editor" onSubmit={submit}>
      <h3 className="wide" style={{ margin: 0 }}>{loop ? 'Edit loop' : 'New loop'}</h3>
      <label className="field wide">Title<input value={title} maxLength={200} disabled={disabled} onChange={event => setTitle(event.target.value)} /></label>
      <SelectField label="Customer">{id => <select id={id} value={customer} disabled={disabled} onChange={event => chooseCustomer(event.target.value)}><PartyOptions people={people} /></select>}</SelectField>
      <SelectField label="Performer">{id => <select id={id} value={performer} disabled={disabled} onChange={event => choosePerformer(event.target.value)}><PartyOptions people={people} /></select>}</SelectField>
      <SelectField label="Performer department">{id => (
        <select id={id} value={departmentId} disabled={disabled} onChange={event => setDepartmentId(event.target.value)}>
          {departments.map(department => <option key={department.id} value={department.id}>{department.name} ({department.side})</option>)}
        </select>
      )}</SelectField>
      <SelectField label="Milestone">{id => (
        <select id={id} value={milestoneId} disabled={disabled} onChange={event => setMilestoneId(event.target.value)}>
          <option value="">None</option>
          {milestones.map(milestone => <option key={milestone.id} value={milestone.id}>{milestone.name}</option>)}
        </select>
      )}</SelectField>
      <div className="wide row"><button className="btn btn-draft" type="submit" disabled={disabled || !title.trim() || !departmentId}>Save loop to draft</button></div>
    </form>
  );
}
