import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { EditorRoot } from '@/components/editor/EditorRoot';
import { decodeEditorRouteImageId } from '@/lib/editor/route';

export const metadata: Metadata = {
  title: 'Editor — Viskit Studio',
};

export default async function EditorPage({
  params,
}: {
  params: { locale: string; image_id: string };
}) {
  const imageId = decodeEditorRouteImageId(params.image_id);
  if (!imageId) notFound();
  return <EditorRoot imageId={imageId} />;
}
