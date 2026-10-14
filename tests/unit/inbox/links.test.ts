import { describe, expect, it } from 'vitest';
import { activePermalink } from '../../../src/components/inbox/links';

describe('activePermalink (SRD 17)', () => {
  it('activates only a stored https permalink from a Slack or Gmail source', () => {
    expect(
      activePermalink({ source: 'slack', permalink: 'https://larkspur.slack.com/archives/C1/p1' }),
    ).toBe('https://larkspur.slack.com/archives/C1/p1');
    expect(
      activePermalink({ source: 'gmail', permalink: 'https://mail.google.com/mail/u/0/#all/abc' }),
    ).toBe('https://mail.google.com/mail/u/0/#all/abc');
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
