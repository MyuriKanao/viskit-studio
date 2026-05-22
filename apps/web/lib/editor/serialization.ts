import {
  EDITOR_DOCUMENT_VERSION,
  type ViskitEditorDocument,
  assertValidEditorDocument,
} from './document';

export interface SerializedEditorProject {
  schema: 'viskit-editor-project';
  version: typeof EDITOR_DOCUMENT_VERSION;
  document: ViskitEditorDocument;
}

export function createSerializedEditorProject(
  document: ViskitEditorDocument
): SerializedEditorProject {
  assertValidEditorDocument(document);
  return {
    schema: 'viskit-editor-project',
    version: EDITOR_DOCUMENT_VERSION,
    document,
  };
}

export function serializeEditorDocument(document: ViskitEditorDocument): string {
  return JSON.stringify(createSerializedEditorProject(document), null, 2);
}

export function deserializeEditorDocument(payload: string): ViskitEditorDocument {
  const parsed = JSON.parse(payload) as unknown;
  const project = migrateProject(parsed);
  return assertValidEditorDocument(project.document);
}

export function migrateProject(payload: unknown): SerializedEditorProject {
  if (!isRecord(payload)) throw new Error('Project payload must be an object');
  if (payload.schema === 'viskit-editor-document') {
    const document = assertValidEditorDocument(payload as unknown as ViskitEditorDocument);
    return {
      schema: 'viskit-editor-project',
      version: EDITOR_DOCUMENT_VERSION,
      document,
    };
  }
  if (payload.schema !== 'viskit-editor-project') {
    throw new Error('Unsupported project schema');
  }
  if (payload.version !== EDITOR_DOCUMENT_VERSION) {
    throw new Error(`Unsupported project version: ${String(payload.version)}`);
  }
  if (!isRecord(payload.document)) throw new Error('Project document must be an object');
  return payload as unknown as SerializedEditorProject;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
