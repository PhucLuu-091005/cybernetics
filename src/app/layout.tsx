import type { Metadata } from 'next';
import { Overpass, Overpass_Mono, Source_Serif_4 } from 'next/font/google';
import './globals.css';

const overpass = Overpass({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-overpass',
});
const overpassMono = Overpass_Mono({
  subsets: ['latin'],
  weight: ['500'],
  variable: '--font-overpass-mono',
});
const sourceSerif = Source_Serif_4({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  weight: ['400', '600'],
  style: ['normal', 'italic'],
  variable: '--font-source-serif',
});

export const metadata: Metadata = {
  title: 'Promise Graph',
  description: 'Evidence, proposals and promise history.',
};
// Applied before first paint so a stored theme never flashes the system one.
const THEME_SCRIPT = `try{var t=localStorage.getItem('pg-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${overpass.variable} ${overpassMono.variable} ${sourceSerif.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
