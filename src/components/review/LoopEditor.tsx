'use client';
import { useState, type FormEvent } from 'react';
import type { Department, GraphOperation, Loop, Milestone, Person } from '../../contracts';
import { PartyOptions, SelectField } from './fields';
import { useHydrated } from './hydrated';
import { partyFromValue, partyValue } from './operations';

type Props = {
  loop: Loop | null;
  /** Every loop of the draft, for the parent and the after links. */
  loops: readonly Loop[];
  people: readonly Person[];
  departments: readonly Department[];
  milestones: readonly Milestone[];
  busy: boolean;
  editable: boolean;
  onSave(operations: GraphOperation[], title: string): void;
};

/** A loop's customer, performer, lane, milestone, parent and after links; its state stays derived from its acts. */
export function LoopEditor({
  loop,
  loops,
  people,
  departments,
  milestones,
  busy,
  editable,
  onSave,
}: Props) {
  const firstPerson = people.find((person) => person.side !== 'unknown')?.id ?? 'side:client';
  const [id] = useState(() => loop?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(loop?.title ?? '');
  const [customer, setCustomer] = useState(loop ? partyValue(loop.customer) : firstPerson);
  const [performer, setPerformer] = useState(loop ? partyValue(loop.performer) : firstPerson);
  const [departmentId, setDepartmentId] = useState(
    loop?.performerDepartmentId ?? departments[0]?.id ?? '',
  );
  const [milestoneId, setMilestoneId] = useState(loop?.milestoneId ?? '');
  const [parentId, setParentId] = useState(loop?.parentLoopId ?? '');
  const [afterIds, setAfterIds] = useState<string[]>(loop?.afterLoopIds ?? []);
  const hasTasks = loops.some((item) => item.parentLoopId === id);
  const parents = loops.filter((item) => item.id !== id && item.parentLoopId === undefined);
  const siblings = parentId
    ? loops.filter((item) => item.id !== id && item.parentLoopId === parentId)
    : [];
  const chooseParent = (value: string) => {
    setParentId(value);
    setAfterIds([]);
    // A task takes its milestone from its parent.
    if (value) setMilestoneId('');
  };
  const toggleAfter = (value: string, on: boolean) =>
    setAfterIds((previous) =>
      on
        ? [...previous.filter((item) => item !== value), value]
        : previous.filter((item) => item !== value),
    );
  const hydrated = useHydrated();
  const disabled = !editable || busy || !hydrated;
  const chooseCustomer = (value: string) => setCustomer(value);
  const choosePerformer = (value: string) => {
    setPerformer(value);
    // The performer's own department is the usual lane; the field stays editable.
    const department = people.find((person) => person.id === value)?.departmentId;
    if (department) setDepartmentId(department);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !departmentId) return;
    onSave(
      [
        {
          op: 'put',
          collection: 'loops',
          value: {
            id,
            title: title.trim(),
            customer: partyFromValue(customer),
            performer: partyFromValue(performer),
            performerDepartmentId: departmentId,
            milestoneId: parentId ? null : milestoneId || null,
            // Absent, never undefined: canonical JSON rejects undefined values.
            ...(parentId ? { parentLoopId: parentId } : {}),
            ...(parentId && afterIds.length
              ? {
                  afterLoopIds: afterIds.filter((item) =>
                    siblings.some((loop) => loop.id === item),
                  ),
                }
              : {}),
          },
        },
      ],
      loop ? `Edit loop ${title.trim()}` : `New loop ${title.trim()}`,
    );
  };
  return (
    <form className="editor" aria-label="Loop editor" onSubmit={submit}>
      <h3 className="wide" style={{ margin: 0 }}>
        {loop ? 'Edit loop' : 'New loop'}
      </h3>
      <label className="field wide">
        Title
        <input
          value={title}
          maxLength={200}
          disabled={disabled}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <SelectField label="Requested by">
        {(id) => (
          <select
            id={id}
            value={customer}
            disabled={disabled}
            onChange={(event) => chooseCustomer(event.target.value)}
          >
            <PartyOptions people={people} />
          </select>
        )}
      </SelectField>
      <SelectField label="Done by">
        {(id) => (
          <select
            id={id}
            value={performer}
            disabled={disabled}
            onChange={(event) => choosePerformer(event.target.value)}
          >
            <PartyOptions people={people} />
          </select>
        )}
      </SelectField>
      <SelectField label="Department">
        {(id) => (
          <select
            id={id}
            value={departmentId}
            disabled={disabled}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name} ({department.side})
              </option>
            ))}
          </select>
        )}
      </SelectField>
      <SelectField label="Milestone">
        {(id) => (
          <select
            id={id}
            value={milestoneId}
            disabled={disabled || Boolean(parentId)}
            title={parentId ? 'A task takes its milestone from its parent.' : undefined}
            onChange={(event) => setMilestoneId(event.target.value)}
          >
            <option value="">None</option>
            {milestones.map((milestone) => (
              <option key={milestone.id} value={milestone.id}>
                {milestone.name}
              </option>
            ))}
          </select>
        )}
      </SelectField>
      <SelectField label="Part of">
        {(fieldId) => (
          <select
            id={fieldId}
            value={parentId}
            disabled={disabled || hasTasks}
            title={hasTasks ? 'This loop has tasks, so it stays top level.' : undefined}
            onChange={(event) => chooseParent(event.target.value)}
          >
            <option value="">None (top-level loop)</option>
            {parents.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        )}
      </SelectField>
      {siblings.length > 0 && (
        <fieldset className="field wide" disabled={disabled}>
          <legend>After (tasks that hand off to this one)</legend>
          {siblings.map((item) => (
            <label key={item.id} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={afterIds.includes(item.id)}
                onChange={(event) => toggleAfter(item.id, event.target.checked)}
              />
              {item.title}
            </label>
          ))}
        </fieldset>
      )}
      <div className="wide row">
        <button
          className="btn btn-draft"
          type="submit"
          disabled={disabled || !title.trim() || !departmentId}
        >
          Save loop to change set
        </button>
      </div>
    </form>
  );
}
