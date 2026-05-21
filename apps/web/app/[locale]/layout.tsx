import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { QueryProvider } from '@/components/providers/query-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { WorkspaceThemeProvider } from '@/components/providers/workspace-theme-provider';
import { CommandPalette } from '@/components/shell/command-palette';
import { routing } from '../i18n/routing';
import '../globals.css';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as 'zh' | 'en')) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <html lang={locale} data-theme="dark" className="bg-ink-base text-ink-primary">
      <body className="min-h-screen bg-ink-base font-sans text-ink-primary antialiased">
        <NextIntlClientProvider messages={messages}>
          <QueryProvider>
            <ThemeProvider>
              <WorkspaceThemeProvider>
                {children}
                <CommandPalette />
              </WorkspaceThemeProvider>
            </ThemeProvider>
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
