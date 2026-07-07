/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IStatusbarService, StatusbarAlignment, IStatusbarEntry, IStatusbarEntryAccessor } from '../../../services/statusbar/browser/statusbar.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { livecollabService } from './livecollabService.js';

export class LiveCollabStatusBarContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.livecollabStatusBar';

	private statusBarEntry: IStatusbarEntryAccessor | undefined;
	private roomEntry: IStatusbarEntryAccessor | undefined;
	private pulseInterval: ReturnType<typeof setInterval> | undefined;
	private pulseState = true;

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
	) {
		super();
		// Self-wire: update status bar whenever members change
		this._register(livecollabService.onMembersChanged((members) => {
			this.updateSession(members.length, livecollabService.roomName, livecollabService.roomId);
		}));

	}

	updateSession(memberCount: number, roomName?: string, _roomId?: string): void {
		if (memberCount > 0) {
			if (!this.statusBarEntry) {
				const entry: IStatusbarEntry = {
					name: localize('livecollabStatus', 'LiveCollab'),
					text: '$(circle-filled) ' + memberCount,
					tooltip: 'LiveCollab — ' + memberCount + ' member' + (memberCount === 1 ? '' : 's') + ' in session',
					ariaLabel: 'LiveCollab session active',
					command: undefined,
					color: '#2EA043',
				};
				this.statusBarEntry = this._register(
					this.statusbarService.addEntry(entry, 'livecollab.status', StatusbarAlignment.RIGHT, 1000)
				);
			} else {
				this.statusBarEntry.update({
					name: localize('livecollabStatus', 'LiveCollab'),
					text: '$(circle-filled) ' + memberCount,
					tooltip: 'LiveCollab — ' + memberCount + ' member' + (memberCount === 1 ? '' : 's') + ' in session',
					ariaLabel: 'LiveCollab session active',
					command: undefined,
					color: '#2EA043',
				});
			}

			// Left side: room name · short ID (no labels, clean)
			if (roomName) { // only show when room name is available
				const roomText = roomName || '';
				if (!this.roomEntry) {
					this.roomEntry = this._register(
						this.statusbarService.addEntry({
							name: 'LiveCollab Room',
							text: roomText,
							tooltip: roomName || '',
							ariaLabel: 'LiveCollab: ' + roomText,
							command: undefined,
						}, 'livecollab.room', StatusbarAlignment.LEFT, 999)
					);
				} else {
					this.roomEntry.update({
						name: 'LiveCollab Room',
						text: roomText,
						tooltip: roomName || '',
						ariaLabel: 'LiveCollab: ' + roomText,
						command: undefined,
					});
				}
			}
			if (!this.pulseInterval) {
				this.pulseInterval = setInterval(() => {
					if (!this.statusBarEntry) { return; }
					this.pulseState = !this.pulseState;
					this.statusBarEntry.update({
						name: localize('livecollabStatus', 'LiveCollab'),
						text: '$(circle-filled) ' + memberCount,
						tooltip: 'LiveCollab — ' + memberCount + ' member' + (memberCount === 1 ? '' : 's') + ' in session',
						ariaLabel: 'LiveCollab session active',
						command: undefined,
						color: this.pulseState ? '#2EA043' : '#1a6e2e',
					});
				}, 1000);
			}
		} else {
			if (this.pulseInterval) {
				clearInterval(this.pulseInterval);
				this.pulseInterval = undefined;
			}
			if (this.statusBarEntry) {
				this.statusBarEntry.dispose();
				this.statusBarEntry = undefined;
			}
		}
	}
}
