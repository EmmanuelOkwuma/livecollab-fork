/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IRequestService } from '../../../../platform/request/common/request.js';


const SERVER_URL = 'https://live-collab-production.up.railway.app';

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
	private _displayName: string = 'User';
	private _folderRoomCache: Map<string, string> = new Map();
	private _lastMembers: ILiveCollabMember[] = [];
	private _fileCache: Map<string, string> = new Map();
	private _connecting = false;

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

	private readonly _onFileTree = this._register(new Emitter<any[]>());
	readonly onFileTree: Event<any[]> = this._onFileTree.event;

	private readonly _onFileContent = this._register(new Emitter<{ path: string; content: string }>());
	readonly onFileContent: Event<{ path: string; content: string }> = this._onFileContent.event;

	get isConnected(): boolean { return this.socket?.connected ?? false; }
	get roomId(): string | undefined { return this._roomId; }
	get token(): string | undefined { return this._token; }
	get lastMembers(): ILiveCollabMember[] { return this._lastMembers; }

	setToken(token: string): void {
		this._token = token;
		try {
			const parts = token.split('.');
			if (parts.length === 3) {
				const payload = JSON.parse(atob(parts[1]));
				this._displayName = payload.email ? payload.email.split('@')[0] : 'User';
			}
		} catch { }
	}

	hasToken(): boolean { return !!this._token; }

	async connect(): Promise<void> {
		if (!this._token) { return; }
		if (this.socket?.connected) { return; }
		if (this._connecting) { return; }
		this._connecting = true;
		if (this.socket) { this.socket.disconnect(); this.socket = null; }
		// @ts-ignore
		const { io } = await import('./vendor/socket.io.esm.min.js');
		this.socket = io(SERVER_URL, { auth: { token: this._token }, transports: ['websocket'] });
		this.socket.on('connect', () => {
			this._connecting = false;
			console.log('[LiveCollab] socket connected, user:', this._displayName);
			this._onConnected.fire();
		});
		this.socket.on('disconnect', () => { this._connecting = false; this._onDisconnected.fire(); });
		this.socket.on('room:members', ({ members }: { members: ILiveCollabMember[] }) => {
			console.log('[LiveCollab] room:members received:', members.length);
			this._lastMembers = members;
			this._onMembersChanged.fire(members);
		});
		this.socket.on('code:change', (payload: { fileId: string; code: string }) => {
			this._fileCache.set(payload.fileId, payload.code);
			this._onCodeChange.fire(payload);
		});
		this.socket.on('cursor:update', (payload: any) => { this._onCursorUpdate.fire(payload); });
		this.socket.on('cursor:leave', (payload: any) => { this._onCursorLeave.fire(payload); });
		this.socket.on('room:file:tree', ({ tree }: { tree: any[] }) => {
			console.log('[LiveCollab] file tree received:', tree.length, 'items');
			this._onFileTree.fire(tree);
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

	async createRoom(folderName: string, folderPath: string): Promise<void> {
		if (!this.socket?.connected) { return; }
		return new Promise((resolve) => {
			this.socket.emit('room:create', { name: folderName }, (res: any) => {
				if (res?.roomId) {
					this._roomId = res.roomId;
					this._folderRoomCache.set(folderPath, res.roomId);
					console.log('[LiveCollab] room created:', res.roomId);
				}
				resolve();
			});
		});
	}

	async joinExistingRoom(roomId: string): Promise<void> {
		if (!this.socket?.connected) { return; }
		this._roomId = roomId;
		return new Promise((resolve) => {
			this.socket.emit('room:join', { roomId, displayName: this._displayName, colorIndex: 0 }, () => { resolve(); });
		});
	}

	getRoomIdForFolder(folderPath: string): string | undefined { return this._folderRoomCache.get(folderPath); }

	clearRoom(): void {
		this._roomId = undefined;
		this._lastMembers = [];
		this._onMembersChanged.fire([]);
	}
	getFileContent(fileId: string): string | undefined { return this._fileCache.get(fileId); }
	updateFileCache(fileId: string, code: string): void { this._fileCache.set(fileId, code); }

	emitCodeChange(roomId: string, fileId: string, code: string): void {
		if (!this.socket?.connected) { return; }
		this.socket.emit('code:change', { roomId, fileId, code });
	}

	emitCursorUpdate(roomId: string, fileId: string, position: { lineNumber: number; column: number }): void {
		if (!this.socket?.connected) { return; }
		this.socket.emit('cursor:update', { roomId, fileId, position, name: this._displayName });
	}

	sendMessage(roomId: string, content: string): void {
		if (!this.socket?.connected) { return; }
		this.socket.emit('chat:send', { roomId, text: content, name: this._displayName });
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
		this.socket.emit('room:file:tree', { roomId: this._roomId, tree });
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
