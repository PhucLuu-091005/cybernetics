import { notFound, redirect } from 'next/navigation';
import { IdSchema } from '../../../../../../../contracts';
import { reviewHref } from '../../../../../../../components/review-queue/state';

type Search = Record<string, string | string[] | undefined>;

export default async function OldReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; proposalId: string }>;
  searchParams: Promise<Search>;
}) {
  const [{ id, proposalId }, raw] = await Promise.all([params, searchParams]);
  if (!IdSchema.safeParse(id).success || !IdSchema.safeParse(proposalId).success) notFound();
  redirect(
    `${reviewHref(id, { tab: 'sets', item: proposalId })}${raw.rebased === '1' ? '&updated=1' : ''}`,
  );
}
