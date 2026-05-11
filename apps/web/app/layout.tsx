import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AIShop Studio',
  description: 'AI-powered product image studio',
};

/**
 * Root layout pass-through. The real <html>/<body> chrome lives at
 * apps/web/app/[locale]/layout.tsx where the active locale (and therefore
 * the lang attribute) is known.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
