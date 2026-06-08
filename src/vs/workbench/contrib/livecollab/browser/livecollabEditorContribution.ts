/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { livecollabService } from './livecollabService.js';

export class LiveCollabEditorContribution extends Disposable implements IEditorContribution {

	static readonly ID = 'editor.contrib.livecollab';

	private _isApplyingRemoteChange = false;

	constructor(
		private readonly editor: ICodeEditor,
	) {
		super();

		// Emit code changes to socket when user types
		this._register(this.editor.onDidChangeModelContent(() => {
			console.log("[LiveCollab] change fired, connected:", livecollabService.isConnected, "roomId:", livecollabService.roomId);
			if (this._isApplyingRemoteChange) { return; }
			if (!livecollabService.isConnected) { return; }
			if (!livecollabService.roomId) { return; }

			const model = this.editor.getModel();
			if (!model) { return; }

			const fileId = model.uri.path;
			const code = model.getValue();

			livecollabService.emitCodeChange(livecollabService.roomId, fileId, code);
			livecollabService.updateFileCache(fileId, code);
		}));

		// When switching files, load latest content from cache
		this._register(this.editor.onDidChangeModel(() => {
			const model = this.editor.getModel();
			if (!model) { return; }
			const fileId = model.uri.path;
			const cached = livecollabService.getFileContent(fileId);
			if (cached !== undefined && cached !== model.getValue()) {
				this._isApplyingRemoteChange = true;
				try {
					model.pushEditOperations([], [{ range: model.getFullModelRange(), text: cached }], () => null);
				} finally {
					this._isApplyingRemoteChange = false;
				}
			}
		}));

		// Apply remote code changes to this editor
		this._register(livecollabService.onCodeChange(({ fileId, code }) => {
			// Always update cache regardless of which file is open
			livecollabService.updateFileCache(fileId, code);
			const model = this.editor.getModel();
			if (!model) { return; }

			if (model.uri.path !== fileId) { return; }

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
	}
}

registerEditorContribution(
	LiveCollabEditorContribution.ID,
	LiveCollabEditorContribution,
	EditorContributionInstantiation.AfterFirstRender
);
