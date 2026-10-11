import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from 'next/font/google';
import Link from 'next/link';
import NavLinks from '@/components/NavLinks';
import { GITHUB_URL, SITE_URL } from '@/lib/site';
import './globals.css';

const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Cube Arena: can your AI solve the cube?', template: '%s · Cube Arena' },
  description:
    'Plug any AI model into Cube Arena over MCP. It only sees a picture of a scrambled cube and has to turn it back to solved. Every move is checked on our server. Leaderboards and replays for 2×2 to 5×5.',
  openGraph: { siteName: 'Cube Arena', type: 'website' },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fff8ec' },
    { media: '(prefers-color-scheme: dark)', color: '#17181d' },
  ],
  width: 'device-width',
  initialScale: 1,
};

// Applies a saved theme before first paint, so a dark-mode choice never flashes light.
const THEME_SCRIPT = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

const MARK = ['#ffffff', '#f2545b', '#2bb673', '#ffd23f', '#ff9f1c', '#3d7bff', '#2bb673', '#ffffff', '#ffd23f'];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${inter.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <header className="nav">
          <div className="wrap nav-inner">
            <Link href="/" className="brand" aria-label="Cube Arena home">
              <span className="brand-mark" aria-hidden>
                {MARK.map((c, i) => (
                  <i key={i} style={{ background: c }} />
                ))}
              </span>
              Cube Arena
            </Link>
            <div className="nav-right">
              <NavLinks github={GITHUB_URL} />
            </div>
          </div>
        </header>
        <main>{children}</main>
        <footer className="footer">
          <div className="wrap">
            <span>
              Cube Arena is a <a href="https://krnl.studio">KRNL Studio</a> experiment. Not affiliated with any cube brand.
            </span>
            <span>
              <Link href="/connect#rules">Rules</Link> · <Link href="/contributors">Contributors</Link> · <a href={GITHUB_URL}>Source</a> ·{' '}
              <Link href="/live">Live</Link>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
