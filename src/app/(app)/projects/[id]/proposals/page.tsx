import { notFound, redirect } from 'next/navigation';
import { IdSchema } from '../../../../../contracts';
import { reviewHref } from '../../../../../components/review-queue/state';

export default async function ProposalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) notFound();
  redirect(reviewHref(id, { tab: 'sets' }));
}
