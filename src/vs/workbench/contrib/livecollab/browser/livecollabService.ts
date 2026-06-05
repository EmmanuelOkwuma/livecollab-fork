/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

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

	private socket: any | undefined;
	private _token: string | undefined;
	private _roomId: string | undefined;

	private readonly _onMembersChanged = this._register(new Emitter<ILiveCollabMember[]>());
	readonly onMembersChanged: Event<ILiveCollabMember[]> = this._onMembersChanged.event;

	private readonly _onMessageReceived = this._register(new Emitter<ILiveCollabMessage>());
	readonly onMessageReceived: Event<ILiveCollabMessage> = this._onMessageReceived.event;

	private readonly _onConnected = this._register(new Emitter<void>());
	readonly onConnected: Event<void> = this._onConnected.event;

	private readonly _onDisconnected = this._register(new Emitter<void>());
	readonly onDisconnected: Event<void> = this._onDisconnected.event;

	get isConnected(): boolean {
		return this.socket?.connected ?? false;
	}

	get roomId(): string | undefined {
		return this._roomId;
	}

	async login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
		try {
			const res = await fetch(`${SERVER_URL}/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password }),
			});
			const data = await res.json();
			if (data.token) {
				this._token = data.token;
				return { success: true };
			}
			return { success: false, error: data.error || 'Login failed' };
		} catch (e) {
			return { success: false, error: 'Could not connect to server' };
		}
	}

	async connect(): Promise<void> {
		if (!this._token) { return; }

		const { io } = await import('socket.io-client');
		this.socket = io(SERVER_URL, {
			auth: { token: this._token },
			transports: ['websocket'],
		});

		this.socket.on('connect', () => {
			console.log('[LiveCollab] Connected to server');
			this._onConnected.fire();
		});

		this.socket.on('disconnect', () => {
			console.log('[LiveCollab] Disconnected from server');
			this._onDisconnected.fire();
		});

		this.socket.on('room:members', ({ members }: { members: ILiveCollabMember[] }) => {
			this._onMembersChanged.fire(members);
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
