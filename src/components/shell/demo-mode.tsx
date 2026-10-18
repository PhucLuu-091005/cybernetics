'use client';
import { createContext, useContext } from 'react';

const DemoContext = createContext(false);

export function DemoMode({ children }: { children: React.ReactNode }) {
  return <DemoContext value>{children}</DemoContext>;
}

export const useDemoMode = () => useContext(DemoContext);
