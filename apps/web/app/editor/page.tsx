import type { Metadata } from 'next';

import { MiniPaintEditor } from '@/components/editor/MiniPaintEditor';

export const metadata: Metadata = {
  title: 'Editor - Viskit Studio',
};

export default function DefaultEditorIndexPage() {
  return <MiniPaintEditor />;
}
