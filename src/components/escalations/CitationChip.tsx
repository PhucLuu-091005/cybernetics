import Link from 'next/link';
import type { ActorReference } from '../../contracts';

export type CitedAct = {
  actId: string;
  chip: string;
  plain: string;
  title: string;
  quote: string | null;
  href: string;
};

export function CitationChip({
  actId,
  acts,
}: {
  actId: string;
  acts: Readonly<Record<string, CitedAct>>;
}) {
  const act = acts[actId];
  if (!act) return <span title="This act is not in the pinned graph version">[missing act]</span>;
  return (
    <Link className="actref" href={act.href} title={act.title}>
      {act.chip}
    </Link>
  );
}

export function actorLabel(author: ActorReference, viewerUserId: string): string {
  if (author.kind === 'agent') return 'an agent via MCP';
  return author.userId === viewerUserId ? 'you' : 'a workspace member';
}
