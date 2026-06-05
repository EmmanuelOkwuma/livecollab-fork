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

function httpsPost(url: string, body: string, headers: Record<string, string>): Promise<string> {
	return new Promise((resolve, reject) => {
		const https = require('https');
		const urlObj = new URL(url);
		const options = {
			hostname: urlObj.hostname,
			path: urlObj.pathname,
			method: 'POST',
			headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
		};
		const req = https.request(options, (res: any) => {
			let data = '';
			res.on('data', (chunk: any) => { data += chunk; });
			res.on('end', () => resolve(data));
		});
		req.on('error', reject);
		req.write(body);
		req.end();
	});
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

	get isConnected(): boolean { return this.socket?.connected ?? false; }
	get roomId(): string | undefined { return this._roomId; }
	get token(): string | undefined { return this._token; }

	setRequestService(_: any): void { /* no longer needed */ }

	async login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
		try {
			const body = JSON.stringify({ email, password });
			const text = await httpsPost(
				`${SERVER_URL}/auth/login`,
				body,
				{ 'Content-Type': 'application/json' }
			);

			if (text.trim() === 'invalid_credentials') {
				return { success: false, error: 'Invalid email or password' };
			}

			const data = JSON.parse(text);
			if (data.token) {
				this._token = data.token;
				return { success: true };
			}
			return { success: false, error: data.error || 'Login failed' };
		} catch (e: any) {
			return { success: false, error: e?.message || 'Could not connect to server' };
		}
	}

	async connect(): Promise<void> {
		if (!this._token) { return; }
		const { io } = await import('socket.io-client');
		this.socket = io(SERVER_URL, {
			auth: { token: this._token },
			transports: ['websocket'],
		});
		this.socket.on('connect', () => { this._onConnected.fire(); });
		this.socket.on('disconnect', () => { this._onDisconnected.fire(); });
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
