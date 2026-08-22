/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { URI } from '../../../../base/common/uri.js';
// Phase 3 (PHASE3_YJS_DESIGN.md): 'yjs' is a real third-party npm package,
// not part of VS Code's own internal module graph. This codebase's lint
// rules require third-party npm modules to be loaded via
// importAMDNodeModule (real, actively-used pattern elsewhere in this
// fork - see markedKatexSupport.ts's use for 'katex') rather than a
// plain top-level `import`, which would type-check but fail to actually
// resolve at runtime. Real compile-vs-runtime distinction caught before
// testing, not after - a plain `import` passed TypeScript's type-checker
// completely, but would NOT have worked when the app actually ran.
// Type-only reference below (does not trigger runtime loading);
// YDoc is the actual runtime module, loaded lazily via getYjsModule().
type YDoc = InstanceType<typeof import('yjs').Doc>;


const SERVER_URL = 'https://live-collab-production.up.railway.app';
// Scenario 1 (same-session room switching) saved state. See
// PHASE2_OVERLAY_DESIGN.md section 6. Deliberately minimal - only the
// fields decided as in-scope (folder path, open files, active file), not
// cursor/scroll position (deferred) and not virtual filesystem state
// (handled separately via the existing fileSystemProvider.clear() +
// server refetch on join).
export interface RoomState {
	folderUri: URI | undefined;
	folderName: string | undefined;
	openFileUris: URI[];
	activeFileUri: URI | undefined;
}

import SentryWorkbench from './vendor/sentry.electron.renderer.esm.js';
SentryWorkbench.init({
	dsn: 'https://c08142a98b008018e7b40a0699031f11@o4511821873348608.ingest.us.sentry.io/4511821905854464',
	sampleRate: 1.0,
});
console.log('[LiveCollab] Sentry initialized (workbench renderer)');

export interface ILiveCollabMember {
	userId: string;
	name: string;
	email: string;
	role: 'owner' | 'editor' | 'viewer';
	socketId: string;
}

export interface ILiveCollabMessage {
	id: string;
	userId: string;
	displayName: string;
	content: string;
	createdAt: string;
}

export class LiveCollabService extends Disposable {

	private socket: any = null;
	private _token: string | undefined;
	private _roomId: string | undefined;
	private _roomName: string | undefined;
	private _displayName: string = 'User';
	private _myUserId: string = '';
	private _recentlySentNonces = new Set<string>(); // bounded, see emitCodeChange (#3 Door 1 fix)
	private _lastMembers: ILiveCollabMember[] = [];
	private _fileCache: Map<string, string> = new Map();
	private _connecting = false;
	// PHASE3_YJS_DESIGN.md sections 11-12: the Clerk session token has a
	// confirmed 60-second lifetime (decoded directly from a real JWT).
	// This timer proactively re-mints it well before expiry, so a stale
	// token never sits waiting to cause a reactive disconnect - regardless
	// of whether that disconnect is server-triggered by expiry (not yet
	// confirmed) or something else, keeping this warm is a safe, real
	// improvement either way.
	private _tokenRefreshTimer: ReturnType<typeof setInterval> | undefined;

	private readonly _onConnected = this._register(new Emitter<void>());
	readonly onConnected: Event<void> = this._onConnected.event;

	private readonly _onDisconnected = this._register(new Emitter<void>());
	readonly onDisconnected: Event<void> = this._onDisconnected.event;

	private readonly _onMembersChanged = this._register(new Emitter<ILiveCollabMember[]>());
	readonly onMembersChanged: Event<ILiveCollabMember[]> = this._onMembersChanged.event;

	private readonly _onMessageReceived = this._register(new Emitter<ILiveCollabMessage>());
	readonly onMessageReceived: Event<ILiveCollabMessage> = this._onMessageReceived.event;

	private readonly _onCodeChange = this._register(new Emitter<{ fileId: string; code: string }>());
	readonly onCodeChange: Event<{ fileId: string; code: string }> = this._onCodeChange.event;

	private readonly _onRoomState = this._register(new Emitter<{ files: Array<{ id: string; content: string }> }>());
	readonly onRoomState: Event<{ files: Array<{ id: string; content: string }> }> = this._onRoomState.event;

