import { describe, expect, it } from 'vitest';
import { linkablePermalink, sourceApp } from '../../../src/lib/source-app';

describe('sourceApp and linkablePermalink', () => {
  it('trusts native Slack and Gmail sources', () => {
    expect(sourceApp('slack', null)).toBe('slack');
    expect(sourceApp('gmail', 'https://mail.google.com/mail/u/0/#all/a')).toBe('gmail');
    expect(linkablePermalink('slack', 'https://x.slack.com/archives/C1/p1')).toBe(
      'https://x.slack.com/archives/C1/p1',
    );
  });
  it('recognises agent and pasted records by permalink domain', () => {
    const cases = [
      ['https://acme.slack.com/archives/C1/p1', 'slack'],
      ['https://slack.com/archives/C1/p1', 'slack'],
      ['https://mail.google.com/mail/u/0/#inbox/abc', 'gmail'],
      ['https://linear.app/acme/issue/PG-112/sync-crm', 'linear'],
    ] as const;
    for (const [url, app] of cases)
      for (const source of ['agent', 'paste'] as const) {
        expect(sourceApp(source, url)).toBe(app);
        expect(linkablePermalink(source, url)).toBe(url);
      }
  });
  it('keeps look-alike hosts, http, credentials and other domains as plain text', () => {
    for (const url of [
      'https://slack.com.evil.example/x',
      'https://evilslack.com/x',
      'https://linear.app.example/x',
      'https://mail.google.com.example/x',
      'https://linear.app@evil.example/x',
      'https://user@linear.app/x',
      'https://linear.app:8443/x',
      'http://linear.app/x',
      'https://notion.example/x',
      'not a url',
    ]) {
      expect(sourceApp('agent', url)).toBe('agent');
      expect(linkablePermalink('agent', url)).toBeNull();
    }
    expect(linkablePermalink('slack', 'javascript:alert(1)')).toBeNull();
    expect(linkablePermalink('paste', null)).toBeNull();
    expect(sourceApp('paste', null)).toBe('paste');
  });
});
