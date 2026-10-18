import { requireActor } from '../../server/http/rsc';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireActor('/');
  return children;
}
