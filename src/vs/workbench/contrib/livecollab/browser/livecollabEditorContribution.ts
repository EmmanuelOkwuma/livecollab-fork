/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { livecollabService } from './livecollabService.js';
import { createMonacoBaseAPI } from '../../../../editor/common/services/editorBaseApi.js';
// Type-only reference (no runtime import triggered) - the actual
// runtime class is loaded via livecollabService.getMonacoBindingClass(),
// see that file's own comments for the full reasoning (yjs/y-monaco
// don't ship UMD, importAMDNodeModule can't load them - real root cause
// traced via a live two-machine test failure, see PHASE3_YJS_DESIGN.md
// sections 5-6). This file's own real, NEW responsibility: y-monaco's
// bundled code expects to import the standalone 'monaco-editor' npm
// package (which this fork doesn't use - it IS Monaco internally,
// structured differently). Our vendor bundle's build step redirects
// that unresolvable import to a small shim
// (vendor/_livecollab-monaco-shim.mjs) that reads real values from
// globalThis.__livecollabMonacoAPI - set here, once, at module load,
// using this codebase's OWN createMonacoBaseAPI(), which builds an
// object with the exact shape needed using this codebase's own real,
// live Range/Selection/SelectionDirection classes (confirmed via
// source inspection before writing this - not a guess). MUST run here,
// synchronously, at module top-level - before ANY code path in this
// file could trigger the vendor bundle's dynamic import, since the
// shim reads this global at module-evaluation time, not lazily.
type YMonacoBinding = InstanceType<typeof import('y-monaco').MonacoBinding>;
(globalThis as any).__livecollabMonacoAPI = createMonacoBaseAPI();

export class LiveCollabEditorContribution extends Disposable implements IEditorContribution {

	static readonly ID = 'editor.contrib.livecollab';

	private _isApplyingRemoteChange = false;
	// Phase 3 (PHASE3_YJS_DESIGN.md): guards the EXISTING onDidChangeModelContent
	// listener below from re-broadcasting a Yjs remote update as if it were
	// a fresh local keystroke. y-monaco's OWN internal mutex only protects
	// ITS OWN listener on the same Monaco event - it has no visibility into
	// this SEPARATE listener, so this class needs its own guard, set around
	// wherever WE apply a remote Yjs update below (real evidence, checked
	// directly against y-monaco's source before writing this).
	private _isApplyingYjsChange = false;
	private _yjsBinding: YMonacoBinding | undefined;

	constructor(
		private readonly editor: ICodeEditor,
	) {
		super();

		// Real fix (PHASE3_YJS_DESIGN.md section 29): _setupYjsBinding()
		// was previously only called inside onDidChangeModel, which only
		// fires when switching to a DIFFERENT file. A file already open
		// in the editor when this contribution is constructed - the
		// common case on room join - never got a Yjs binding at all,
		// confirmed with real evidence: the old code:change path fired
		// dozens of times in a live two-machine test while Yjs/y-monaco/
		// MonacoBinding never appeared anywhere in the captured logs.
		// Call it here too so the very first file gets bound as well.
		this._setupYjsBinding();

		// Emit code changes to socket when user types
		this._register(this.editor.onDidChangeModelContent(() => {
			console.log("[LiveCollab] change fired, connected:", livecollabService.isConnected, "roomId:", livecollabService.roomId);
			if (this._isApplyingRemoteChange || this._isApplyingYjsChange) { return; }
			if (!livecollabService.isConnected) { return; }
			if (!livecollabService.roomId) { return; }

			const model = this.editor.getModel();
			if (!model) { return; }

			// Use filename only as fileId so host and guest paths match
			const fileId = model.uri.path.split('/').pop() || model.uri.path;
			const code = model.getValue();

			livecollabService.emitCodeChange(livecollabService.roomId, fileId, code);
			livecollabService.updateFileCache(fileId, code);
		}));

		// When switching files, load latest content from cache
		this._register(this.editor.onDidChangeModel(() => {
			const model = this.editor.getModel();
			if (!model) { return; }
			// Use filename only as fileId so host and guest paths match
			const fileId = model.uri.path.split('/').pop() || model.uri.path;
			const cached = livecollabService.getFileContent(fileId);
			if (cached !== undefined && cached !== model.getValue()) {
				this._isApplyingRemoteChange = true;
				try {
					model.pushEditOperations([], [{ range: model.getFullModelRange(), text: cached }], () => null);
				} finally {
					this._isApplyingRemoteChange = false;
				}
			}
			this._setupYjsBinding();
		}));

		// Apply remote code changes to this editor
		this._register(livecollabService.onCodeChange(({ fileId, code }) => {
			console.log('[LiveCollab] code change received, fileId:', fileId, 'model uri path:', editor.getModel()?.uri.path);
			// PHASE3_YJS_DESIGN.md section 7 follow-up: real content may have
			// arrived slightly after the Yjs binding was set up (a genuine
			// race, confirmed by a live two-machine test - file stayed empty
			// until the next edit). This is the SAME mechanism that made the
			// file correct again in that test, now made deliberate rather
			// than accidental. Safe to call unconditionally - no-ops if the
			// doc doesn't exist yet or has already received real content.
			livecollabService.trySeedYjsDoc(fileId, code);
			// Always update cache regardless of which file is open
			livecollabService.updateFileCache(fileId, code);
			const model = this.editor.getModel();
			if (!model) { return; }

			const modelFileId = model.uri.path.split('/').pop() || model.uri.path;
			if (modelFileId !== fileId) { return; }

			this._isApplyingRemoteChange = true;
			try {
				const currentValue = model.getValue();
				if (currentValue !== code) {
					const fullRange = model.getFullModelRange();
					model.pushEditOperations([], [{
						range: fullRange,
						text: code,
					}], () => null);
				}
			} finally {
				this._isApplyingRemoteChange = false;
			}
		}));

		// Phase 3 (PHASE3_YJS_DESIGN.md): apply incoming remote Yjs updates.
		// The guard here is what prevents the onDidChangeModelContent listener
		// above from re-broadcasting this over the OLD code:change channel too.
		this._register(livecollabService.onYjsUpdate(({ fileId, update }) => {
			const model = this.editor.getModel();
			if (!model) { return; }
			const modelFileId = model.uri.path.split('/').pop() || model.uri.path;
			if (modelFileId !== fileId) { return; }
			this._applyRemoteYjsUpdate(fileId, update);
		}));

		// Set up the Yjs binding for whatever file is already open at
		// construction time - onDidChangeModel above only fires on
		// SUBSEQUENT switches, not for the model that's already attached.
		this._setupYjsBinding();

		// MonacoBinding doesn't follow VS Code's IDisposable convention (it
		// has .destroy(), not .dispose() - confirmed directly in y-monaco's
		// source before writing this). Wrap it so _register's normal
		// disposal mechanism still cleans it up correctly.
		this._register({ dispose: () => this._yjsBinding?.destroy() });
	}

