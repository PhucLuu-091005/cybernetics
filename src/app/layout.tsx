import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeScript } from '../components/shell/ThemeScript';
import './globals.css';

const geist = Geist({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  variable: '--font-geist',
});
const geistMono = Geist_Mono({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  title: 'Promise Graph',
  description: 'An event tracker where Main changes only through merged change requests.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
