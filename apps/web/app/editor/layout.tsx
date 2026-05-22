import { NextIntlClientProvider } from 'next-intl';

import { QueryProvider } from '@/components/providers/query-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { WorkspaceThemeProvider } from '@/components/providers/workspace-theme-provider';
import { CommandPalette } from '@/components/shell/command-palette';
import messages from '../../messages/zh.json';
import '../globals.css';

export default function DefaultEditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" data-theme="dark" className="bg-ink-base text-ink-primary">
      <body className="min-h-screen bg-ink-base font-sans text-ink-primary antialiased">
        <NextIntlClientProvider locale="zh" messages={messages}>
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