	private readonly _onCursorUpdate = this._register(new Emitter<{ socketId: string; roomId: string; fileId: string; name: string; position: { lineNumber: number; column: number } }>());
	readonly onCursorUpdate: Event<{ socketId: string; roomId: string; fileId: string; name: string; position: { lineNumber: number; column: number } }> = this._onCursorUpdate.event;

	private readonly _onCursorLeave = this._register(new Emitter<{ socketId: string }>());
	readonly onCursorLeave: Event<{ socketId: string }> = this._onCursorLeave.event;

	private readonly _onFileContentRequest = this._register(new Emitter<{ path: string; ack: any }>());
	readonly onFileContentRequest: Event<{ path: string; ack: any }> = this._onFileContentRequest.event;

	private readonly _onMemberJoined = this._register(new Emitter<void>());

	// Carries the roomId that was just left, so listeners can save that
	// room's state before it's gone. Changed from Event<void> 2026-08-14 -
	// confirmed safe, both existing listeners use zero-parameter callbacks.
	private readonly _onRoomLeft = this._register(new Emitter<string>());
	readonly onRoomLeft: Event<string> = this._onRoomLeft.event;
	// Fires when a room join succeeds, carrying the room ID, so listeners
	// (livecollabFolderContribution.ts) can restore any saved state for
	// THIS specific room. See PHASE2_OVERLAY_DESIGN.md section 6.
	private readonly _onRoomJoined = this._register(new Emitter<string>());
	readonly onRoomJoined: Event<string> = this._onRoomJoined.event;
	// In-memory, per-room saved state for Scenario 1 (same-session room
	// switching). Keyed by roomId. Intentionally NOT persisted to disk -
	// lost on app quit, which is correct, documented behavior (Scenario 2,
	// cross-session persistence, is explicitly out of scope for Stage 2).
	private readonly _roomStates = new Map<string, RoomState>();
	// Phase 3 (PHASE3_YJS_DESIGN.md): one Y.Doc per file, matching the
	// existing per-file pattern already used by _fileCache. Created lazily,
	// the update->emit listener is registered ONCE here at creation time
	// (not per editor-contribution-instance) so multiple editors/panes on
	// the same file never cause duplicate emits.
	private readonly _yjsDocs = new Map<string, YDoc>();
	// PHASE3_YJS_DESIGN.md section 7 follow-up: real race found via a
	// second live test - the synchronous seed in getOrCreateYjsDoc only
	// catches content that's ALREADY in the model at binding time. If real
	// content arrives slightly AFTER binding (a genuine race, confirmed by
	// the observed symptom: file empty until the NEXT edit, which matches
	// content only ever arriving via code:change, not any working initial-
	// load path), the doc stays empty until something re-seeds it. Tracks
	// which fileIds have been seeded with real content, so trySeedYjsDoc
	// below gets a second (and third) chance without ever re-seeding once
	// real content has genuinely landed.
	private readonly _yjsDocsSeeded = new Set<string>();
	// Fires when a REMOTE Yjs update arrives over the socket, carrying
	// which file it's for. The editor contribution applies it and guards
	// against re-emitting it as a local change (see PHASE3_YJS_DESIGN.md).
	private readonly _onYjsUpdate = this._register(new Emitter<{ fileId: string; update: Uint8Array }>());
	readonly onYjsUpdate: Event<{ fileId: string; update: Uint8Array }> = this._onYjsUpdate.event;
	readonly onMemberJoined: Event<void> = this._onMemberJoined.event;

	private readonly _onFileTree = this._register(new Emitter<{ tree: any[], roomName: string }>());
	readonly onFileTree: Event<{ tree: any[], roomName: string }> = this._onFileTree.event;

	private readonly _onFileContent = this._register(new Emitter<{ path: string; content: string }>());
	readonly onFileContent: Event<{ path: string; content: string }> = this._onFileContent.event;

	get isConnected(): boolean { return this.socket?.connected ?? false; }
	get roomId(): string | undefined { return this._roomId; }
	get roomName(): string | undefined { return this._roomName; }
	get myUserId(): string { return this._myUserId; }
	private _myRole: string | undefined;
	get myRole(): string | undefined { return this._myRole; }
	setRoomContext(name: string | undefined, role: string | undefined): void {
		this._roomName = name;
		this._myRole = role;
	}
	get token(): string | undefined { return this._token; }
	get lastMembers(): ILiveCollabMember[] { return this._lastMembers; }

