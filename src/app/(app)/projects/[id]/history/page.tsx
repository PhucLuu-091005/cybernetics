import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { IdSchema } from '../../../../../contracts';
import { HistoryScreen } from './history-screen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'History · Promise Graph' };

export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) notFound();
  return <HistoryScreen projectId={id} commitId={null} />;
}
