import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Viskit Studio',
  description: 'AI-powered product image studio',
  icons: {
    icon: [{ url: '/brand/viskit-favicon.svg', type: 'image/svg+xml' }],
    shortcut: [{ url: '/brand/viskit-favicon.svg', type: 'image/svg+xml' }],
  },
};

/**
 * Root layout pass-through. The real <html>/<body> chrome lives at
 * apps/web/app/[locale]/layout.tsx where the active locale (and therefore
 * the lang attribute) is known.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