	setToken(token: string): void {
		this._token = token;
		try {
			const parts = token.split('.');
			if (parts.length === 3) {
				const payload = JSON.parse(atob(parts[1]));
				this._displayName = payload.email ? payload.email.split('@')[0] : 'User';
				if (payload.sub) { this._myUserId = payload.sub; }
			}
		} catch { }
	}

	hasToken(): boolean { return !!this._token; }

	// Re-mint a fresh Clerk session JWT from the long-lived dvb_ token.
	// Called on every socket (re)connect so the token is never stale. (#12)
	async refreshToken(): Promise<string | undefined> {
		try {
			const ipc = (window as any).vscode?.ipcRenderer;
			if (!ipc) { return this._token; }
			const dvbJwt = (() => { try { return localStorage.getItem('__clerk_db_jwt') || ''; } catch { return ''; } })();
			if (!dvbJwt) { return this._token; }
			const fresh = await ipc.invoke('vscode:livecollab-mint-token', dvbJwt) as string | null;
			if (fresh) { this._token = fresh; return fresh; }
			return this._token;
		} catch { return this._token; }
	}
	async connect(): Promise<void> {
		if (!this._token) { return; }
		if (this.socket?.connected) { return; }
		if (this._connecting) { return; }
		this._connecting = true;
		if (this.socket) { this.socket.disconnect(); this.socket = null; }
		// @ts-ignore
		const { io } = await import('./vendor/socket.io.esm.min.js');
		this.socket = io(SERVER_URL, {
			auth: async (cb: (data: { token: string }) => void) => {
				const fresh = await this.refreshToken();
				cb({ token: fresh || this._token || '' });
			},
			transports: ['websocket'],
			reconnection: true,
		});
		this.socket.on('connect', () => {
			this._connecting = false;
			console.log('[LiveCollab] socket connected, user:', this._displayName);
			// Proactive refresh: real, 60s-confirmed token lifetime, refresh
			// at 45s to leave a genuine safety margin. Cleared/restarted here
			// (not just on first connect) so a reconnect always gets a fresh
			// timer too, never two overlapping ones.
			if (this._tokenRefreshTimer) { clearInterval(this._tokenRefreshTimer); }
			this._tokenRefreshTimer = setInterval(() => { this.refreshToken(); }, 45000);
			// If we were already in a room, this is a RECONNECT: re-join so the server
			// re-subscribes this socket to the room. room:join only fired on first connect
			// before, so after a reconnect the socket was live but not in any room. (#19)
			if (this._roomId) {
				const rid = this._roomId;
				console.log('[LiveCollab] reconnected — re-joining room:', rid);
				this.socket.emit('room:join', { roomId: rid, displayName: this._displayName, colorIndex: 0 }, (res: any) => {
					if (res?.userId) { this._myUserId = res.userId; }
					console.log('[LiveCollab] re-join ack:', res && res.ok);
				});
			}
			this._onConnected.fire();
		});
		this.socket.on('connect_error', (err: any) => {
			this._connecting = false;
			console.warn('[LiveCollab] socket connect_error:', err && err.message);
		});
		this.socket.on('disconnect', (reason: string) => {
			this._connecting = false;
			console.log('[LiveCollab] socket disconnected, reason:', reason);
			if (this._tokenRefreshTimer) { clearInterval(this._tokenRefreshTimer); this._tokenRefreshTimer = undefined; }
			this._onDisconnected.fire();
		});
		this.socket.on('room:members', ({ members }: { members: ILiveCollabMember[] }) => {
			console.log('[LiveCollab] room:members received:', members.length);
			this._lastMembers = members;
			this._onMembersChanged.fire(members);
		});
		this.socket.on('code:change', (payload: { fileId: string; code: string; nonce?: string }) => {
			// Ignore our own edits echoing back (can slip through socket.to()'s exclusion during
			// a reconnect race - old/new socket overlap). Nonce identifies OUR emissions
			// precisely, unlike a content-match, which could wrongly drop a real collaborator's
			// edit that happens to match what we just sent. (#3 Door 1 fix)
			if (payload.nonce && this._recentlySentNonces.has(payload.nonce)) { return; }
			this._fileCache.set(payload.fileId, payload.code);
			this._onCodeChange.fire(payload);
		});
		// Phase 3 (PHASE3_YJS_DESIGN.md): parallel Yjs update channel, running
		// ALONGSIDE code:change above, not replacing it. Minimal first
		// integration - if Yjs causes a problem, code:change still works.
		this.socket.on('yjs:update', (payload: { fileId: string; update: number[] }) => {
			this._onYjsUpdate.fire({ fileId: payload.fileId, update: new Uint8Array(payload.update) });
		});
		this.socket.on('cursor:update', (payload: any) => { this._onCursorUpdate.fire(payload); });
		this.socket.on('cursor:leave', (payload: any) => { this._onCursorLeave.fire(payload); });
		this.socket.on('room:member:joined', ({ roomName }: { roomName?: string }) => {
			this._onMemberJoined.fire();
		});
		this.socket.on('room:file:tree', ({ tree, roomName }: { tree: any[], roomName?: string }) => {
			const resolvedName = roomName || this._roomName || 'Shared Room';
			console.log('[LiveCollab] file tree received:', tree.length, 'items, roomName:', resolvedName);
			if (roomName) { this._roomName = roomName; }
			this._onFileTree.fire({ tree, roomName: resolvedName });
		});
		this.socket.on('room:file:content', ({ path, content }: { path: string; content: string }) => {
			console.log('[LiveCollab] file content received:', path);
			this._onFileContent.fire({ path, content });
		});
		// Handle file content requests from guests
		this.socket.on('room:file:request', ({ path }: { path: string }, ack: any) => {
			console.log('[LiveCollab] file content requested:', path);
			this._onFileContentRequest.fire({ path, ack });
		});
		this.socket.on('room:state', (state: any) => {
			if (state?.files) {
				for (const f of state.files) { this._fileCache.set(f.id, f.content || ''); }
				this._onRoomState.fire(state);
			}
		});
		this.socket.on('chat:message', (msg: ILiveCollabMessage) => { this._onMessageReceived.fire(msg); });
	}


