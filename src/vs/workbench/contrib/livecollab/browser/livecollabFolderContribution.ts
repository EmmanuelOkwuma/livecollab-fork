/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { livecollabService } from './livecollabService.js';

export class LiveCollabFolderContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.livecollabFolder';

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
	) {
		super();

		// Load token from SecretStorage first then check folder
		this._initWithToken();

		// Listen for folder changes
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => {
			this._onFolderChanged();
		}));
	}

	private async _initWithToken(): Promise<void> {
		const token = await this.secretStorageService.get('livecollab.token');
		console.log('[LiveCollab] _initWithToken token found:', !!token);
		if (token) {
			livecollabService.setToken(token);
			await livecollabService.connect();
			// Wait for socket to fully authenticate before checking folder
			await new Promise<void>(resolve => {
				if (livecollabService.isConnected) { resolve(); return; }
				const d = livecollabService.onConnected(() => { d.dispose(); resolve(); });
				setTimeout(resolve, 4000);
			});
			console.log('[LiveCollab] after connect wait, isConnected:', livecollabService.isConnected);
		}
		this._onFolderChanged();
	}

	private async _onFolderChanged(): Promise<void> {
		console.log("[LiveCollab] folder changed, hasToken:", livecollabService.hasToken(), "isConnected:", livecollabService.isConnected);
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (!folders || folders.length === 0) {
			return;
		}

		if (!livecollabService.hasToken()) {
			return;
		}

		if (!livecollabService.isConnected) {
			await livecollabService.connect();
			// Wait for socket to fully connect
			await new Promise<void>(resolve => {
				if (livecollabService.isConnected) { resolve(); return; }
				const d = livecollabService.onConnected(() => { d.dispose(); resolve(); });
				setTimeout(resolve, 3000); // fallback
			});
		}

		const folder = folders[0];
		const folderPath = folder.uri.fsPath;
		const folderName = folder.name;

		// Check if we already have a roomId for this folder
		const existingRoomId = livecollabService.getRoomIdForFolder(folderPath);
		if (existingRoomId) {
			await livecollabService.joinExistingRoom(existingRoomId);
			return;
		}

		// Create a new room for this folder
		await livecollabService.createRoom(folderName, folderPath);
	}
}