	// Applies an incoming remote Yjs update. Async because loading the yjs
	// module and the file's Y.Doc may both be async on first use; cheap
	// (cached) on every call after that.
	private async _applyRemoteYjsUpdate(fileId: string, update: Uint8Array): Promise<void> {
		const doc = await livecollabService.getOrCreateYjsDoc(fileId);
		const Y = await livecollabService.getYjsModule();
		this._isApplyingYjsChange = true;
		try {
			Y.applyUpdate(doc, update, 'remote');
		} finally {
			this._isApplyingYjsChange = false;
		}
	}
	// Async because both the Y.Doc and MonacoBinding module may need to
	// load. Real race guard: if the user switches files again before this
	// resolves, the fileId captured at the start is checked against the
	// CURRENT model before committing the binding, so an older, slower-
	// resolving call can never overwrite a newer one with a stale binding.
	private async _setupYjsBinding(): Promise<void> {
		// Real, precise diagnostic (PHASE3_YJS_DESIGN.md section 29
		// follow-up): this function had zero logging of its own, so a
		// live two-machine test showing no Yjs-related console activity
		// was genuinely ambiguous - could mean this never gets called,
		// or it runs completely silently either way. Also called
		// without await/catch at its call sites, so any real thrown
		// error here would become a silent unhandled rejection. Logging
		// entry, progress, and any real failure removes the ambiguity
		// with real evidence instead of guessing further.
		console.log('[LiveCollab] _setupYjsBinding called');
		const modelAtStart = this.editor.getModel();
		if (!modelAtStart) { console.log('[LiveCollab] _setupYjsBinding: no model, aborting'); return; }
		const fileId = modelAtStart.uri.path.split('/').pop() || modelAtStart.uri.path;
		// Captured synchronously, before any await, so this reflects whatever
		// real content is ALREADY in the model right now (see
		// PHASE3_YJS_DESIGN.md section 7 - a brand-new Y.Doc must be seeded
		// with this, or y-monaco's own initial sync will overwrite real
		// content with an empty document). Only takes effect if a NEW doc is
		// actually being created - getOrCreateYjsDoc ignores this entirely
		// when reusing an existing doc, so real collaborative history is
		// never at risk of being re-seeded.
		const currentContent = modelAtStart.getValue();

		try {
		const doc = await livecollabService.getOrCreateYjsDoc(fileId, currentContent);
		console.log('[LiveCollab] _setupYjsBinding: got Y.Doc for fileId:', fileId);
		const MonacoBindingClass = await livecollabService.getMonacoBindingClass();
		console.log('[LiveCollab] _setupYjsBinding: got MonacoBinding class:', !!MonacoBindingClass);

		const modelNow = this.editor.getModel();
		if (!modelNow || modelNow !== modelAtStart) { console.log('[LiveCollab] _setupYjsBinding: stale, model changed while loading'); return; } // stale - user switched files again while we were loading

		this._yjsBinding?.destroy();
		const ytext = doc.getText('content');
		this._yjsBinding = new MonacoBindingClass(ytext, modelNow, new Set([this.editor]));
		console.log('[LiveCollab] _setupYjsBinding: binding created successfully for fileId:', fileId);
		} catch (e) {
			console.log('[LiveCollab] _setupYjsBinding: real error:', e);
		}
	}
}

registerEditorContribution(
	LiveCollabEditorContribution.ID,
	LiveCollabEditorContribution,
	EditorContributionInstantiation.AfterFirstRender
);