	async joinExistingRoom(roomId: string): Promise<void> {
		if (!this.socket?.connected) { return; }
		this._roomId = roomId;
		return new Promise((resolve) => {
			this.socket.emit('room:join', { roomId, displayName: this._displayName, colorIndex: 0 }, (res: any) => {
				if (res?.userId) { this._myUserId = res.userId; }
				// Fire onRoomJoined so listeners (livecollabFolderContribution.ts)
				// can restore any Scenario 1 saved state for THIS room. See
				// PHASE2_OVERLAY_DESIGN.md section 6.
				this._onRoomJoined.fire(roomId);
				resolve();
			});
		});
	}


	// ===== LiveCollab Dashboard verbs (Phase D week 1) =====
	async listMyRooms(): Promise<any[]> {
		if (!this.socket?.connected) { return []; }
		return new Promise((resolve) => {
			this.socket.emit('rooms:list', {}, (res: any) => {
				resolve(Array.isArray(res?.rooms) ? res.rooms : []);
			});
		});
	}
	async createRoomNamed(name: string): Promise<string | undefined> {
		if (!this.socket?.connected) { return undefined; }
		return new Promise((resolve) => {
			this.socket.emit('room:create', { name }, (res: any) => {
				resolve(res?.roomId);
			});
		});
	}
	async deleteRoom(roomId: string): Promise<boolean> {
		if (!this.socket?.connected) { return false; }
		return new Promise((resolve) => {
			this.socket.emit('room:delete', { roomId }, (res: any) => {
				resolve(!!res?.ok);
			});
		});
	}
	async fetchMembers(roomId: string): Promise<void> {
		if (!this.socket?.connected) { return; }
		this.socket.emit('room:members:get', { roomId }, (res: any) => {
			if (res && Array.isArray(res.members)) {
				this._lastMembers = res.members;
				this._onMembersChanged.fire(res.members);
			}
		});
	}

	async joinByCode(code: string): Promise<{ ok: boolean; roomId?: string; error?: string }> {
		if (!this.socket?.connected) { return { ok: false, error: 'not_connected' }; }
		return new Promise((resolve) => {
			this.socket.emit('room:invite:accept', { code }, (res: any) => {
				resolve({ ok: !!res?.ok, roomId: res?.roomId, error: res?.error });
			});
		});
	}

