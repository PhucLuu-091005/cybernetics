import { describe, expect, it } from 'vitest';
import { snapshotLimitErrors, validateSnapshot, verifyQuote } from '../../../src/server/graph/validate';
import { ids, snapshot } from '../../support/builders';

const body = 'Anh Minh ơi 🙏 — We will go live by 30 September. > earlier quoted text';
const quote = 'We will go live by 30 September.';
const start = body.indexOf(quote), end = start + quote.length;
const evidence = (overrides = {}) => new Map([[ids.record, { recordVersionId: ids.record, projectId: 'p', recordId: 'r', occurredAt: '2026-07-03T09:00:00Z', bodyText: body, digest: 'd', withdrawn: false, quotedRanges: [{ start: body.indexOf('>'), end: body.length }], superseded: false, ...overrides }]]);
const cited = () => { const s = snapshot(); s.acts[0].citation = { recordVersionId: ids.record, start, end }; return s; };

describe('citation validation', () => {
  it('Vietnamese quote offsets verify after an emoji', () => {
    expect(verifyQuote(cited().acts[0], quote, evidence())).toBeNull();
    expect(verifyQuote(cited().acts[0], quote.replace('30', '31'), evidence())?.message).toMatch(/does not match/);
  });
  it('rejects a citation inside a quoted range, a withdrawn version and an unknown version', () => {
    const inQuote = cited(); inQuote.acts[0].citation = { recordVersionId: ids.record, start: body.indexOf('earlier'), end: body.length };
    expect(validateSnapshot(inQuote, evidence()).map(error => error.message).join()).toMatch(/quoted range/);
    expect(validateSnapshot(cited(), evidence({ withdrawn: true, bodyText: null })).map(error => error.message).join()).toMatch(/withdrawn/);
    expect(validateSnapshot(cited(), new Map()).map(error => error.message).join()).toMatch(/unknown record version/);
  });
  it('requires an included decision to have a visible act and an ignored decision to have none', () => {
    const s = cited();
    s.recordDecisions = [{ recordVersionId: ids.record, disposition: 'ignored', reason: 'noise' }];
    expect(validateSnapshot(s, evidence()).map(error => error.message).join()).toMatch(/ignored.*visible act/);
    s.acts[0].hidden = true; s.recordDecisions = [{ recordVersionId: ids.record, disposition: 'included', reason: '' }];
    expect(validateSnapshot(s, evidence()).map(error => error.message).join()).toMatch(/included.*no visible act/);
  });

  it('accepts a consistent snapshot', () => {
    expect(validateSnapshot(cited(), evidence())).toEqual([]);
  });
  it('rejects offsets that split a surrogate pair or run past the body, with the act path', () => {
    const split = cited(); split.acts[0].citation = { recordVersionId: ids.record, start: body.indexOf('🙏') + 1, end: start };
    expect(validateSnapshot(split, evidence())).toContainEqual({ path: `acts.${ids.act}.citation`, message: expect.stringMatching(/UTF-16 boundar/) });
    const past = cited(); past.acts[0].citation = { recordVersionId: ids.record, start: body.length - 5, end: body.length + 5 };
    expect(validateSnapshot(past, evidence()).map(error => error.message).join()).toMatch(/outside the record body/);
  });
  it('rejects an act party that resolves to a person with an unknown side', () => {
    const s = cited(); s.context.people[0].side = 'unknown';
    expect(validateSnapshot(s, evidence())).toContainEqual({ path: `acts.${ids.act}.actor`, message: expect.stringMatching(/client or vendor/) });
  });
  it('reports reference errors and schema errors as field errors', () => {
    const s = cited(); s.acts[0].loopId = ids.other;
    expect(validateSnapshot(s, evidence())).toContainEqual({ path: `acts.${ids.act}`, message: expect.stringMatching(/references missing loops/) });
    const bad = cited(); bad.loops[0].title = '';
    expect(validateSnapshot(bad, evidence()).map(error => error.path)).toContain('loops.0.title');
  });
  it('rejects a quote longer than 400 characters and a quote on a withdrawn version', () => {
    expect(verifyQuote(cited().acts[0], 'x'.repeat(401), evidence())?.message).toMatch(/400/);
    expect(verifyQuote(cited().acts[0], quote, evidence({ withdrawn: true, bodyText: null }))?.message).toMatch(/withdrawn/);
  });
  it('separates cap and size failures from ordinary schema errors', () => {
    const many = cited();
    many.loops = Array.from({ length: 301 }, (_, index) => ({ ...many.loops[0], id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}` }));
    expect(snapshotLimitErrors(many).map(error => error.path)).toContain('loops');
    const large = cited(); large.annotations = Array.from({ length: 600 }, (_, index) => ({ id: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`, text: 'x'.repeat(10000), actIds: [] }));
    expect(snapshotLimitErrors(large).map(error => error.message).join()).toMatch(/exceeds/);
    const invalid = cited(); invalid.loops[0].title = '';
    expect(snapshotLimitErrors(invalid)).toEqual([]);
  });
});
