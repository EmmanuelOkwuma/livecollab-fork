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
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { EditorsOrder } from '../../../common/editor.js';

export class LiveCollabFolderContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.livecollabFolder';

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceEditingService private readonly workspaceEditingService: IWorkspaceEditingService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super();

		// When socket connects — attach current folder content to active room (if any)
		this._register(livecollabService.onConnected(() => {
			console.log('[LiveCollab] socket connected — checking folder');
			this._attachFolderToRoom();
		}));

		// When leaving a room - remove any REAL (non-livecollab://) workspace
		// folder that was attached to it. Room isolation gap found 2026-08-14:
		// opening a real folder to attach content to a room is the CORRECT,
		// intended mechanism (see _attachFolderToRoom's own comment below) -
		// but nothing previously closed that folder on leave, so it stayed
		// visibly open across different rooms (confirmed by real user testing:
		// Room 1's folder was still showing after switching to Room 2). No
		// stored reference to "the room's folder" exists anywhere in this
		// codebase - read the live workspace state at leave-time instead.
		this._register(livecollabService.onRoomLeft((leftRoomId) => {
			const folders = this.workspaceContextService.getWorkspace().folders;
			const realFolderIndex = folders.findIndex(f => f.uri.scheme !== LIVECOLLAB_SCHEME);
			const realFolder = realFolderIndex !== -1 ? folders[realFolderIndex] : undefined;
			// Real (non-livecollab://) editor identifiers - needed for BOTH
			// saving (their resource URIs, for Scenario 1 restore per
			// PHASE2_OVERLAY_DESIGN.md section 6) AND closing (the full
			// identifiers, with groupId, required by closeEditors()). REAL GAP
			// found 2026-08-14: this listener previously saved state and
			// removed the folder, but never actually closed the open real file
			// tabs - confirmed by direct testing (clean leave via UI, not a
			// force-kill, the tab still persisted on next room open).
			const realEditorIdentifiers = this.editorService.getEditors(EditorsOrder.SEQUENTIAL)
				.filter(identifier => identifier.editor.resource && identifier.editor.resource.scheme !== LIVECOLLAB_SCHEME);
			const openRealEditors = realEditorIdentifiers.map(identifier => identifier.editor.resource!);
			const activeUri = this.editorService.activeEditor?.resource;
			livecollabService.saveRoomState(leftRoomId, {
				folderUri: realFolder?.uri,
				folderName: realFolder?.name,
				openFileUris: openRealEditors,
				activeFileUri: (activeUri && activeUri.scheme !== LIVECOLLAB_SCHEME) ? activeUri : undefined
			});
			if (realEditorIdentifiers.length > 0) {
				this.editorService.closeEditors(realEditorIdentifiers);
			}
			if (realFolderIndex !== -1) {
				console.log('[LiveCollab] room left - removing attached real folder');
				this.workspaceEditingService.updateFolders(realFolderIndex, 1);
			}
		}));

		// Scenario 1 restore: when a room join succeeds, re-apply any saved
		// state for THIS specific room. No-op for a room with no saved state
		// (correctly matches Scenario 3 - a genuinely new/different room).
		// Stale-state handling is a correctness requirement, not polish: a
		// saved file may no longer exist (deleted, moved) - each file open
		// is attempted independently and failures are skipped silently, never
		// thrown, so one stale file cannot break restoring the rest.
		this._register(livecollabService.onRoomJoined(async (joinedRoomId) => {
			const saved = livecollabService.getRoomState(joinedRoomId);
			if (!saved) { return; }
			// Folder first, then files - files opening from a folder that isn't
			// yet in the workspace is inconsistent even if technically possible.
			if (saved.folderUri) {
				try {
					const currentCount = this.workspaceContextService.getWorkspace().folders.length;
					await this.workspaceEditingService.updateFolders(currentCount, 0, [{ uri: saved.folderUri }]);
				} catch (e) {
					console.warn('[LiveCollab] could not restore saved folder (may no longer exist):', e);
				}
			}
			for (const uri of saved.openFileUris) {
				if (saved.activeFileUri && uri.toString() === saved.activeFileUri.toString()) { continue; } // open active file last, below
				try {
					await this.editorService.openEditor({ resource: uri, options: { pinned: true, preserveFocus: true } });
				} catch (e) {
					console.warn('[LiveCollab] could not restore file (may no longer exist):', uri.toString(), e);
				}
			}
			if (saved.activeFileUri) {
				try {
					await this.editorService.openEditor({ resource: saved.activeFileUri });
				} catch (e) {
					console.warn('[LiveCollab] could not restore active file (may no longer exist):', saved.activeFileUri.toString(), e);
				}
			}
		}));

		// Register livecollab:// file system provider
		this.fileService.registerProvider(LIVECOLLAB_SCHEME, livecollabFileSystemProvider);

		let _virtualFolderAdded = false;

		// When file tree arrives — populate virtual file system and open workspace
		this._register(livecollabService.onFileTree(async ({ tree, roomName }) => {
			const roomId = livecollabService.roomId;
			if (!roomId) { return; }
			console.log('[#DOOR2-DIAG] onFileTree FIRED at', Date.now(), 'tree items:', tree.length, 'roomName:', roomName);
			console.trace('[#DOOR2-DIAG] onFileTree call stack');
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
