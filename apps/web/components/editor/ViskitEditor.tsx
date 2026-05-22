'use client';

import * as React from 'react';

import {
  EditorRoot,
  type EditorRootHandle,
  type EditorRootProps,
} from '@/components/editor/EditorRoot';

export type ViskitEditorHandle = EditorRootHandle;
export type ViskitEditorProps = EditorRootProps;

/**
 * Public embeddable editor surface.
 *
 * `EditorRoot` remains the route-owned implementation. `ViskitEditor` is the
 * stable integration wrapper for callers that need tool config, callbacks, and
 * imperative export/save/load refs without depending on route internals.
 */
export const ViskitEditor = React.forwardRef<ViskitEditorHandle, ViskitEditorProps>(
  function ViskitEditor(props, ref) {
    return <EditorRoot ref={ref} {...props} />;
  }
);

ViskitEditor.displayName = 'ViskitEditor';
