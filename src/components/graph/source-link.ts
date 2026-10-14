import type { GraphSource } from '../../contracts/views';
import {
  SOURCE_APP_NAME,
  linkablePermalink,
  sourceApp,
  type SourceApp,
} from '../../lib/source-app';

export type SourceLink = { href: string; text: string; external: boolean };
export type ActSource = { app: SourceApp | null; label: string | null; link: SourceLink };

export function sourceLink(
  projectId: string,
  recordVersionId: string,
  source: GraphSource | undefined,
): SourceLink {
  const href = source ? linkablePermalink(source.source, source.permalink) : null;
  if (source && href)
    return {
      href,
      text: `Open in ${SOURCE_APP_NAME[sourceApp(source.source, source.permalink)]}`,
      external: true,
    };
  return {
    href: `/projects/${projectId}/records/${recordVersionId}`,
    text: 'View record',
    external: false,
  };
}

export function actSource(
  projectId: string,
  recordVersionId: string,
  source: GraphSource | undefined,
): ActSource {
  return {
    app: source ? sourceApp(source.source, source.permalink) : null,
    label: source?.sourceLabel ?? null,
    link: sourceLink(projectId, recordVersionId, source),
  };
}
