/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';

/**
 * LiveCollab Dashboard Overlay
 *
 * A full-screen overlay that mounts INSIDE the running workbench.
 * The workbench loads once and never reloads; this overlay is shown when the
 * user is picking a room (dashboard) and hidden when they are inside a room.
 *
 * Stage 1: shell only — mount + show/hide plumbing, no dashboard content yet.
 */
export class LiveCollabDashboardOverlay extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.livecollabDashboardOverlay';

	private _overlay: HTMLElement | undefined;

	constructor() {
		super();
		this._mount();
	}

	private _mount(): void {
		// Avoid double-mount
		if (document.getElementById('livecollab-dashboard-overlay')) { return; }

		const overlay = document.createElement('div');
		overlay.id = 'livecollab-dashboard-overlay';
		overlay.style.cssText = [
			'position:fixed',
			'inset:0',
			'z-index:1000',
			'background:#1e1e1e',
			'display:none',
			'overflow:auto',
		].join(';') + ';';

		// Stage 1 placeholder content — confirms the overlay mounts and covers the workbench
		const placeholder = document.createElement('div');
		placeholder.style.cssText = 'color:#ccc;font-family:sans-serif;padding:40px;font-size:16px;';
		placeholder.textContent = 'LiveCollab Dashboard Overlay — Stage 1 shell (mounted, hidden by default)';
		overlay.appendChild(placeholder);

		document.body.appendChild(overlay);
		this._overlay = overlay;

		// Temporary manual test hooks (removed in later stages)
		(window as any)._lcShowOverlay = () => this.show();
		(window as any)._lcHideOverlay = () => this.hide();

		console.log('[LiveCollab] dashboard overlay mounted (Stage 1 shell)');
	}

	show(): void {
		if (this._overlay) { this._overlay.style.display = 'block'; }
	}

	hide(): void {
		if (this._overlay) { this._overlay.style.display = 'none'; }
	}
}
