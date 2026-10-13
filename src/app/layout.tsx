import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import Link from 'next/link';
import './globals.css';
export const metadata: Metadata = { title: 'Promise Graph', description: 'Evidence, proposals and promise history.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const shell = <html lang="en"><body><div className="shell"><aside><div className="brand">Promise Graph</div><nav aria-label="Workspace"><Link href="/">Graph</Link><Link href="/inbox">Inbox</Link><Link href="/proposals">Proposals</Link><Link href="/history">History</Link><Link href="/investigations">Investigations</Link></nav></aside><main>{children}</main></div></body></html>;
  return process.env.AUTH_MODE === 'clerk' && process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <ClerkProvider>{shell}</ClerkProvider> : shell;
}