	clearRoom(): void {
		this._roomId = undefined;
		this._roomName = undefined;
		this._lastMembers = [];
		this._onMembersChanged.fire([]);
	}

	clearFolder(): void {
		// Only clears file state — room, members, chat stay intact
		this._fileCache.clear();
	}
	getFileContent(fileId: string): string | undefined { return this._fileCache.get(fileId); }
	updateFileCache(fileId: string, code: string): void { this._fileCache.set(fileId, code); }

	emitCodeChange(roomId: string, fileId: string, code: string): void {
		if (!this.socket?.connected) { return; }
		const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		this._recentlySentNonces.add(nonce);
		if (this._recentlySentNonces.size > 20) {
			const oldest = this._recentlySentNonces.values().next().value;
			if (oldest !== undefined) { this._recentlySentNonces.delete(oldest); }
		}
		this.socket.emit('code:change', { roomId, fileId, code, nonce });
	}
	// Phase 3 (PHASE3_YJS_DESIGN.md): one Y.Doc per file, created lazily.
	// Registers the outgoing-update listener ONCE here (not in the editor
	// contribution), so multiple editors/panes on the same file never
	// double-emit. origin !== 'remote' means "this change happened locally
	// (either real typing, captured automatically by y-monaco's own
	// MonacoBinding, or another local mechanism) - broadcast it." origin
	// === 'remote' means "this is an update WE just applied from another
	// user - do not re-broadcast it back."
	// Loads yjs+y-monaco from our own vendored bundle (real
	// yjs/y-monaco don't ship UMD - importAMDNodeModule can't load them,
	// confirmed via a live two-machine test failure and full root-cause
	// trace, see PHASE3_YJS_DESIGN.md sections 5-6). Combined into ONE
	// bundle deliberately - two separate bundles would each carry their
	// own independent copy of yjs, a real dual-package-hazard risk.
	// Loaded via plain dynamic import(), matching this project's own
	// already-proven pattern for socket.io.esm.min.js (see connect()
	// below - same directory, same technique). Cached after first load.
	private _yjsBundle: { Y: typeof import('yjs'); MonacoBinding: typeof import('y-monaco').MonacoBinding } | undefined;
	private async _loadYjsBundle(): Promise<{ Y: typeof import('yjs'); MonacoBinding: typeof import('y-monaco').MonacoBinding }> {
		if (!this._yjsBundle) {
			// @ts-ignore
			const loaded = await import('./vendor/livecollab-yjs.esm.min.js') as unknown as { Y: typeof import('yjs'); MonacoBinding: typeof import('y-monaco').MonacoBinding };
			this._yjsBundle = loaded;
			return loaded;
		}
		return this._yjsBundle;
	}
	// PUBLIC so livecollabEditorContribution.ts can reuse the SAME loaded
	// bundle rather than loading its own separate copy.
	async getYjsModule(): Promise<typeof import('yjs')> {
		return (await this._loadYjsBundle()).Y;
	}
	async getMonacoBindingClass(): Promise<typeof import('y-monaco').MonacoBinding> {
		return (await this._loadYjsBundle()).MonacoBinding;
	}
	// seedContent: PHASE3_YJS_DESIGN.md section 7 - real bug found via a
	// live two-machine test, root-caused to the exact line in y-monaco's
	// source. A brand-new, empty Y.Doc's initial sync unconditionally
	// overwrites real editor content that was already loaded by the
	// separate, older virtual-filesystem mechanism (onFileContent, which
	// does NOT populate _fileCache - confirmed by grep before relying on
	// it). Only used when ACTUALLY creating a new doc (never touches an
	// existing one, so real collaborative history is never at risk).
	// Inserted BEFORE the update listener is registered, so the seed
	// itself is local bootstrapping, never broadcast as a fake edit.
	async getOrCreateYjsDoc(fileId: string, seedContent?: string): Promise<YDoc> {
		const existing = this._yjsDocs.get(fileId);
		if (existing) { return existing; }
		const Y = await this.getYjsModule();
		const doc = new Y.Doc();
		if (seedContent) {
			doc.getText('content').insert(0, seedContent);
			this._yjsDocsSeeded.add(fileId);
		}
		doc.on('update', (update: Uint8Array, origin: unknown) => {
			if (origin === 'remote') { return; }
			if (!this.socket?.connected) { return; }
			this.socket.emit('yjs:update', { fileId, update: Array.from(update) });
		});
		this._yjsDocs.set(fileId, doc);
		return doc;
	}
	// Second (and third) chance to seed, called whenever real content
	// might have just arrived (onCodeChange, onFileContent). Guarded
	// twice: only if this fileId hasn't already been confirmed seeded,
	// AND only if the doc's real, current text is still genuinely empty
	// (never overwrites actual content, seeded or from real edits, even
	// if the tracking flag somehow lagged). Does nothing if the doc
	// doesn't exist yet - a file that hasn't been opened has no binding
	// to correct, and will seed correctly via the normal path once it is.
	trySeedYjsDoc(fileId: string, content: string): void {
		if (!content) { return; }
		if (this._yjsDocsSeeded.has(fileId)) { return; }
		const doc = this._yjsDocs.get(fileId);
		if (!doc) { return; }
		const ytext = doc.getText('content');
		if (ytext.length > 0) { this._yjsDocsSeeded.add(fileId); return; } // real content already landed some other way
		ytext.insert(0, content);
		this._yjsDocsSeeded.add(fileId);
	}
	emitCursorUpdate(roomId: string, fileId: string, position: { lineNumber: number; column: number }): void {
		if (!this.socket?.connected) { return; }
		this.socket.emit('cursor:update', { roomId, fileId, position, name: this._displayName });
	}

