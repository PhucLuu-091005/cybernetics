import { describe, expect, it } from 'vitest';
import { actSource, sourceLink } from '../../../src/components/graph/source-link';

const P = '11111111-1111-4111-8111-111111111111',
  V = '22222222-2222-4222-8222-222222222222';
const record = `/projects/${P}/records/${V}`;

describe('sourceLink', () => {
  it('opens a linkable permalink in a new tab, named after its app', () => {
    expect(
      sourceLink(P, V, {
        source: 'agent',
        sourceLabel: 'PG team',
        permalink: 'https://linear.app/acme/issue/PG-112/x',
      }),
    ).toEqual({
      href: 'https://linear.app/acme/issue/PG-112/x',
      text: 'Open in Linear',
      external: true,
    });
    expect(
      sourceLink(P, V, { source: 'slack', sourceLabel: '#ops', permalink: 'https://x.slack.com/a' })
        .text,
    ).toBe('Open in Slack');
  });
  it('links to the record for any other permalink or a missing source', () => {
    expect(
      sourceLink(P, V, {
        source: 'agent',
        sourceLabel: 'Notes',
        permalink: 'https://notion.example/x',
      }),
    ).toEqual({ href: record, text: 'View record', external: false });
    expect(sourceLink(P, V, undefined).href).toBe(record);
  });
});

describe('actSource', () => {
  it('gives the app and the source label', () => {
    expect(
      actSource(P, V, {
        source: 'agent',
        sourceLabel: '#larkspur-it',
        permalink: 'https://a.slack.com/x',
      }),
    ).toMatchObject({ app: 'slack', label: '#larkspur-it' });
    expect(actSource(P, V, undefined)).toMatchObject({ app: null, label: null });
  });
});
