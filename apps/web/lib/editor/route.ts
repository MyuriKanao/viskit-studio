export function decodeEditorRouteImageId(imageIdParam: string) {
  try {
    return decodeURIComponent(imageIdParam);
  } catch {
    return null;
  }
}
