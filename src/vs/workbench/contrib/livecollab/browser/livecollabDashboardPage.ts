/*---------------------------------------------------------------------------------------------
 *  LiveCollab Dashboard Page — overlay surface (NOT an editor). Minimal working version.
 *  Rooms list + create + open. The rich design pass builds on this page later.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { IOverlayPage, IOverlayNav, OverlayPageId } from './livecollabOverlay.js';
import { livecollabService } from './livecollabService.js';

export class LiveCollabDashboardPage implements IOverlayPage {

	readonly id: OverlayPageId = 'dashboard';

	constructor(
		private readonly _onEnterRoom: () => void, // dissolve overlay → workspace
	) { }

	render(container: HTMLElement, _nav: IOverlayNav): void {
		const page = append(container, $('div'));
		page.style.cssText = `width: 100%; max-width: 720px; padding: 48px 32px; align-self: flex-start; margin: 0 auto;`;

		// Header
		const header = append(page, $('div'));
		header.style.cssText = `display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px;`;
		const title = append(header, $('div'));
		title.textContent = 'Your Rooms';
		title.style.cssText = `font-size: 28px; font-weight: 300; color: #FAFCFF;`;
		const createBtn = append(header, $('div'));
		createBtn.textContent = '+ Create Room';
		createBtn.style.cssText = `font-size: 13px; font-weight: 600; color: #FAFCFF; background: #0E639C; padding: 8px 16px; border-radius: 8px; cursor: pointer;`;
		createBtn.onmouseenter = () => createBtn.style.background = '#1177BB';
		createBtn.onmouseleave = () => createBtn.style.background = '#0E639C';

		const sub = append(page, $('div'));
		sub.textContent = 'A room is your team\\u2019s permanent home. It stays even when everyone leaves.';
		sub.style.cssText = `font-size: 13px; color: #9D9D9D; margin-bottom: 28px;`;

		const list = append(page, $('div'));
		list.style.cssText = `display: flex; flex-direction: column; gap: 10px;`;

		const loadRooms = async () => {
			clearNode(list);
			const loading = append(list, $('div'));
			loading.textContent = 'Loading\\u2026';
			loading.style.cssText = `font-size: 13px; color: #6E6E6E;`;
			let rooms: any[] = [];
			try { rooms = await livecollabService.listMyRooms(); } catch { /* ignore */ }
			clearNode(list);
			if (!rooms.length) {
				const empty = append(list, $('div'));
				empty.textContent = 'No rooms yet. Create one to get started.';
				empty.style.cssText = `font-size: 13px; color: #6E6E6E; padding: 24px 0;`;
				return;
			}
			for (const room of rooms) {
				const card = append(list, $('div'));
				card.style.cssText = `
					display: flex; align-items: center; justify-content: space-between;
					background: #1E1E1E; border: 1px solid #2B2B2B; border-left: 3px solid #007ACC;
					border-radius: 8px; padding: 16px 18px; transition: background 120ms ease;
				`;
				card.onmouseenter = () => card.style.background = '#232323';
				card.onmouseleave = () => card.style.background = '#1E1E1E';

				const left = append(card, $('div'));
				const name = append(left, $('div'));
				name.textContent = room.name || 'Untitled Room';
				name.style.cssText = `font-size: 15px; color: #FAFCFF; margin-bottom: 3px;`;
				const role = append(left, $('div'));
				role.textContent = room.accessRole === 'owner' ? 'Host' : (room.accessRole === 'editor' ? 'Editor' : 'Viewer');
				role.style.cssText = `font-size: 11px; color: #9D9D9D;`;

				const open = append(card, $('div'));
				open.textContent = 'Open \\u2192';
				open.style.cssText = `font-size: 13px; color: #007ACC; cursor: pointer; font-weight: 500;`;
				open.onclick = async () => {
					livecollabService.setRoomContext(room.name, room.accessRole);
					await livecollabService.joinExistingRoom(room.id);
					this._onEnterRoom();
				};
			}
		};

		createBtn.onclick = async () => {
			const name = `Room ${new Date().toLocaleDateString()}`;
			try { await livecollabService.createRoomNamed(name); } catch { /* ignore */ }
			loadRooms();
		};

		loadRooms();
	}
}
