/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { livecollabService } from './livecollabService.js';
import { livecollabFileSystemProvider, LIVECOLLAB_SCHEME } from './livecollabFileSystemProvider.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';

export class LiveCollabFolderContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.livecollabFolder';

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceEditingService private readonly workspaceEditingService: IWorkspaceEditingService,
	) {
		super();

		// When socket connects — attach current folder content to active room (if any)
		this._register(livecollabService.onConnected(() => {
			console.log('[LiveCollab] socket connected — checking folder');
			this._attachFolderToRoom();
		}));

		// Register livecollab:// file system provider
		this.fileService.registerProvider(LIVECOLLAB_SCHEME, livecollabFileSystemProvider);

		let _virtualFolderAdded = false;

		// When file tree arrives — populate virtual file system and open workspace
		this._register(livecollabService.onFileTree(async ({ tree, roomName }) => {
			const roomId = livecollabService.roomId;
			if (!roomId) { return; }
			console.log('[LiveCollab] populating virtual file system with tree:', tree.length, 'items, roomName:', roomName);
			livecollabFileSystemProvider.setRoomId(roomId);
			await livecollabFileSystemProvider.populateFromTree(tree);
			// Open the virtual folder in the explorer
			const uri = URI.file('/').with({ scheme: LIVECOLLAB_SCHEME, authority: roomId, path: '/' });
			// Open virtual folder for this room (reset flag ensures correct room each time)
			if (!_virtualFolderAdded) {
				_virtualFolderAdded = true;
				await this.workspaceEditingService.updateFolders(0, 0, [{ uri, name: roomName }]);
			}
		}));

		// When a new member joins — re-broadcast file tree to room
		this._register(livecollabService.onMemberJoined(async () => {
			const folders = this.workspaceContextService.getWorkspace().folders;
			if (!folders || folders.length === 0) { return; }
			console.log('[LiveCollab] new member joined — re-broadcasting file tree');
			await this._broadcastFileTree(folders[0].uri);
		}));

		// Handle file content requests from guests
		this._register(livecollabService.onFileContentRequest(async ({ path, ack }) => {
			try {
				const uri = URI.file(path);
				const fileContent = await this.fileService.readFile(uri);
				const content = fileContent.value.toString();
				livecollabService.respondFileContent(ack, path, content);
			} catch (e) {
				console.error('[LiveCollab] failed to read file for guest:', path, e);
			}
		}));

		// When folder changes while already connected — register new folder
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => {
			if (livecollabService.isConnected) {
				this._attachFolderToRoom();
			}
		}));

		// lc/1: startup is owned by LiveCollabStartupOwner — this contribution only listens
	}


	private async _attachFolderToRoom(): Promise<void> {
		// lc/1: rooms are born on the dashboard. A folder NEVER creates a room —
		// it only attaches content to the room you are already in.
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (!folders || folders.length === 0) {
			// No folder open — clear file state only, room and members stay
			livecollabService.clearFolder();
			return;
		}

		// Virtual livecollab:// folder — guest viewing a broadcast, nothing to attach
		if (folders.some(f => f.uri.scheme === LIVECOLLAB_SCHEME)) {
			console.log('[LiveCollab] virtual folder detected — content attach not applicable');
			return;
		}

		const roomId = livecollabService.roomId;
		if (!roomId) {
			console.log('[LiveCollab] folder open with no active room — not attaching (rooms are born on the dashboard)');
			return;
		}

		const folder = folders[0];
		console.log('[LiveCollab] attaching folder content to room:', roomId);
		await this._broadcastFileTree(folder.uri);
	}

	private async _broadcastFileTree(folderUri: URI): Promise<void> {
		try {
			const tree = await this._readFileTree(folderUri, 0);
			livecollabService.broadcastFileTree(tree);
			console.log('[LiveCollab] file tree broadcast:', tree.length, 'items');
		} catch (e) {
			console.error('[LiveCollab] failed to read file tree:', e);
		}
	}

	private async _readFileTree(uri: URI, depth: number): Promise<any[]> {
		if (depth > 4) { return []; } // max depth 4
		const SKIP = ['node_modules', '.git', 'out', 'dist', '.next', '__pycache__', '.DS_Store'];
		try {
			const stat = await this.fileService.resolve(uri);
			if (!stat.children) { return []; }
			const items: any[] = [];
			for (const child of stat.children) {
				const name = child.name;
				if (SKIP.includes(name)) { continue; }
				if (child.isDirectory) {
					const children = await this._readFileTree(child.resource, depth + 1);
					items.push({ name, path: child.resource.fsPath, type: 'directory', children });
				} else {
					items.push({ name, path: child.resource.fsPath, type: 'file' });
				}
			}
			return items.sort((a, b) => {
				if (a.type === 'directory' && b.type === 'file') { return -1; }
				if (a.type === 'file' && b.type === 'directory') { return 1; }
				return a.name.localeCompare(b.name);
			});
		} catch { return []; }
	}
}
