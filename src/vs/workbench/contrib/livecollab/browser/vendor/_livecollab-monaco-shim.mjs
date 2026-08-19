/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// y-monaco expects to import the standalone 'monaco-editor' npm package, which
// this VS Code fork does not use (it IS Monaco internally, structured
// differently). This shim redirects that import (via an esbuild resolver
// plugin, see _build-yjs-bundle.mjs) to real, working values instead - read
// from a global that our own real TypeScript code (livecollabEditorContribution.ts)
// sets BEFORE this bundle is ever loaded, using createMonacoBaseAPI() from
// this codebase's own src/vs/editor/common/services/editorBaseApi.ts, which
// builds an object with this exact shape using this codebase's own real,
// live editor classes (confirmed via source inspection 2026-08-16, see
// PHASE3_YJS_DESIGN.md section 6). Only these three properties are provided
// because a direct grep of y-monaco's actual source confirmed these are the
// ONLY genuine runtime usages (every other 'monaco.*' reference in that file
// is a JSDoc type comment, not executable code).
export const Range = globalThis.__livecollabMonacoAPI.Range;
export const Selection = globalThis.__livecollabMonacoAPI.Selection;
export const SelectionDirection = globalThis.__livecollabMonacoAPI.SelectionDirection;
