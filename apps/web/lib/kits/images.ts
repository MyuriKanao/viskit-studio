export function imageIdForIndex(index: number): string {
  return index < 5 ? `H${index + 1}` : `M${index - 4}`;
}

export function normalizeKitThumbs(
  thumbs: (string | null)[] | null | undefined,
  size = 14
): (string | null)[] {
  const normalized = (thumbs ?? []).slice(0, size);
  while (normalized.length < size) normalized.push(null);
  return normalized;
}
