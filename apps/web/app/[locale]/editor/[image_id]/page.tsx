import type { Metadata } from 'next';

import { EditorRoot } from '@/components/editor/EditorRoot';

export const metadata: Metadata = {
  title: 'Editor — Viskit Studio',
};

export default async function EditorPage({
  params,
}: {
  params: { locale: string; image_id: string };
}) {
  return <EditorRoot imageId={params.image_id} />;
}
