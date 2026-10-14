'use client';
import { useState, type FormEvent } from 'react';
import type { Department, GraphOperation, Milestone, Person } from '../../contracts';
import { SelectField } from './fields';
import { useHydrated } from './hydrated';

type Props = {
  people: readonly Person[];
  departments: readonly Department[];
  milestones: readonly Milestone[];
  busy: boolean;
  editable: boolean;
  onSave(operations: GraphOperation[], title: string): void;
};

/** SRD 6.2: people and milestone dates change only explicitly inside a proposal; importers never edit them. */
export function ContextEditor({ people, departments, milestones, busy, editable, onSave }: Props) {
  const [person, setPerson] = useState({
    name: '',
    side: 'client' as Person['side'],
    departmentId: '',
    role: '',
  });
  const [milestoneId, setMilestoneId] = useState(milestones[0]?.id ?? '');
  const selected = milestones.find((item) => item.id === milestoneId);
  const [currentDate, setCurrentDate] = useState(selected?.currentDate ?? '');
  const hydrated = useHydrated();
  const disabled = !editable || busy || !hydrated;
  const sideDepartments = departments.filter((department) => department.side === person.side);

  const addPerson = (event: FormEvent) => {
    event.preventDefault();
    if (!person.name.trim()) return;
    const next: Person = {
      id: crypto.randomUUID(),
      name: person.name.trim(),
      side: person.side,
      departmentId: person.departmentId || null,
      role: person.role.trim(),
    };
    onSave([{ op: 'set_context', field: 'people', value: [...people, next] }], `Add ${next.name}`);
  };
  const moveMilestone = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !currentDate) return;
    onSave(
      [
        {
          op: 'set_context',
          field: 'milestones',
          value: milestones.map((item) =>
            item.id === selected.id ? { ...item, currentDate } : item,
          ),
        },
      ],
      `Move ${selected.name}`,
    );
  };
  return (
    <div className="stack" style={{ padding: '14px 16px' }}>
      <form
        className="editor"
        aria-label="Add a person"
        onSubmit={addPerson}
        style={{ padding: 0 }}
      >
        <h3 className="wide" style={{ margin: 0 }}>
          Add a person
        </h3>
        <label className="field">
          Name
          <input
            value={person.name}
            maxLength={200}
            disabled={disabled}
            onChange={(event) => setPerson((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <SelectField label="Side">
          {(id) => (
            <select
              id={id}
              value={person.side}
              disabled={disabled}
              onChange={(event) =>
                setPerson((current) => ({
                  ...current,
                  side: event.target.value as Person['side'],
                  departmentId: '',
                }))
              }
            >
              <option value="client">Client</option>
              <option value="vendor">Vendor</option>
              <option value="unknown">Unknown</option>
            </select>
          )}
        </SelectField>
        <SelectField label="Department">
          {(id) => (
            <select
              id={id}
              value={person.departmentId}
              disabled={disabled}
              onChange={(event) =>
                setPerson((current) => ({ ...current, departmentId: event.target.value }))
              }
            >
              <option value="">None</option>
              {sideDepartments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          )}
        </SelectField>
        <label className="field wide">
          Role
          <input
            value={person.role}
            maxLength={200}
            disabled={disabled}
            onChange={(event) => setPerson((current) => ({ ...current, role: event.target.value }))}
          />
        </label>
        <div className="wide">
          <button
            className="btn btn-draft"
            type="submit"
            disabled={disabled || !person.name.trim()}
          >
            Add person to draft
          </button>
        </div>
      </form>
      <form
        className="editor"
        aria-label="Milestone date"
        onSubmit={moveMilestone}
        style={{ padding: 0 }}
      >
        <h3 className="wide" style={{ margin: 0 }}>
          Milestone current date
        </h3>
        <SelectField label="Milestone">
          {(id) => (
            <select
              id={id}
              value={milestoneId}
              disabled={disabled}
              onChange={(event) => {
                setMilestoneId(event.target.value);
                setCurrentDate(
                  milestones.find((item) => item.id === event.target.value)?.currentDate ?? '',
                );
              }}
            >
              {milestones.map((milestone) => (
                <option key={milestone.id} value={milestone.id}>
                  {milestone.name}
                </option>
              ))}
            </select>
          )}
        </SelectField>
        <label className="field">
          Current date
          <input
            type="date"
            value={currentDate}
            disabled={disabled}
            onChange={(event) => setCurrentDate(event.target.value)}
          />
        </label>
        <div className="wide">
          <button
            className="btn btn-draft"
            type="submit"
            disabled={disabled || !selected || !currentDate || currentDate === selected.currentDate}
          >
            Save date to draft
          </button>
        </div>
      </form>
    </div>
  );
}
