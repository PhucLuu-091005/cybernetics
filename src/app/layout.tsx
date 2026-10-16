import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
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
// Applied before first paint so a stored theme never flashes the system one.
const THEME_SCRIPT = `try{var t=localStorage.getItem('pg-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
