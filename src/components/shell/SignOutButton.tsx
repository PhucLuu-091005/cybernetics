'use client';
import { useRouter } from 'next/navigation';

export function SignOutButton() {
  const router = useRouter();
  const signOut = async () => {
    await fetch('/api/auth/session', { method: 'DELETE' });
    router.push('/signin');
    router.refresh();
  };
  return <button className="btn btn-quiet" type="button" onClick={signOut}>Sign out</button>;
}
