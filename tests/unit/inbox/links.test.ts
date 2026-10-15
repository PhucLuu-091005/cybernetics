import { describe, expect, it } from 'vitest';
import { activePermalink } from '../../../src/components/inbox/links';

describe('activePermalink (SRD 17)', () => {
  it('activates a stored https permalink from a Slack or Gmail source', () => {
    expect(
      activePermalink({ source: 'slack', permalink: 'https://larkspur.slack.com/archives/C1/p1' }),
    ).toBe('https://larkspur.slack.com/archives/C1/p1');
    expect(
      activePermalink({ source: 'gmail', permalink: 'https://mail.google.com/mail/u/0/#all/abc' }),
    ).toBe('https://mail.google.com/mail/u/0/#all/abc');
  });
  it('activates an agent or pasted permalink only on the Slack, Gmail or Linear host', () => {
    expect(
      activePermalink({ source: 'agent', permalink: 'https://linear.app/fundline/issue/PG-201' }),
    ).toBe('https://linear.app/fundline/issue/PG-201');
    expect(
      activePermalink({ source: 'paste', permalink: 'https://fundline.slack.com/archives/C1/p1' }),
    ).toBe('https://fundline.slack.com/archives/C1/p1');
    expect(
      activePermalink({ source: 'agent', permalink: 'https://linear.app.evil.example/x' }),
    ).toBeNull();
  });
  it('keeps agent, paste, non-https and missing permalinks inactive', () => {
    expect(
      activePermalink({ source: 'agent', permalink: 'https://evil.example/phish' }),
    ).toBeNull();
    expect(
      activePermalink({ source: 'paste', permalink: 'https://evil.example/phish' }),
    ).toBeNull();
    expect(activePermalink({ source: 'slack', permalink: 'javascript:alert(1)' })).toBeNull();
    expect(activePermalink({ source: 'gmail', permalink: 'http://mail.google.com/x' })).toBeNull();
    expect(activePermalink({ source: 'slack', permalink: null })).toBeNull();
  });
});
