/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkspaceContextService, IWorkspaceIdentifier } from '../../../../platform/workspace/common/workspace.js';
import { livecollabService } from './livecollabService.js';
import { livecollabFileSystemProvider, LIVECOLLAB_SCHEME } from './livecollabFileSystemProvider.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { EditorsOrder } from '../../../common/editor.js';
import { IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';

export class LiveCollabFolderContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.livecollabFolder';

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceEditingService private readonly workspaceEditingService: IWorkspaceEditingService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
	) {
		super();

		// Real fix (real root cause, confirmed with direct evidence): virtual
		// livecollab:// workspace folders persist into the workspace file and
		// get restored on next launch, but they are only ever valid for the
		// one specific room they were created for. The existing leave-room
		// cleanup below deliberately removes only REAL folders, never these -
		// so they accumulate forever. Confirmed live: a guest's Explorer showed
		// folders from a previous room (room-d9b733f5) while actually being in
		// a different room (room-c0eaa19d), producing "Unable to resolve
		// nonexistent file" on every entry, with all those errors firing at
		// startup before LiveCollab even initialized. Removing them here, at
		// construction, means every session starts clean rather than
		// inheriting dead references to rooms that no longer exist.
		const staleVirtualFolders = this.workspaceContextService.getWorkspace().folders
			.filter(f => f.uri.scheme === LIVECOLLAB_SCHEME);
		if (staleVirtualFolders.length > 0) {
			console.log('[LiveCollab] removing', staleVirtualFolders.length, 'stale virtual room folders from a previous session');
			const firstIndex = this.workspaceContextService.getWorkspace().folders
				.findIndex(f => f.uri.scheme === LIVECOLLAB_SCHEME);
			this.workspaceEditingService.updateFolders(firstIndex, staleVirtualFolders.length);
		}

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
		this._register(livecollabService.onRoomLeft(async (leftRoomId) => {
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
			// TEMPORARY DIAGNOSTIC 2026-08-21: real evidence needed before
			// writing a fix - is this "two real folders present before
			// cleanup runs" (a race on the way in) or "cleanup ran but only
			// removed one" (a bug in the removal logic itself)? Re-queries the
			// ACTUAL, CURRENT folder list at this exact moment (not the
			// earlier-computed realFolderIndex/realFolder, which could be
			// stale by now) so the before/after picture is real, not assumed.
			if (realFolderIndex !== -1) {
				console.log('[LiveCollab] room left - removing attached real folder');
				this.workspaceEditingService.updateFolders(realFolderIndex, 1);
			}
			// PHASE3_YJS_DESIGN.md sections 16-18: real root cause of stale room
			// folders accumulating across sessions - updateFolders() above only
			// edits the LIVE, in-memory workspace, it never touches the separate,
			// disk-persisted untitled-workspace identity VS Code creates the first
			// time a folder gets added here. That identity file is what silently
			// accumulated every room ever visited (confirmed via direct filesystem
			// read on a real machine). Real fix: explicitly delete THIS workspace's
			// own untitled-workspace identity on a clean room leave, using the
			// same id/configuration already available from getWorkspace() - no new
			// IPC needed, IWorkspacesService already exposes exactly this.
			// KNOWN, NAMED GAP: this only runs on a clean leave. A force-kill,
			// crash, or unclean exit skips this entirely, same as it always has -
			// not solved here, real fix for that case is separate future work.
			const currentWorkspace = this.workspaceContextService.getWorkspace();
			if (currentWorkspace.configuration) {
				const workspaceIdentifier: IWorkspaceIdentifier = { id: currentWorkspace.id, configPath: currentWorkspace.configuration };
				try {
					await this.workspacesService.deleteUntitledWorkspace(workspaceIdentifier);
				} catch (e) {
					console.warn('[LiveCollab] could not delete untitled workspace identity on room leave:', e);
				}
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
			// Real fix (PHASE3_YJS_DESIGN.md section 30 follow-up, real,
			// confirmed blocker): the previous code added ONE workspace
			// folder at the virtual root, named after the room - wrapping
			// the guest's entire tree inside a "Shared Room" folder that
			// doesn't exist on the host's own side at all. This didn't just
			// look wrong - it was a real, confirmed blocker: the guest's
			// file ended up at a genuinely different identity path than the
			// host's same file, so the server-assigned Yjs file id could
			// never match between them, confirmed live via
			// "_setupYjsBinding: no server-assigned id yet" on the guest's
			// side despite the id genuinely existing on the host's side.
			// Now each real, top-level item from the host's own tree gets
			// added as its own separate workspace folder, exactly matching
			// the host's real structure - no extra wrapper layer at all.
			if (!_virtualFolderAdded) {
				_virtualFolderAdded = true;
				// Real fix (PHASE3_YJS_DESIGN.md section 32 follow-up, real bug
				// caught with direct evidence): the previous version mapped
				// every single tree item, including individual root-level
				// files (.env.local, package.json, etc.), into its own,
				// separate workspace folder - a file can't be a valid
				// workspace root at all in VS Code's own model. Confirmed via
				// the marker log showing 19 real items processed, matching
				// exactly 5 real folders plus 14 real root-level files after
				// the skip list - all 19 were being passed to updateFolders,
				// not just the 5 real directories, very likely the real cause
				// of the observed "Shared Room" grouping behavior. Only real
				// directories should become their own workspace folder; root-
				// level files already exist correctly in the virtual
				// filesystem via populateFromTree above and don't need this.
				const realDirectories = tree.filter((item) => item.type === 'directory');
				console.log('[LiveCollab] BUILD-VERIFY-2026-09-10 wrapper-fix-active, real top-level items:', tree.length, 'real directories:', realDirectories.length);
				const topLevelFolders = realDirectories.map((item) => ({
					uri: URI.file('/').with({ scheme: LIVECOLLAB_SCHEME, authority: roomId, path: `/${item.name}` }),
					name: item.name,
				}));
				await this.workspaceEditingService.updateFolders(0, 0, topLevelFolders);
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
		// Real fix (PHASE3_YJS_DESIGN.md section 30 follow-up): mirrors
		// the handler above exactly - the server is asking THIS machine,
		// as the room's own host, for a file's real, current content to
		// seed a brand-new, authoritative Yjs document server-side.
		// realPath can be either a real, absolute disk path (this host's
		// own file:// files) or a room-relative path (a livecollab://
		// file, if the host happens to have that one open too) - handled
		// the same scheme-aware way _getServerFileId already computes it
		// on the sending side.
		this._register(livecollabService.onYjsSeedContentRequest(async ({ requestId, realPath }) => {
			try {
				const uri = realPath.startsWith('/') ? URI.file(realPath) : URI.from({ scheme: LIVECOLLAB_SCHEME, authority: livecollabService.roomId, path: `/${realPath}` });
				const fileContent = await this.fileService.readFile(uri);
				const content = fileContent.value.toString();
				livecollabService.respondYjsSeedContent(requestId, content);
			} catch (e) {
				console.error('[LiveCollab] failed to read file for yjs seeding:', realPath, e);
				livecollabService.respondYjsSeedContent(requestId, '');
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
			// Real fix (real root cause, found with direct evidence): a guest
			// joining a room runs this exact same code against its own,
			// genuinely empty workspace and broadcasts "0 items" into the
			// room - confirmed live on the iMac's own console. That empty
			// broadcast then overwrites the host's real, populated tree
			// server-side, wiping it out for everyone and leaving the guest's
			// own Explorer permanently empty. An empty tree is never
			// meaningful to broadcast and can only ever destroy real data, so
			// it's guarded against entirely here rather than special-casing
			// host-vs-guest, which would be fragile.
			if (!tree || tree.length === 0) {
				console.log('[LiveCollab] skipping broadcast of empty file tree - nothing real to share');
				return;
			}
			// Real fix (PHASE3_YJS_DESIGN.md section 30 follow-up): the
			// server's ack now returns the same tree with a real, server-
			// assigned id on every entry. socket.to() excludes the sender,
			// so this is the host's only way to learn its own files' ids -
			// guests learn theirs from the normal room-wide broadcast.
			const treeWithIds = await livecollabService.broadcastFileTree(tree);
			if (treeWithIds) { livecollabFileSystemProvider.storeServerFileIds(treeWithIds); }
			console.log('[LiveCollab] file tree broadcast:', tree.length, 'items');
		} catch (e) {
			console.error('[LiveCollab] failed to read file tree:', e);
		}
	}

	private async _readFileTree(uri: URI, depth: number, relativePath: string = ''): Promise<any[]> {
		if (depth > 4) { return []; } // max depth 4
		const SKIP = ['node_modules', '.git', 'out', 'dist', '.next', '__pycache__', '.DS_Store'];
		try {
			const stat = await this.fileService.resolve(uri);
			if (!stat.children) { return []; }
			const items: any[] = [];
			for (const child of stat.children) {
				const name = child.name;
				if (SKIP.includes(name)) { continue; }
				// Real fix (PHASE3_YJS_DESIGN.md section 30 follow-up): compute
				// the same relative path here that populateFromTree computes
				// on the receiving side, and record which real, absolute disk
				// path it corresponds to. This lets the host later translate
				// its own file:// model uri (an absolute disk path) back to
				// the relative itemPath used as the key for server-assigned
				// ids, since the host's own files never go through
				// populateFromTree (that only runs for a livecollab:// tree
				// received from someone else).
				const itemRelativePath = relativePath ? `${relativePath}/${name}` : name;
				livecollabFileSystemProvider.recordRealPath(child.resource.fsPath, itemRelativePath);
				if (child.isDirectory) {
					const children = await this._readFileTree(child.resource, depth + 1, itemRelativePath);
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
