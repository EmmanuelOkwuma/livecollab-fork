/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IRequestService, asText } from '../../../../platform/request/common/request.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

const SERVER_URL = 'http://localhost:4000';

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

	private socket: any | undefined;
	private _token: string | undefined = localStorage.getItem('lc_test_token') || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI4NmJlOGYyYi1kNzg4LTQ5NWQtYjcyMC05MGI4YWQ0YTVjYzciLCJlbWFpbCI6ImVtbWFudWVsb2t3dW1hMTExQGdtYWlsLmNvbSIsImlhdCI6MTc4MDc5MzY3OSwiZXhwIjoxNzgxMzk4NDc5fQ.HQJxZdLz15B_gADxRlTTkuY3ixYP087-SLcoapC-9Jo";
	private _roomId: string | undefined = "room-520426e6-5185-410f-9909-fc4d5220912e";
	private _displayName: string = "User";
	private _fileCache: Map<string, string> = new Map();
	private _requestService: IRequestService | undefined;

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

	private readonly _onConnected = this._register(new Emitter<void>());
	readonly onConnected: Event<void> = this._onConnected.event;

	private readonly _onDisconnected = this._register(new Emitter<void>());
	readonly onDisconnected: Event<void> = this._onDisconnected.event;

	get isConnected(): boolean { return this.socket?.connected ?? false; }
	get roomId(): string | undefined { return this._roomId; }
	get token(): string | undefined { return this._token; }

	setRequestService(requestService: IRequestService): void {
		this._requestService = requestService;
	}

	async login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
		if (!this._requestService) {
			return { success: false, error: 'Service not ready — please try again' };
		}
		try {
			const context = await this._requestService.request({
				type: 'POST',
				url: `${SERVER_URL}/auth/login`,
				data: JSON.stringify({ email, password }),
				headers: { 'Content-Type': 'application/json' },
				callSite: 'LiveCollab.login',
			}, CancellationToken.None);

			const text = await asText(context);
			if (!text) { return { success: false, error: 'Empty response from server' }; }
			if (text.trim() === 'invalid_credentials') {
				return { success: false, error: 'Invalid email or password' };
			}

			try {
				const data = JSON.parse(text);
				if (data.token) {
					this._token = data.token;
					return { success: true };
				}
				return { success: false, error: data.error || 'Login failed' };
			} catch {
				return { success: false, error: text };
			}
		} catch (e: any) {
			return { success: false, error: e?.message || 'Could not connect to server' };
		}
	}

	async connect(): Promise<void> {
		if (!this._token) { return; }
		// @ts-ignore
		const { io } = await import('./vendor/socket.io.esm.min.js');
		this.socket = io(SERVER_URL, {
			auth: { token: this._token },
			transports: ['websocket'],
		});
		this.socket.on('connect', () => {
			try {
				const parts = this._token ? this._token.split('.') : [];
				if (parts.length === 3) {
					const payload = JSON.parse(atob(parts[1]));
					this._displayName = payload.email ? payload.email.split('@')[0] : 'User';
				}
			} catch { }
			this._onConnected.fire();
			if (this._roomId) {
				this.socket.emit('room:join', { roomId: this._roomId, displayName: this._displayName, colorIndex: 0 });
			}
		});
		this.socket.on('disconnect', () => { this._onDisconnected.fire(); });
		this.socket.on('room:members', ({ members }: { members: ILiveCollabMember[] }) => {
			this._onMembersChanged.fire(members);
		});
		this.socket.on('code:change', (payload: { fileId: string; code: string }) => { this._onCodeChange.fire(payload); });
		this.socket.on('cursor:update', (payload: any) => { this._onCursorUpdate.fire(payload); });
		this.socket.on('cursor:leave', (payload: any) => { this._onCursorLeave.fire(payload); });
		this.socket.on('room:state', (state: any) => {
			if (state?.files) {
				for (const f of state.files) {
					this._fileCache.set(f.id, f.content || '');
				}
				this._onRoomState.fire(state);
			}
		});
		this.socket.on('chat:message', (msg: ILiveCollabMessage) => {
			this._onMessageReceived.fire(msg);
		});
	}

	async joinRoom(inviteCode: string): Promise<{ success: boolean; roomId?: string; error?: string }> {
		return new Promise((resolve) => {
			if (!this.socket) { resolve({ success: false, error: 'Not connected' }); return; }
			this.socket.emit('room:invite:accept', { code: inviteCode }, (res: any) => {
				if (res?.roomId) {
					this._roomId = res.roomId;
					resolve({ success: true, roomId: res.roomId });
				} else {
					resolve({ success: false, error: res?.error || 'Invalid invite code' });
				}
			});
		});
	}

	emitCursorUpdate(roomId: string, fileId: string, position: { lineNumber: number; column: number }): void {
		if (!this.socket) { return; }
		console.log("[LiveCollab] emitting cursor with name:", this._displayName);
		this.socket.emit("cursor:update", { roomId, fileId, position, name: this._displayName });
	}

	getFileContent(fileId: string): string | undefined {
		return this._fileCache.get(fileId);
	}

	updateFileCache(fileId: string, code: string): void {
		this._fileCache.set(fileId, code);
	}

	emitCodeChange(roomId: string, fileId: string, code: string): void {
		if (!this.socket) { return; }
		this.socket.emit("code:change", { roomId, fileId, code });
	}

	sendMessage(roomId: string, content: string): void {
		if (!this.socket) { return; }
		this.socket.emit('chat:message', { roomId, content });
	}

	override dispose(): void {
		this.socket?.disconnect();
		super.dispose();
	}
}

export const livecollabService = new LiveCollabService();
