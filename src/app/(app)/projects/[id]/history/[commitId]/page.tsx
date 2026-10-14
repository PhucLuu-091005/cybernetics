import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { IdSchema } from '../../../../../../contracts';
import { HistoryScreen } from '../history-screen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Commit · Promise Graph' };

export default async function CommitPage({
  params,
}: {
  params: Promise<{ id: string; commitId: string }>;
}) {
  const { id, commitId } = await params;
  if (!IdSchema.safeParse(id).success || !IdSchema.safeParse(commitId).success) notFound();
  return <HistoryScreen projectId={id} commitId={commitId} />;
}
