/*---------------------------------------------------------------------------------------------
 *  LiveCollab Overlay — the application layer that sits ABOVE the workbench.
 *  App pages (sign-in, tiers, dashboard) render here as full-window surfaces.
 *  The workbench boots behind it, made inert, never seen until a room dissolves the overlay.
 *  Council verdict: full-window app surfaces, not editor tabs. Per-window, page-router, focus-sealed.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';

export type OverlayPageId = 'signin' | 'tiers' | 'dashboard';

export interface IOverlayPage {
	readonly id: OverlayPageId;
	render(container: HTMLElement, nav: IOverlayNav): void;
	dispose?(): void;
}

export interface IOverlayNav {
	go(pageId: OverlayPageId): void;
	back(): void;
	forward(): void;
	canBack(): boolean;
	canForward(): boolean;
	dismiss(): void; // dissolve the overlay → reveal the workspace (room entry)
}

export class LiveCollabOverlay extends Disposable implements IOverlayNav {

	private readonly _root: HTMLElement;
	private readonly _pageHost: HTMLElement;
	private readonly _backBtn: HTMLElement;
	private readonly _fwdBtn: HTMLElement;

	private readonly _pages = new Map<OverlayPageId, IOverlayPage>();
	private _history: OverlayPageId[] = [];
	private _cursor = -1;
	private _activePage: IOverlayPage | undefined;

	private readonly _onDidDismiss = this._register(new Emitter<void>());
	readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

	constructor(
		private readonly parent: HTMLElement,         // workbench's this.parent
		private readonly workbenchContainer: HTMLElement, // mainContainer — inerted while up
	) {
		super();

		// Full-window opaque canvas, above the workbench.
		this._root = append(this.parent, $('div.livecollab-overlay'));
		this._root.style.cssText = `
			position: fixed;
			inset: 0;
			z-index: 1000;
			background: #181818;
			display: flex;
			flex-direction: column;
			font-family: var(--vscode-font-family, system-ui);
			color: #FAFCFF;
		`;

		// Nav arrows — top-LEFT, browser-style (back then forward). First page: no back.
		const navBar = append(this._root, $('div.livecollab-overlay-nav'));
		navBar.style.cssText = `display: flex; gap: 8px; padding: 14px 18px; height: 48px; align-items: center;`;
		this._backBtn = append(navBar, $('div'));
		this._backBtn.textContent = '\u2190';
		this._fwdBtn = append(navBar, $('div'));
		this._fwdBtn.textContent = '\u2192';
		for (const b of [this._backBtn, this._fwdBtn]) {
			b.style.cssText = `width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 6px; cursor: pointer; color: #9D9D9D; font-size: 16px; user-select: none;`;
		}
		this._backBtn.onclick = () => this.back();
		this._fwdBtn.onclick = () => this.forward();

		// Page host fills the rest.
		this._pageHost = append(this._root, $('div.livecollab-overlay-page'));
		this._pageHost.style.cssText = `flex: 1; display: flex; align-items: center; justify-content: center; overflow-y: auto;`;

		this._seal(true);

		// CSS flash-kill: inject before workbench paints so it never shows through.
		const style = document.createElement('style');
		style.id = 'livecollab-flash-kill';
		style.textContent = '.monaco-workbench { opacity: 0 !important; transition: opacity 220ms ease; }';
		document.head.appendChild(style);
		this._flashKillStyle = style;
	}

	private _flashKillStyle: HTMLStyleElement | undefined;

	registerPage(page: IOverlayPage): void {
		this._pages.set(page.id, page);
	}

	private _seal(up: boolean): void {
		// Focus + keyboard seal: workbench cannot be reached behind the overlay.
		if (up) {
			this.workbenchContainer.setAttribute('inert', '');
			this.workbenchContainer.setAttribute('aria-hidden', 'true');
			this._root.style.display = 'flex';
		} else {
			this.workbenchContainer.removeAttribute('inert');
			this.workbenchContainer.removeAttribute('aria-hidden');
			this._root.style.display = 'none';
		}
	}

	private _renderActive(): void {
		const id = this._history[this._cursor];
		const page = id && this._pages.get(id);
		if (!page) { return; }
		if (this._activePage?.dispose) { this._activePage.dispose(); }
		clearNode(this._pageHost);
		this._activePage = page;
		page.render(this._pageHost, this);
		this._backBtn.style.opacity = this.canBack() ? '1' : '0.25';
		this._backBtn.style.pointerEvents = this.canBack() ? 'auto' : 'none';
		this._fwdBtn.style.opacity = this.canForward() ? '1' : '0.25';
		this._fwdBtn.style.pointerEvents = this.canForward() ? 'auto' : 'none';
	}

	// ---- IOverlayNav ----
	go(pageId: OverlayPageId): void {
		// Truncate any forward history, push new page.
		this._history = this._history.slice(0, this._cursor + 1);
		this._history.push(pageId);
		this._cursor = this._history.length - 1;
		if (this._root.style.display === 'none') { this._seal(true); }
		this._renderActive();
	}

	back(): void {
		if (!this.canBack()) { return; }
		this._cursor--;
		this._renderActive();
	}

	forward(): void {
		if (!this.canForward()) { return; }
		this._cursor++;
		this._renderActive();
	}

	canBack(): boolean { return this._cursor > 0; }
	canForward(): boolean { return this._cursor < this._history.length - 1; }

	dismiss(): void {
		// Reveal the workbench (remove flash-kill) then dissolve the overlay.
		if (this._flashKillStyle) {
			this._flashKillStyle.textContent = '.monaco-workbench { opacity: 1 !important; transition: opacity 220ms ease; }';
		}
		this._root.style.transition = 'opacity 220ms ease';
		this._root.style.opacity = '0';
		setTimeout(() => {
			this._seal(false);
			this._root.style.opacity = '1';
			this._flashKillStyle?.remove();
			this._flashKillStyle = undefined;
			this._onDidDismiss.fire();
		}, 220);
	}

	reopen(pageId: OverlayPageId): void {
		// Coming back from the workspace to the dashboard — re-hide the workbench.
		if (!this._flashKillStyle) {
			const style = document.createElement('style');
			style.id = 'livecollab-flash-kill';
			style.textContent = '.monaco-workbench { opacity: 0 !important; }';
			document.head.appendChild(style);
			this._flashKillStyle = style;
		}
		this._history = [pageId];
		this._cursor = 0;
		this._seal(true);
		this._renderActive();
	}

	override dispose(): void {
		if (this._activePage?.dispose) { this._activePage.dispose(); }
		this._root.remove();
		this._seal(false);
		super.dispose();
	}
}
