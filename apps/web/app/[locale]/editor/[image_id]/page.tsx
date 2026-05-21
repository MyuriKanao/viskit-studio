import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { EditorRoot } from '@/components/editor/EditorRoot';

export const metadata: Metadata = {
  title: 'Editor — Viskit Studio',
};

export default async function EditorPage({
  params,
}: {
  params: { locale: string; image_id: string };
}) {
  let imageId: string;
  try {
    imageId = decodeURIComponent(params.image_id);
  } catch {
    notFound();
  }
  return <EditorRoot imageId={imageId} />;
}
