/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { livecollabService } from './livecollabService.js';
import { Emitter, Event } from '../../../../base/common/event.js';

export const LIVECOLLAB_SCHEME = 'livecollab';

export class LiveCollabFileSystemProvider extends InMemoryFileSystemProvider {

	private _roomId: string = '';
	private _pendingRequests = new Map<string, (content: string) => void>();
	// Real fix (PHASE3_YJS_DESIGN.md section 30, Option A - server
	// assigns identity, not clients). The server now assigns a real,
	// stable id to every file the first time its tree entry is
	// broadcast, and preserves that same id across re-broadcasts. This
	// map stores that server-assigned id per itemPath (the same string
	// used to build this file's livecollab:// URI, so it can be looked
	// up directly from a model's own uri.path when needed), replacing
	// the previous approach of using the client-computed path itself as
	// the sync identity - which never matched between a host's real
	// disk file and a guest's virtual copy of the same conceptual file.
	private readonly _serverFileIds = new Map<string, string>();
	getServerFileId(itemPath: string): string | undefined {
		return this._serverFileIds.get(itemPath);
	}
	// Real fix (PHASE3_YJS_DESIGN.md section 30 follow-up): the host
	// never runs populateFromTree for its own broadcast (socket.to()
	// excludes the sender), so it would never learn its own files'
	// server-assigned ids without this. This stores ids only, without
	// touching the virtual filesystem itself - the host's own files
	// already exist for real on disk, so only the id needs recording.
	storeServerFileIds(tree: any[], basePath: string = ''): void {
		for (const item of tree) {
			const itemPath = basePath ? `${basePath}/${item.name}` : item.name;
			if (item.id) { this._serverFileIds.set(itemPath, item.id); this._onFileIdsAvailable.fire(); }
			if (item.type === 'directory' && item.children?.length > 0) {
				this.storeServerFileIds(item.children, itemPath);
			}
		}
	}
	// Real fix (PHASE3_YJS_DESIGN.md section 30 follow-up): the host's
	// own model uri for a real, locally-attached file is its absolute
	// disk path (file:// scheme) - not the relative itemPath used as
	// the key for server-assigned ids. This maps a real, absolute path
	// back to the relative itemPath computed when the tree was first
	// read, so _setupYjsBinding() can translate a host's own file:// uri
	// into the same identity space guests already use for livecollab://
	// files.
	// Real fix (PHASE3_YJS_DESIGN.md section 30 follow-up, real race
	// condition caught before testing): _setupYjsBinding() can genuinely
	// run before either id map above is populated, if a file opens
	// right on room join before the tree finishes reading/broadcasting.
	// The existing code already handles that moment gracefully (skips
	// with a log, doesn't crash) - but without this event, if the id
	// becomes available moments later and the user never happens to
	// switch files afterward, that first file would be permanently
	// stuck with no Yjs binding for the rest of the session. This fires
	// whenever either populateFromTree (guest's own tree arriving) or
	// storeServerFileIds (host learning its own ids back via ack) adds
	// real ids, so a listener can retry a previously-skipped binding.
	private readonly _onFileIdsAvailable = new Emitter<void>();
	readonly onFileIdsAvailable: Event<void> = this._onFileIdsAvailable.event;
	private readonly _realPathToItemPath = new Map<string, string>();
	recordRealPath(realPath: string, itemPath: string): void {
		this._realPathToItemPath.set(realPath, itemPath);
	}
	getItemPathForRealPath(realPath: string): string | undefined {
		return this._realPathToItemPath.get(realPath);
	}

	constructor() {
		super();
		// When file content arrives from host, resolve pending request
		livecollabService.onFileContent(({ path, content }) => {
			const resolve = this._pendingRequests.get(path);
			if (resolve) {
				this._pendingRequests.delete(path);
				resolve(content);
			}
		});
	}

	setRoomId(roomId: string): void {
		this._roomId = roomId;
	}

	clear(): void {
		// Wipe all in-memory files so the next room loads clean (spec 6B)
		this._pendingRequests.clear();
		this._roomId = '';
		try { (this as any)._files = new Map(); } catch {}
		try { (this as any).files = new Map(); } catch {}
	}

	async populateFromTree(tree: any[], basePath: string = ''): Promise<void> {
		for (const item of tree) {
			const itemPath = basePath ? `${basePath}/${item.name}` : item.name;
			// Real fix (PHASE3_YJS_DESIGN.md section 30): store the server-
			// assigned id for this file, so _setupYjsBinding() can look it
			// up later by this same itemPath and use the real, shared
			// server identity instead of a client-computed one.
			if (item.id) { this._serverFileIds.set(itemPath, item.id); this._onFileIdsAvailable.fire(); }
			const uri = URI.from({ scheme: LIVECOLLAB_SCHEME, authority: this._roomId, path: `/${itemPath}` });
			if (item.type === 'directory') {
				try { await this.mkdir(uri); } catch { }
				if (item.children?.length > 0) {
					await this.populateFromTree(item.children, itemPath);
				}
			} else {
				// Write empty placeholder — content loaded on demand
				console.log('[#3-DIAG] populateFromTree WRITE-EMPTY', itemPath, 'at', Date.now(), 'hadPendingRequest:', this._pendingRequests.has(itemPath));
				try { await this.writeFile(uri, VSBuffer.fromString('').buffer, { create: true, overwrite: true, unlock: false, atomic: false }); } catch { }
			}
		}
	}

	async loadFileContent(path: string, filePath: string): Promise<void> {
		return new Promise<void>((resolve) => {
			const __alreadyPending = this._pendingRequests.has(path);
			console.log('[#3-DIAG] loadFileContent START', path, 'at', Date.now(), __alreadyPending ? '*** DUPLICATE - already had a pending request for this path ***' : '(first request)');
			this._pendingRequests.set(path, async (content: string) => {
				console.log('[#3-DIAG] loadFileContent RESOLVE/WRITE', path, 'at', Date.now(), 'contentLength:', content.length);
				const uri = URI.from({ scheme: LIVECOLLAB_SCHEME, authority: this._roomId, path: filePath });
				try {
					await this.writeFile(uri, VSBuffer.fromString(content).buffer, { create: true, overwrite: true, unlock: false, atomic: false });
				} catch { }
				resolve();
			});
			livecollabService.requestFileContent(path);
		});
	}
}

export const livecollabFileSystemProvider = new LiveCollabFileSystemProvider();
