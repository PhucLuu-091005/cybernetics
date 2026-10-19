import { DemoMode } from '../../components/shell/demo-mode';
import { readAuthEnvironment } from '../../server/env';
import { requireActor } from '../../server/http/rsc';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const actor = await requireActor('/');
  return readAuthEnvironment().mode === 'demo' ? (
    <DemoMode userId={actor.userId}>{children}</DemoMode>
  ) : (
    children
  );
}
