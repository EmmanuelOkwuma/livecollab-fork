/*---------------------------------------------------------------------------------------------
 *  LiveCollab Dashboard — the front door. Rooms before IDE. (Phase D week 1)
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { livecollabService } from './livecollabService.js';

export class LiveCollabDashboardEditor extends EditorPane {

	static readonly ID = 'workbench.editors.livecollabDashboardEditor';

	private _container: HTMLElement | undefined;
	private _roomsGrid: HTMLElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
	) {
		super(LiveCollabDashboardEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this._container = append(parent, $('div.livecollab-dashboard'));
		this._container.style.cssText = `
			display: flex;
			flex-direction: column;
			height: 100%;
			background: var(--vscode-editor-background);
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			overflow-y: auto;
			padding: 48px 64px;
		`;
		this._render();
	}

	private _render(): void {
		if (!this._container) { return; }
		clearNode(this._container);

		// ===== Header =====
		const header = append(this._container, $('div.lc-dash-header'));
		header.style.cssText = `display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px;`;

		const titleWrap = append(header, $('div'));
		const title = append(titleWrap, $('div'));
		title.textContent = 'Your Rooms';
		title.style.cssText = `font-size: 32px; font-weight: 300; color: #FAFCFF;`;
		const subtitle = append(titleWrap, $('div'));
		subtitle.textContent = 'A room is your team\u2019s permanent home \u2014 it stays even when everyone leaves.';
		subtitle.style.cssText = `font-size: 13px; color: #A0A8B0; margin-top: 6px;`;

		const actions = append(header, $('div'));
		actions.style.cssText = `display: flex; gap: 12px;`;

		const joinBtn = append(actions, $('button.lc-dash-join'));
		joinBtn.textContent = 'Join with Code';
		joinBtn.style.cssText = this._buttonCss(false);
		joinBtn.onclick = () => this._showJoinFlow();

		const createBtn = append(actions, $('button.lc-dash-create'));
		createBtn.textContent = 'Create Room';
		createBtn.style.cssText = this._buttonCss(true);
		createBtn.onclick = () => this._showCreateFlow();

		// ===== Flow slot (create/join inline forms render here in stage 2) =====
		const flowSlot = append(this._container, $('div.lc-dash-flow'));
		flowSlot.style.cssText = `margin-bottom: 24px;`;

		// ===== Rooms grid =====
		this._roomsGrid = append(this._container, $('div.lc-dash-grid'));
		this._roomsGrid.style.cssText = `
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
			gap: 16px;
		`;

		this._loadRooms();
	}

	private _buttonCss(primary: boolean): string {
		return `
			padding: 8px 18px;
			border-radius: 4px;
			border: 1px solid ${primary ? '#007ACC' : 'var(--vscode-panel-border, #2B2B2B)'};
			background: ${primary ? '#007ACC' : 'transparent'};
			color: ${primary ? '#FFFFFF' : '#FAFCFF'};
			font-size: 13px;
			cursor: pointer;
			font-family: inherit;
		`;
	}

	private async _loadRooms(): Promise<void> {
		if (!this._roomsGrid) { return; }
		clearNode(this._roomsGrid);

		const loading = append(this._roomsGrid, $('div'));
		loading.textContent = 'Loading your rooms\u2026';
		loading.style.cssText = `color: #A0A8B0; font-size: 13px;`;

		const rooms = await livecollabService.listMyRooms();
		if (!this._roomsGrid) { return; }
		clearNode(this._roomsGrid);

		if (!rooms.length) {
			const empty = append(this._roomsGrid, $('div.lc-dash-empty'));
			empty.style.cssText = `
				grid-column: 1 / -1;
				border: 1px dashed var(--vscode-panel-border, #2B2B2B);
				border-radius: 8px;
				padding: 48px;
				text-align: center;
				color: #A0A8B0;
			`;
			const emptyTitle = append(empty, $('div'));
			emptyTitle.textContent = 'No rooms yet';
			emptyTitle.style.cssText = `font-size: 18px; color: #FAFCFF; margin-bottom: 8px;`;
			const emptyText = append(empty, $('div'));
			emptyText.textContent = 'Create your first room and invite your team.';
			emptyText.style.cssText = `font-size: 13px;`;
			return;
		}

		for (const room of rooms) {
			this._renderRoomCard(room);
		}
	}

	private _renderRoomCard(room: any): void {
		if (!this._roomsGrid) { return; }
		const isTombstone = !!room.deletedAt;
		const isOwner = room.accessRole === 'owner';

		const card = append(this._roomsGrid, $('div.lc-dash-card'));
		card.style.cssText = `
			border: 1px solid var(--vscode-panel-border, #2B2B2B);
			border-radius: 8px;
			padding: 20px;
			background: #181818;
			display: flex;
			flex-direction: column;
			gap: 12px;
			opacity: ${isTombstone ? '0.6' : '1'};
		`;

		const topRow = append(card, $('div'));
		topRow.style.cssText = `display: flex; align-items: center; justify-content: space-between;`;
		const name = append(topRow, $('div'));
		name.textContent = room.name || 'Untitled Room';
		name.style.cssText = `font-size: 16px; color: #FAFCFF; font-weight: 500;`;
		const roleTag = append(topRow, $('div'));
		roleTag.textContent = isOwner ? 'Host' : (room.accessRole === 'editor' ? 'Editor' : 'Viewer');
		roleTag.style.cssText = `
			font-size: 11px;
			padding: 2px 8px;
			border-radius: 10px;
			background: ${isOwner ? '#007ACC' : 'transparent'};
			border: 1px solid #007ACC;
			color: ${isOwner ? '#FFFFFF' : '#007ACC'};
		`;

		if (isTombstone) {
			const tomb = append(card, $('div'));
			tomb.textContent = 'This room was closed by the host.';
			tomb.style.cssText = `font-size: 12px; color: #A0A8B0;`;
			return;
		}

		const btnRow = append(card, $('div'));
		btnRow.style.cssText = `display: flex; gap: 8px; margin-top: 4px;`;

		const openBtn = append(btnRow, $('button'));
		openBtn.textContent = 'Open';
		openBtn.style.cssText = this._buttonCss(true);
		openBtn.onclick = () => this._openRoom(room);

		if (isOwner) {
			const delBtn = append(btnRow, $('button'));
			delBtn.textContent = 'Delete';
			delBtn.style.cssText = this._buttonCss(false);
			delBtn.onclick = () => this._deleteRoom(room);
		}
	}

	// ===== Stage 2 flows (stubs for now) =====
	private _showCreateFlow(): void { console.log('[LiveCollab] create flow - stage 2'); }
	private _showJoinFlow(): void { console.log('[LiveCollab] join flow - stage 2'); }
	private _openRoom(room: any): void { console.log('[LiveCollab] open room - stage 2:', room.id); }
	private async _deleteRoom(room: any): Promise<void> {
		const ok = await livecollabService.deleteRoom(room.id);
		if (ok) { this._loadRooms(); }
	}

	layout(_dimension: Dimension): void {
		// container is fully fluid; nothing to do
	}
}