	sendMessage(roomId: string, content: string): void {
		if (!this.socket?.connected) { return; }
		this.socket.emit('chat:send', { roomId, text: content, name: this._displayName });
	}

	// Core room-leave cleanup: server notification + local state clear.
	// Idempotent - safe to call with no active room (early-returns).
	//
	// IMPORTANT: this function does NOT navigate anywhere. Navigation is
	// the CALLER's responsibility, not this function's - this is an
	// intentional split for Stage 2 of the overlay (PHASE2_OVERLAY_DESIGN.md
	// section 4): the button-click path (leaveRoom(), below) still needs to
	// go back to the dashboard, but the room-switch path (main process
	// sending vscode:livecollab-join-room to switch from room A to room B)
	// must NOT navigate - it needs to stay on the persistent workbench and
	// join the new room directly. Do not add navigation back into this
	// function - if you need navigation, add it in your own caller, the
	// way leaveRoom() does below.
	leaveCurrentRoom(): void {
		if (!this._roomId) { return; }
		// Capture before clearing - listeners need to know WHICH room to
		// save state for (see PHASE2_OVERLAY_DESIGN.md section 6).
		const leftRoomId = this._roomId;
		if (this.socket?.connected) {
			this.socket.emit('room:leave', { roomId: leftRoomId });
		}
		this._roomId = undefined;
		this._roomName = undefined;
		this._lastMembers = [];
		// Real, serious bug found via live testing (2026-08-20): Yjs docs
		// were keyed ONLY by bare filename, never room-scoped, and never
		// cleared here - meaning a file reused across a DIFFERENT room
		// later in the same running session (e.g. delete a room, create a
		// new one with a same-named file) would silently reuse the OLD
		// doc's stale content. Confirmed: a second live test showed
		// leftover characters from an unrelated earlier test appearing in
		// a brand-new room's file. Real fix: clear both Yjs maps on every
		// room leave, same as the existing room-isolation pattern already
		// used for the folder/file system state below this method's
		// callers. destroy() is Yjs's own real cleanup method, confirmed
		// via source inspection earlier this session.
		for (const doc of this._yjsDocs.values()) { doc.destroy(); }
		this._yjsDocs.clear();
		this._yjsDocsSeeded.clear();
		this._onMembersChanged.fire([]);
		// Fire onRoomLeft - livecollab.contribution.ts and
		// livecollabFolderContribution.ts listen and handle all teardown
		// (file system clear, editor close, and now state-save for restore)
		// in their own places, avoiding a circular import between this file
		// and livecollabFileSystemProvider.ts (which already imports THIS
		// file). See PHASE2_OVERLAY_DESIGN.md sections 4 and 6.
		this._onRoomLeft.fire(leftRoomId);
	}
	// Scenario 1 save/restore access (PHASE2_OVERLAY_DESIGN.md section 6).
	// This class only STORES the data - the actual save/restore ACTIONS
	// (reading/writing real folders and editors) live in
	// livecollabFolderContribution.ts, which has the needed service
	// injections this plain class does not.
	saveRoomState(roomId: string, state: RoomState): void {
		this._roomStates.set(roomId, state);
	}
	getRoomState(roomId: string): RoomState | undefined {
		return this._roomStates.get(roomId);
	}
	leaveRoom(): void {
		if (!this._roomId) { return; }
		this.leaveCurrentRoom();
		// Navigate back to dashboard - this is leaveRoom()'s own concern,
		// NOT leaveCurrentRoom()'s. See the comment above leaveCurrentRoom().
		const ipc = (window as any).vscode?.ipcRenderer;
		if (ipc) { ipc.send('vscode:livecollab-load-dashboard'); }
	}

