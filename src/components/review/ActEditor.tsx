'use client';
import { useState, type FormEvent } from 'react';
import {
  ActTypeSchema,
  type GraphOperation,
  type Loop,
  type Person,
  type QuotedRange,
} from '../../contracts';
import { quoteContext } from '../../lib/quote-context';
import { ACT_LABEL } from '../graph/labels';
import { MAX_QUOTE } from '../inbox/selection';
import { PartyOptions, SelectField } from './fields';
import { useHydrated } from './hydrated';
import {
  buildActOperations,
  checkCitation,
  partyValue,
  type ActForm,
  type Citer,
} from './operations';

export type CitedText = {
  title: string;
  author: string;
  when: string;
  text: string | null;
  quotedRanges: QuotedRange[];
};
type Props = {
  initial: ActForm;
  citation: { recordVersionId: string; start: number; end: number };
  expectedQuote: string | null;
  record: CitedText | null;
  people: readonly Person[];
  loops: readonly Loop[];
  isNew: boolean;
  busy: boolean;
  editable: boolean;
  removeOperations: GraphOperation[] | null;
  /** Every candidate act's citation, so hiding this act can return its record to pending. */
  citers: readonly Citer[];
  onSave(operations: GraphOperation[], title: string): void;
};

/** SRD 6.2: an act cites exact UTF-16 offsets of an immutable record version; the editor checks the quote the way the server will. */
export function ActEditor({
  initial,
  citation,
  expectedQuote,
  record,
  people,
  loops,
  isNew,
  busy,
  editable,
  removeOperations,
  citers,
  onSave,
}: Props) {
  const [form, setForm] = useState<ActForm>(initial);
  const [start, setStart] = useState(citation.start);
  const [end, setEnd] = useState(citation.end);
  const set = <K extends keyof ActForm>(key: K, value: ActForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const text = record?.text ?? null;
  const check =
    text === null
      ? {
          ok: false as const,
          message: 'The cited record is withdrawn or unavailable, so its quote cannot be checked.',
        }
      : checkCitation(text, record?.quotedRanges ?? [], start, end);
  const mismatch =
    check.ok &&
    expectedQuote !== null &&
    start === citation.start &&
    end === citation.end &&
    check.quote !== expectedQuote;
  const valid = check.ok && !mismatch && form.action.trim().length > 0;

  const chooseLoop = (loopId: string) => {
    const loop = loops.find((item) => item.id === loopId);
    // A loop names its own customer and performer; picking one copies them, and the fields stay editable.
    setForm((current) => ({
      ...current,
      loopId: loop?.id ?? null,
      ...(loop
        ? { customer: partyValue(loop.customer), performer: partyValue(loop.performer) }
        : {}),
    }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !check.ok) return;
    const actor = people.find((person) => person.id === form.actor)?.name ?? 'a side';
    onSave(
      buildActOperations(
        form,
        { recordVersionId: citation.recordVersionId, start, end, quote: check.quote },
        citers,
      ),
      `${ACT_LABEL[form.type]} by ${actor}`,
    );
  };
  const context = check.ok && text !== null ? quoteContext(text, start, end) : null;
  const hydrated = useHydrated();
  const disabled = !editable || busy || !hydrated;

  return (
    <form className="editor" aria-label="Act editor" onSubmit={submit}>
      <h3 className="wide" style={{ margin: 0 }}>
        {isNew ? 'New act from the selected quote' : 'Edit act'}
      </h3>
      <SelectField label="Act type">
        {(id) => (
          <select
            id={id}
            value={form.type}
            disabled={disabled}
            onChange={(event) => set('type', ActTypeSchema.parse(event.target.value))}
          >
            {ActTypeSchema.options.map((type) => (
              <option key={type} value={type}>
                {ACT_LABEL[type]}
              </option>
            ))}
          </select>
        )}
      </SelectField>
      <SelectField label="Actor">
        {(id) => (
          <select
            id={id}
            value={form.actor}
            disabled={disabled}
            onChange={(event) => set('actor', event.target.value)}
          >
            <PartyOptions people={people} />
          </select>
        )}
      </SelectField>
      <SelectField label="Loop">
        {(id) => (
          <select
            id={id}
            value={form.loopId ?? ''}
            disabled={disabled}
            onChange={(event) => chooseLoop(event.target.value)}
          >
            <option value="">No loop (shows only in change set previews)</option>
            {loops.map((loop) => (
              <option key={loop.id} value={loop.id}>
                {loop.title}
              </option>
            ))}
          </select>
        )}
      </SelectField>
      <SelectField label="Requested by">
        {(id) => (
          <select
            id={id}
            value={form.customer}
            disabled={disabled}
            onChange={(event) => set('customer', event.target.value)}
          >
            <PartyOptions people={people} />
          </select>
        )}
      </SelectField>
      <SelectField label="Done by">
        {(id) => (
          <select
            id={id}
            value={form.performer}
            disabled={disabled}
            onChange={(event) => set('performer', event.target.value)}
          >
            <PartyOptions people={people} />
          </select>
        )}
      </SelectField>
      <SelectField label="Due date">
        {(id) => (
          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <input
              id={id}
              type="date"
              value={form.dueDate}
              disabled={disabled}
              onChange={(event) => set('dueDate', event.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <select
              aria-label="Due precision"
              value={form.duePrecision}
              disabled={disabled}
              onChange={(event) =>
                set('duePrecision', event.target.value as ActForm['duePrecision'])
              }
            >
              <option value="day">day</option>
              <option value="week">week</option>
              <option value="month">month</option>
            </select>
          </span>
        )}
      </SelectField>
      <label className="field wide">
        Action
        <input
          value={form.action}
          maxLength={2000}
          disabled={disabled}
          onChange={(event) => set('action', event.target.value)}
          placeholder="What the performer is asked or promises to do"
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={form.hedged}
          disabled={disabled}
          onChange={(event) => set('hedged', event.target.checked)}
        />{' '}
        Hedged promise
      </label>
      {!isNew && (
        <label className="check">
          <input
            type="checkbox"
            checked={form.hidden}
            disabled={disabled}
            onChange={(event) => set('hidden', event.target.checked)}
          />{' '}
          Hidden
        </label>
      )}
      <div className="wide cite">
        <div className="row">
          <b style={{ fontSize: 13 }}>Citation</b>
          <span className="faint" style={{ fontSize: 12 }}>
            {record ? `${record.title}, ${record.author}, ${record.when}` : 'Unknown record'},
            offsets
          </span>
          <input
            className="id off"
            type="number"
            min={0}
            value={start}
            disabled={disabled}
            aria-label="Start offset"
            onChange={(event) => setStart(Number(event.target.value))}
          />
          –
          <input
            className="id off"
            type="number"
            min={0}
            value={end}
            disabled={disabled}
            aria-label="End offset"
            onChange={(event) => setEnd(Number(event.target.value))}
          />
        </div>
        {context && check.ok && (
          <div className="quote">
            {context.before}
            <mark data-testid="citation-quote">{check.quote}</mark>
            {context.after}
          </div>
        )}
        <div
          data-testid="citation-check"
          className={valid || (check.ok && !mismatch) ? 'ok' : 'bad'}
          style={{ fontSize: 13 }}
        >
          {!check.ok
            ? `✕ ${check.message}`
            : mismatch
              ? '✕ The quote from the selection no longer matches the record text at these offsets.'
              : `✓ Quote matches the record text at ${start}–${end}, outside quoted ranges, ${end - start} of ${MAX_QUOTE} characters.`}
        </div>
        <p className="faint" style={{ fontSize: 12 }}>
          The change set stores the record version and offsets. The server checks the quote again on
          save.
        </p>
      </div>
      <div className="wide row">
        <button className="btn btn-draft" type="submit" disabled={disabled || !valid}>
          Save act to change set
        </button>
        {removeOperations && (
          <button
            className="btn"
            type="button"
            disabled={disabled}
            onClick={() => onSave(removeOperations, 'Remove act')}
          >
            Remove act from change set
          </button>
        )}
        {!editable && (
          <span className="faint" style={{ fontSize: 12 }}>
            This change set is closed, so it cannot change.
          </span>
        )}
      </div>
    </form>
  );
}
