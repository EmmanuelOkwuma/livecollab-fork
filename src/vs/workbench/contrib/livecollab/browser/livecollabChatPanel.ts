/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';

const USER_COLORS = [
	'#93c5fd',
	'#60a5fa',
	'#38bdf8',
	'#3b82f6',
	'#2563eb',
	'#818cf8',
];

function colorForIndex(index: number): string {
	return USER_COLORS[index % USER_COLORS.length];
}

function initialsFromName(name: string): string {
	return name.trim().charAt(0).toUpperCase();
}

interface IChatMessage {
	id: string;
	sender: string;
	text: string;
	timestamp: string;
	colorIndex: number;
	isMe: boolean;
}

export class LiveCollabChatPanel extends ViewPane {

	static readonly ID = 'workbench.panel.livecollab.chat';
	static readonly TITLE = localize('livecollabChat', "Chat");

	private messagesContainer: HTMLElement | undefined;
	private inputEl: HTMLInputElement | undefined;

	private messages: IChatMessage[] = [
		{ id: '1', sender: 'Lexi', text: 'Ready to start the session?', timestamp: '2:30 PM', colorIndex: 1, isMe: false },
		{ id: '2', sender: 'Emmanuel', text: 'Hell yeah, let\'s go', timestamp: '2:31 PM', colorIndex: 0, isMe: true },
	];

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.style.display = 'flex';
		container.style.flexDirection = 'column';
		container.style.height = '100%';
		container.style.overflow = 'hidden';

		// Messages area
		this.messagesContainer = document.createElement('div');
		this.messagesContainer.style.flex = '1';
		this.messagesContainer.style.overflowY = 'auto';
		this.messagesContainer.style.padding = '8px 12px';
		this.messagesContainer.style.display = 'flex';
		this.messagesContainer.style.flexDirection = 'column';
		this.messagesContainer.style.gap = '8px';
		container.appendChild(this.messagesContainer);

		this.renderMessages();

		// Input area
		const inputArea = document.createElement('div');
		inputArea.style.display = 'flex';
		inputArea.style.alignItems = 'center';
		inputArea.style.gap = '8px';
		inputArea.style.padding = '8px 12px';
		inputArea.style.borderTop = '1px solid #2b2b2b';
		inputArea.style.flexShrink = '0';

		this.inputEl = document.createElement('input');
		this.inputEl.type = 'text';
		this.inputEl.placeholder = 'Message your team...';
		this.inputEl.style.flex = '1';
		this.inputEl.style.background = '#1e1e1e';
		this.inputEl.style.border = '1px solid #2b2b2b';
		this.inputEl.style.borderRadius = '4px';
		this.inputEl.style.padding = '6px 10px';
		this.inputEl.style.color = '#cccccc';
		this.inputEl.style.fontSize = '12px';
		this.inputEl.style.outline = 'none';
		this.inputEl.onfocus = () => { this.inputEl!.style.borderColor = '#007ACC'; };
		this.inputEl.onblur = () => { this.inputEl!.style.borderColor = '#2b2b2b'; };
		this.inputEl.onkeydown = (e) => {
			if (e.key === 'Enter') { this.sendMessage(); }
		};
		inputArea.appendChild(this.inputEl);

		const sendBtn = document.createElement('button');
		sendBtn.textContent = 'Send';
		sendBtn.style.background = '#007ACC';
		sendBtn.style.border = 'none';
		sendBtn.style.borderRadius = '4px';
		sendBtn.style.padding = '6px 12px';
		sendBtn.style.color = '#ffffff';
		sendBtn.style.fontSize = '12px';
		sendBtn.style.cursor = 'pointer';
		sendBtn.style.flexShrink = '0';
		sendBtn.onmouseenter = () => { sendBtn.style.background = '#005fa3'; };
		sendBtn.onmouseleave = () => { sendBtn.style.background = '#007ACC'; };
		sendBtn.onclick = () => this.sendMessage();
		inputArea.appendChild(sendBtn);

		container.appendChild(inputArea);
	}

	private renderMessages(): void {
		if (!this.messagesContainer) { return; }
		this.messagesContainer.innerHTML = '';

		if (this.messages.length === 0) {
			const empty = document.createElement('div');
			empty.style.color = '#6e6e6e';
			empty.style.fontSize = '12px';
			empty.style.textAlign = 'center';
			empty.style.padding = '20px';
			empty.textContent = 'No messages yet. Say hello to your team.';
			this.messagesContainer.appendChild(empty);
			return;
		}

		this.messages.forEach(msg => {
			const row = document.createElement('div');
			row.style.display = 'flex';
			row.style.flexDirection = msg.isMe ? 'row-reverse' : 'row';
			row.style.alignItems = 'flex-start';
			row.style.gap = '8px';

			// Avatar
			const color = colorForIndex(msg.colorIndex);
			const avatar = document.createElement('div');
			avatar.style.width = '22px';
			avatar.style.height = '22px';
			avatar.style.borderRadius = '50%';
			avatar.style.background = color + '33';
			avatar.style.border = '1px solid ' + color + '66';
			avatar.style.backdropFilter = 'blur(4px)';
			avatar.style.display = 'flex';
			avatar.style.alignItems = 'center';
			avatar.style.justifyContent = 'center';
			avatar.style.fontSize = '11px';
			avatar.style.fontWeight = '600';
			avatar.style.color = color;
			avatar.style.flexShrink = '0';
			avatar.textContent = initialsFromName(msg.sender);
			row.appendChild(avatar);

			// Bubble
			const bubble = document.createElement('div');
			bubble.style.maxWidth = '70%';
			bubble.style.background = msg.isMe ? '#007ACC22' : '#2a2d2e';
			bubble.style.border = '1px solid ' + (msg.isMe ? '#007ACC44' : '#3e3e3e');
			bubble.style.borderRadius = '8px';
			bubble.style.padding = '6px 10px';

			const senderEl = document.createElement('div');
			senderEl.style.fontSize = '10px';
			senderEl.style.color = color;
			senderEl.style.marginBottom = '2px';
			senderEl.style.fontWeight = '600';
			senderEl.textContent = msg.isMe ? 'You' : msg.sender;
			bubble.appendChild(senderEl);

			const textEl = document.createElement('div');
			textEl.style.fontSize = '12px';
			textEl.style.color = '#cccccc';
			textEl.style.lineHeight = '1.4';
			textEl.textContent = msg.text;
			bubble.appendChild(textEl);

			const timeEl = document.createElement('div');
			timeEl.style.fontSize = '10px';
			timeEl.style.color = '#6e6e6e';
			timeEl.style.marginTop = '2px';
			timeEl.style.textAlign = msg.isMe ? 'left' : 'right';
			timeEl.textContent = msg.timestamp;
			bubble.appendChild(timeEl);

			row.appendChild(bubble);
			this.messagesContainer!.appendChild(row);
		});

		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
	}

	private sendMessage(): void {
		if (!this.inputEl) { return; }
		const text = this.inputEl.value.trim();
		if (!text) { return; }

		const now = new Date();
		const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

		this.messages.push({
			id: Date.now().toString(),
			sender: 'Emmanuel',
			text,
			timestamp: time,
			colorIndex: 0,
			isMe: true,
		});

		this.inputEl.value = '';
		this.renderMessages();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
