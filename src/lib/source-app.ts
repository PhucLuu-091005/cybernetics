import type { SourceKind } from '../contracts/records';

export type SourceApp = 'slack' | 'gmail' | 'linear' | 'agent' | 'paste';
export const SOURCE_APP_NAME: Record<SourceApp, string> = {
  slack: 'Slack',
  gmail: 'Gmail',
  linear: 'Linear',
  agent: 'Agent',
  paste: 'Paste',
};

function hostApp(permalink: string | null): 'slack' | 'gmail' | 'linear' | null {
  if (!permalink) return null;
  let url: URL;
  try {
    url = new URL(permalink);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'slack.com' || host.endsWith('.slack.com')) return 'slack';
  if (host === 'mail.google.com') return 'gmail';
  if (host === 'linear.app') return 'linear';
  return null;
}

/** Native connector sources name their app; for agent and pasted records only the permalink domain can. */
export function sourceApp(source: SourceKind, permalink: string | null): SourceApp {
  if (source === 'slack' || source === 'gmail') return source;
  return hostApp(permalink) ?? source;
}

// Owner decision of 14 Oct 2026: links to these three domains open; any other agent or pasted URL stays plain text, so an import cannot plant a phishing link.
export function linkablePermalink(source: SourceKind, permalink: string | null): string | null {
  if (!permalink) return null;
  if (source === 'slack' || source === 'gmail')
    return permalink.startsWith('https://') ? permalink : null;
  return hostApp(permalink) ? permalink : null;
}
