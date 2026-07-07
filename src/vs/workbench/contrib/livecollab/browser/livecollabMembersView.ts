/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { livecollabService, ILiveCollabMember } from './livecollabService.js';

const USER_COLORS = [
	'#93c5fd', '#60a5fa', '#38bdf8', '#3b82f6', '#2563eb', '#818cf8',
];

function colorForIndex(index: number): string {
	return USER_COLORS[index % USER_COLORS.length];
}

function initialsFromName(name: string): string {
	return name.trim().charAt(0).toUpperCase();
}

export class LiveCollabMembersView extends ViewPane {

	static readonly ID = 'workbench.view.livecollab.members';
	static readonly TITLE = localize('livecollabMembers', "Members");

	private membersContainer: HTMLElement | undefined;
	private roomIdText: HTMLElement | undefined;
	private members: ILiveCollabMember[] = [];

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
		@IClipboardService private readonly clipboardService: IClipboardService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		this._register(livecollabService.onConnected(() => {
			if (livecollabService.lastMembers.length > 0) {
				this.members = livecollabService.lastMembers;
				this.updateMembersList();
			}
		}));

		this._register(livecollabService.onMembersChanged((members) => {
			this.members = members;
			// Load existing members immediately
		if (livecollabService.lastMembers.length > 0) {
			this.members = livecollabService.lastMembers;
		}
		this.updateMembersList();
			if (this.roomIdText && livecollabService.roomId) {
				this.roomIdText.textContent = livecollabService.roomId.slice(0, 8);
			}
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.style.display = 'flex';
		container.style.flexDirection = 'column';
		container.style.overflow = 'hidden';
		container.style.height = '100%';

		// Room ID section
		const roomIdSection = document.createElement('div');
		roomIdSection.style.padding = '8px 12px';
		roomIdSection.style.borderBottom = '1px solid #2b2b2b';

		const roomIdLabel = document.createElement('div');
		roomIdLabel.style.fontSize = '11px';
		roomIdLabel.style.color = '#858585';
		roomIdLabel.style.marginBottom = '6px';
		roomIdLabel.style.textTransform = 'uppercase';
		roomIdLabel.style.letterSpacing = '0.08em';
		roomIdLabel.textContent = 'Room ID';
		roomIdSection.appendChild(roomIdLabel);

		const roomIdRow = document.createElement('div');
		roomIdRow.style.display = 'flex';
		roomIdRow.style.alignItems = 'center';
		roomIdRow.style.gap = '8px';

		this.roomIdText = document.createElement('span');
		this.roomIdText.style.fontSize = '11px';
		this.roomIdText.style.color = '#cccccc';
		this.roomIdText.style.fontFamily = 'monospace';
		this.roomIdText.style.flex = '1';
		this.roomIdText.style.overflow = 'hidden';
		this.roomIdText.style.textOverflow = 'ellipsis';
		this.roomIdText.style.whiteSpace = 'nowrap';
		this.roomIdText.textContent = livecollabService.roomId ? livecollabService.roomId.slice(0, 8) : '—';
		roomIdRow.appendChild(this.roomIdText);

// Copy button removed
		
		roomIdSection.appendChild(roomIdRow);
		container.appendChild(roomIdSection);

		// Invite section
		const inviteSection = document.createElement('div');
			inviteSection.style.padding = '8px 12px';
			inviteSection.style.borderBottom = '1px solid #2b2b2b';

			const inviteLabel = document.createElement('div');
			inviteLabel.style.cssText = 'font-size:11px;color:#858585;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.08em;';
			inviteLabel.textContent = 'Invite';
			inviteSection.appendChild(inviteLabel);

			// Only owner can create invite codes
			

			const inviteBody = document.createElement('div');
			inviteBody.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

			const createInviteBtn = document.createElement('button') as HTMLButtonElement;
			createInviteBtn.style.cssText = 'background:#1e1e1e;border:1px solid #2b2b2b;color:#cccccc;border-radius:4px;padding:4px 8px;font-size:12px;cursor:pointer;text-align:left;width:100%;';
			createInviteBtn.textContent = 'Create invite code';
			createInviteBtn.onmouseenter = () => { createInviteBtn.style.borderColor = '#007ACC'; };
			createInviteBtn.onmouseleave = () => { createInviteBtn.style.borderColor = '#2b2b2b'; };

			// Code row — hidden until code is created
			const codeRow = document.createElement('div');
			codeRow.style.cssText = 'display:none;align-items:center;gap:8px;background:#1e1e1e;border:1px solid #2b2b2b;border-radius:4px;padding:4px 8px;';
			const codeText = document.createElement('span');
			codeText.style.cssText = 'font-size:11px;color:#cccccc;font-family:monospace;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			const copyBtn = document.createElement('button') as HTMLButtonElement;
			copyBtn.textContent = 'Copy';
			copyBtn.style.cssText = 'background:transparent;border:none;color:#858585;cursor:pointer;font-size:11px;padding:4px;flex-shrink:0;';
			copyBtn.onclick = () => { this.clipboardService.writeText(codeText.textContent || ''); copyBtn.textContent = 'Copied'; setTimeout(() => copyBtn.textContent = 'Copy', 2000); };
			codeRow.appendChild(codeText);
			codeRow.appendChild(copyBtn);

			createInviteBtn.onclick = async () => {
				createInviteBtn.textContent = 'Creating...';
				createInviteBtn.disabled = true;
				const result = await livecollabService.createInviteCode();
				if (result.success && result.code) {
					codeText.textContent = result.code;
					codeRow.style.display = 'flex';
					createInviteBtn.textContent = 'Create invite code';
				} else {
					createInviteBtn.textContent = result.error || 'Failed';
					setTimeout(() => createInviteBtn.textContent = 'Create invite code', 2000);
				}
				createInviteBtn.disabled = false;
			};

			inviteBody.appendChild(createInviteBtn);
			inviteBody.appendChild(codeRow);
			inviteSection.appendChild(inviteBody);
			container.appendChild(inviteSection);

		// Members list
		this.membersContainer = document.createElement('div');
		this.membersContainer.style.flex = '1';
		this.membersContainer.style.overflowY = 'auto';
		this.membersContainer.style.padding = '4px 0';
		container.appendChild(this.membersContainer);

		// Populate immediately from cached members on render
		if (livecollabService.lastMembers.length > 0) {
			this.members = livecollabService.lastMembers;
		}
		// Re-request fresh members list from server
		if (livecollabService.isConnected && livecollabService.roomId) {
			livecollabService.fetchMembers(livecollabService.roomId);
		}
		this.updateMembersList();
	}

	private updateMembersList(): void {
		if (!this.membersContainer) { return; }
		while (this.membersContainer.firstChild) { this.membersContainer.removeChild(this.membersContainer.firstChild); }
		if (this.members.length === 0) {
			const empty = document.createElement('div');
			empty.style.cssText = 'padding:12px;font-size:12px;color:#858585;text-align:center;';
			empty.textContent = 'Open a folder to start collaborating';
			this.membersContainer.appendChild(empty);
			return;
		}

		if (this.members.length === 0) {
			const empty = document.createElement('div');
			empty.style.padding = '12px 16px';
			empty.style.color = '#6e6e6e';
			empty.style.fontSize = '12px';
			empty.style.textAlign = 'center';
			empty.textContent = 'No active session';
			this.membersContainer.appendChild(empty);
			return;
		}

					const myUserId = livecollabService.myUserId;
			const myRole = this.members.find(m => m.userId === myUserId)?.role;
			const iAmOwner = myRole === 'owner';

			this.members.forEach((member, index) => {
				const isMe = member.userId === myUserId;
				const row = document.createElement('div');
				row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 8px;border-radius:4px;cursor:default;';

				const left = document.createElement('div');
				left.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;flex:1;';

				const color = colorForIndex(index);
				const avatar = document.createElement('div');
				avatar.style.cssText = `width:22px;height:22px;border-radius:50%;background:${color}33;border:1px solid ${color}66;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:${color};flex-shrink:0;`;
				const displayName = (member as any).displayName || member.name || member.email || 'User';
				avatar.textContent = initialsFromName(displayName);
				left.appendChild(avatar);

				const info = document.createElement('div');
				info.style.minWidth = '0';

				const nameEl = document.createElement('div');
				nameEl.style.cssText = 'font-size:12px;color:#cccccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
				nameEl.textContent = displayName + (isMe ? ' (you)' : '');
				info.appendChild(nameEl);

				const roleEl = document.createElement('div');
				roleEl.style.cssText = 'font-size:11px;color:#858585;';
				const roleLabel = member.role.charAt(0).toUpperCase() + member.role.slice(1);
				roleEl.textContent = roleLabel;
				info.appendChild(roleEl);

				left.appendChild(info);
				row.appendChild(left);

				const actions = document.createElement('div');
				actions.style.cssText = 'display:none;gap:4px;flex-shrink:0;align-items:center;';

				const makeBtn = (label: string, btnColor: string = '#858585', hoverColor: string = '#cccccc') => {
					const btn = document.createElement('button');
					btn.textContent = label;
					btn.style.cssText = `background:transparent;border:1px solid #2b2b2b;color:${btnColor};border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;`;
					btn.onmouseenter = () => { btn.style.borderColor = '#007ACC'; btn.style.color = hoverColor; };
					btn.onmouseleave = () => { btn.style.borderColor = '#2b2b2b'; btn.style.color = btnColor; };
					return btn;
				};

				if (isMe && member.role !== 'owner') {
					const leaveBtn = document.createElement('button');
					leaveBtn.title = 'Leave room';
					leaveBtn.style.cssText = 'background:transparent;border:none;cursor:pointer;color:#858585;padding:2px 4px;display:flex;align-items:center;border-radius:3px;';
					const ns = 'http://www.w3.org/2000/svg';
					const svg = document.createElementNS(ns,'svg');
					svg.setAttribute('viewBox','0 0 16 16'); svg.setAttribute('width','14'); svg.setAttribute('height','14');
					svg.setAttribute('fill','none'); svg.setAttribute('stroke','currentColor'); svg.setAttribute('stroke-width','1.3');
					const door = document.createElementNS(ns,'path');
					door.setAttribute('d','M10 2H3a1 1 0 00-1 1v10a1 1 0 001 1h7');
					const arrow = document.createElementNS(ns,'path');
					arrow.setAttribute('d','M7 8h7m-3-3l3 3-3 3');
					svg.appendChild(door); svg.appendChild(arrow);
					leaveBtn.appendChild(svg);
					leaveBtn.onmouseenter = () => { leaveBtn.style.color = '#F14C4C'; };
					leaveBtn.onmouseleave = () => { leaveBtn.style.color = '#858585'; };
					leaveBtn.onclick = () => { livecollabService.leaveRoom(); };
					actions.appendChild(leaveBtn);
				} else if (!isMe && iAmOwner && member.role !== 'owner') {
					const roleToggle = makeBtn(member.role === 'viewer' ? 'Editor' : 'Viewer');
					roleToggle.onclick = () => { livecollabService.setMemberRole(member.userId, member.role === 'viewer' ? 'editor' : 'viewer'); };
					const kickBtn = makeBtn('Kick', '#c75050', '#F14C4C');
					kickBtn.onclick = () => { livecollabService.kickMember(member.userId); };
					const ownerBtn = makeBtn('Owner');
					ownerBtn.onclick = () => { livecollabService.transferOwnership(member.userId); };
					actions.appendChild(roleToggle);
					actions.appendChild(kickBtn);
					actions.appendChild(ownerBtn);
				}

				if (actions.children.length > 0) {
					row.onmouseenter = () => { row.style.background = '#2a2d2e'; actions.style.display = 'flex'; };
					row.onmouseleave = () => { row.style.background = 'transparent'; actions.style.display = 'none'; };
					row.appendChild(actions);
				} else {
					row.onmouseenter = () => { row.style.background = '#2a2d2e'; };
					row.onmouseleave = () => { row.style.background = 'transparent'; };
				}

				this.membersContainer!.appendChild(row);
			});
		}

		protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
