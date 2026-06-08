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

		// When socket connects — register current folder as room
		this._register(livecollabService.onConnected(() => {
			console.log('[LiveCollab] socket connected — checking folder');
			this._registerFolderAsRoom();
		}));

		// When folder changes while already connected — register new folder
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => {
			if (livecollabService.isConnected) {
				this._registerFolderAsRoom();
			}
		}));

		// On startup — load token and connect (this triggers onConnected above)
		this._initWithToken();
	}

	private async _initWithToken(): Promise<void> {
		const token = await this.secretStorageService.get('livecollab.token');
		console.log('[LiveCollab] _initWithToken token found:', !!token);
		if (token) {
			livecollabService.setToken(token);
			await livecollabService.connect();
		}
	}

	private async _registerFolderAsRoom(): Promise<void> {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (!folders || folders.length === 0) {
			// No folder open — clear members panel
			livecollabService.clearRoom();
			return;
		}

		const folder = folders[0];
		const folderPath = folder.uri.fsPath;
		const folderName = folder.name;

		const existingRoomId = livecollabService.getRoomIdForFolder(folderPath);
		if (existingRoomId) {
			console.log('[LiveCollab] folder already registered as room:', existingRoomId);
			await livecollabService.joinExistingRoom(existingRoomId);
			return;
		}

		console.log('[LiveCollab] registering folder as room:', folderName);
		await livecollabService.createRoom(folderName, folderPath);
	}
}
