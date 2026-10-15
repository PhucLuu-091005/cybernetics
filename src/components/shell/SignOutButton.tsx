'use client';
import { useRouter } from 'next/navigation';
import { RailIcon } from './icons';

export function SignOutButton() {
  const router = useRouter();
  const signOut = async () => {
    await fetch('/api/auth/session', { method: 'DELETE' });
    router.push('/signin');
    router.refresh();
  };
  return (
    <button
      className="rail-item"
      type="button"
      onClick={signOut}
      aria-label="Sign out"
      data-label="Sign out"
    >
      <RailIcon name="signOut" />
      <span className="rail-label">Sign out</span>
    </button>
  );
}
