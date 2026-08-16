/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { livecollabService } from './livecollabService.js';
import { importAMDNodeModule } from '../../../../amdX.js';
// Phase 3 (PHASE3_YJS_DESIGN.md): both are real third-party npm packages,
// loaded via importAMDNodeModule (see livecollabService.ts's top-of-file
// comment for the full reasoning - a plain `import` type-checks but does
// not correctly resolve at runtime in this codebase). Type-only
// references below (no runtime loading triggered); the actual runtime
// modules are loaded lazily via _loadYMonaco().
type YMonacoBinding = InstanceType<typeof import('y-monaco').MonacoBinding>;
let _yMonacoModule: typeof import('y-monaco') | undefined;
async function _loadYMonaco(): Promise<typeof import('y-monaco')> {
	if (!_yMonacoModule) {
		_yMonacoModule = await importAMDNodeModule<typeof import('y-monaco')>('y-monaco', 'dist/y-monaco.cjs');
	}
	return _yMonacoModule;
}

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
		const modelAtStart = this.editor.getModel();
		if (!modelAtStart) { return; }
		const fileId = modelAtStart.uri.path.split('/').pop() || modelAtStart.uri.path;

		const doc = await livecollabService.getOrCreateYjsDoc(fileId);
		const YMonaco = await _loadYMonaco();

		const modelNow = this.editor.getModel();
		if (!modelNow || modelNow !== modelAtStart) { return; } // stale - user switched files again while we were loading

		this._yjsBinding?.destroy();
		const ytext = doc.getText('content');
		this._yjsBinding = new YMonaco.MonacoBinding(ytext, modelNow, new Set([this.editor]));
	}
}

registerEditorContribution(
	LiveCollabEditorContribution.ID,
	LiveCollabEditorContribution,
	EditorContributionInstantiation.AfterFirstRender
);