	kickMember(userId: string): void {
		if (!this.socket?.connected || !this._roomId) { return; }
		this.socket.emit('room:kick', { roomId: this._roomId, userId });
	}

	setMemberRole(userId: string, role: 'editor' | 'viewer'): void {
		if (!this.socket?.connected || !this._roomId) { return; }
		this.socket.emit('room:role:set', { roomId: this._roomId, userId, role });
	}

	transferOwnership(userId: string): void {
		if (!this.socket?.connected || !this._roomId) { return; }
		this.socket.emit('room:owner:transfer', { roomId: this._roomId, userId });
	}

	async createInviteCode(): Promise<{ success: boolean; code?: string; error?: string }> {
		return new Promise((resolve) => {
			if (!this.socket?.connected || !this._roomId) { resolve({ success: false, error: 'Not in a room' }); return; }
			this.socket.emit('room:invite:create', { roomId: this._roomId }, (res: any) => {
				if (res?.code) { resolve({ success: true, code: res.code }); }
				else { resolve({ success: false, error: res?.error || 'Could not create invite code' }); }
			});
		});
	}

	

	broadcastFileTree(tree: any[]): void {
		if (!this.socket?.connected || !this._roomId) { return; }
		console.log('[LiveCollab] broadcasting file tree with roomName:', this._roomName);
		this.socket.emit('room:file:tree', { roomId: this._roomId, tree, roomName: this._roomName || 'Shared Room' });
	}

	respondFileContent(ack: any, path: string, fileContent: string): void {
		if (!this.socket?.connected) { return; }
		this.socket.emit('room:file:response', { requesterId: ack, path, content: fileContent });
	}

	requestFileContent(path: string): void {
		if (!this.socket?.connected || !this._roomId) { return; }
		this.socket.emit('room:file:request', { roomId: this._roomId, path });
	}

	async joinRoom(inviteCode: string): Promise<{ success: boolean; roomId?: string; error?: string }> {
		return new Promise((resolve) => {
			if (!this.socket?.connected) { resolve({ success: false, error: 'Not connected' }); return; }
			this.socket.emit('room:invite:accept', { code: inviteCode }, (res: any) => {
				if (res?.roomId) { this._roomId = res.roomId; resolve({ success: true, roomId: res.roomId }); }
				else { resolve({ success: false, error: res?.error || 'Invalid invite code' }); }
			});
		});
	}

	async login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
		return new Promise((resolve) => {
			const xhr = new XMLHttpRequest();
			xhr.open('POST', `${SERVER_URL}/auth/login`, true);
			xhr.setRequestHeader('Content-Type', 'application/json');
			xhr.onload = () => {
				try {
					const data = JSON.parse(xhr.responseText);
					if (data.token) { this.setToken(data.token); resolve({ success: true }); }
					else { resolve({ success: false, error: data.error || 'Invalid email or password' }); }
				} catch { resolve({ success: false, error: 'Invalid server response' }); }
			};
			xhr.onerror = () => resolve({ success: false, error: 'Could not connect to server' });
			xhr.send(JSON.stringify({ email, password }));
		});
	}

	setRequestService(_requestService: IRequestService): void { }
	
}

export const livecollabService = new LiveCollabService();
