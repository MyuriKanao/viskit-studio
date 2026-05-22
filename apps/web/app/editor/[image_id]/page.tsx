import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { MiniPaintEditor } from '@/components/editor/MiniPaintEditor';
import { decodeEditorRouteImageId } from '@/lib/editor/route';

export const metadata: Metadata = {
  title: 'Editor — Viskit Studio',
};

export default function DefaultLocaleEditorPage({ params }: { params: { image_id: string } }) {
  const imageId = decodeEditorRouteImageId(params.image_id);
  if (!imageId) notFound();
  return <MiniPaintEditor imageId={imageId} />;
}
