'use client';
import { useSyncExternalStore } from 'react';

const noSubscription = () => () => {};
/** Controls stay disabled until React owns them; an earlier click or selection would change the DOM without reaching state. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}
