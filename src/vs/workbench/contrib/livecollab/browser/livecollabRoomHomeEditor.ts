/*---------------------------------------------------------------------------------------------
 *  LiveCollab Room Home editor — welcome states 1/2/3 in working form. Phase D week 3.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { livecollabService } from './livecollabService.js';

export class LiveCollabRoomHomeEditor extends EditorPane {

	static readonly ID = 'workbench.editors.livecollabRoomHomeEditor';

	private _container: HTMLElement | undefined;
	private readonly _listeners = this._register(new DisposableStore());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICommandService private readonly commandService: ICommandService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super(LiveCollabRoomHomeEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this._container = append(parent, $('div.livecollab-room-home'));
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
		this._listeners.add(livecollabService.onMembersChanged(() => this._render()));
		this._listeners.add(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this._render()));
		this._render();
	}

	private _render(): void {
		if (!this._container) { return; }
		clearNode(this._container);

		const roomName = livecollabService.roomName || 'Room';
		const myRole = livecollabService.myRole || 'editor';
		const isHost = myRole === 'owner';
		const hasFolder = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY;

		// ===== Room header =====
		const header = append(this._container, $('div'));
		header.style.cssText = `margin-bottom: 28px;`;
		const liveRow = append(header, $('div'));
		liveRow.style.cssText = `display: flex; align-items: center; gap: 10px;`;
		const dot = append(liveRow, $('div'));
		dot.style.cssText = `width: 8px; height: 8px; border-radius: 50%; background: #007ACC;`;
		const title = append(liveRow, $('div'));
		title.textContent = roomName;
		title.style.cssText = `font-size: 32px; font-weight: 300; color: #FAFCFF;`;
		const roleTag = append(liveRow, $('div'));
		roleTag.textContent = isHost ? 'Host' : (myRole === 'editor' ? 'Editor' : 'Viewer');
		roleTag.style.cssText = `font-size: 11px; padding: 2px 10px; border-radius: 3px; background: #1E1E1E; border: 1px solid var(--vscode-panel-border, #2B2B2B); color: #A0A8B0; margin-left: 4px;`;
		const sub = append(header, $('div'));
		sub.textContent = 'Your room is live.';
		sub.style.cssText = `font-size: 13px; color: #A0A8B0; margin-top: 8px;`;

		// ===== State-aware next step =====
		const action = append(this._container, $('div'));
		action.style.cssText = `border: 1px solid var(--vscode-panel-border, #2B2B2B); border-left: 3px solid #007ACC; border-radius: 6px; background: #181818; padding: 24px; margin-bottom: 24px; max-width: 640px;`;

		if (isHost && !hasFolder) {
			this._renderHostNoFolder(action);
		} else if (isHost && hasFolder) {
			this._renderHostWithFolder(action);
		} else if (!hasFolder) {
			this._renderMemberWaiting(action);
		} else {
			this._renderMemberInSession(action);
		}

		// ===== Members =====
		const membersWrap = append(this._container, $('div'));
		membersWrap.style.cssText = `max-width: 640px;`;
		const membersTitle = append(membersWrap, $('div'));
		membersTitle.textContent = 'Members';
		membersTitle.style.cssText = `font-size: 13px; color: #A0A8B0; margin-bottom: 10px;`;
		const list = append(membersWrap, $('div'));
		list.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;
		const members = livecollabService.lastMembers;
		if (!members.length) {
			const none = append(list, $('div'));
			none.textContent = 'Just you so far \u2014 share an invite code to bring your team in.';
			none.style.cssText = `font-size: 12px; color: #6E6E6E;`;
		}
		for (const m of members) {
			const row = append(list, $('div'));
			row.style.cssText = `display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 4px; background: #181818;`;
			const mdot = append(row, $('div'));
			mdot.style.cssText = `width: 6px; height: 6px; border-radius: 50%; background: #007ACC;`;
			const mname = append(row, $('div'));
			mname.textContent = (m as any).name || (m as any).email || 'Member';
			mname.style.cssText = `font-size: 13px; color: #FAFCFF;`;
		}
	}

	private _renderHostNoFolder(action: HTMLElement): void {
		const head = append(action, $('div'));
		head.textContent = 'Start a session';
		head.style.cssText = `font-size: 16px; color: #FAFCFF; margin-bottom: 6px;`;
		const text = append(action, $('div'));
		text.textContent = 'Open a folder to share it with your room. Members will see it live.';
		text.style.cssText = `font-size: 13px; color: #A0A8B0; margin-bottom: 14px;`;
		const open = append(action, $('a'));
		open.textContent = 'Open a folder \u2192';
		open.style.cssText = `font-size: 13px; color: #007ACC; cursor: pointer;`;
		open.onclick = () => this.commandService.executeCommand('workbench.action.files.openFolder');
	}

	private _renderHostWithFolder(action: HTMLElement): void {
		const head = append(action, $('div'));
		head.textContent = 'Session live';
		head.style.cssText = `font-size: 16px; color: #FAFCFF; margin-bottom: 6px;`;
		const text = append(action, $('div'));
		text.textContent = 'Your folder is shared with the room. Members see your files as you work.';
		text.style.cssText = `font-size: 13px; color: #A0A8B0;`;
	}

	private _renderMemberWaiting(action: HTMLElement): void {
		const head = append(action, $('div'));
		head.textContent = 'Waiting for a session';
		head.style.cssText = `font-size: 16px; color: #FAFCFF; margin-bottom: 6px;`;
		const text = append(action, $('div'));
		text.textContent = 'When the host shares a folder, it appears here automatically. Have the project on your computer? Open your local folder to work on your own copy.';
		text.style.cssText = `font-size: 13px; color: #A0A8B0; margin-bottom: 14px;`;
		const open = append(action, $('a'));
		open.textContent = 'Open your local folder \u2192';
		open.style.cssText = `font-size: 13px; color: #007ACC; cursor: pointer;`;
		open.onclick = () => this.commandService.executeCommand('workbench.action.files.openFolder');
	}

	private _renderMemberInSession(action: HTMLElement): void {
		const head = append(action, $('div'));
		head.textContent = 'You\u2019re in the session';
		head.style.cssText = `font-size: 16px; color: #FAFCFF; margin-bottom: 6px;`;
		const text = append(action, $('div'));
		text.textContent = 'Files are live. Your edits sync with the room.';
		text.style.cssText = `font-size: 13px; color: #A0A8B0;`;
	}

	layout(_dimension: Dimension): void { }
}
