/*---------------------------------------------------------------------------------------------
 *  LiveCollab Sign-In Page — first surface in the overlay. Black canvas, centered identity.
 *  Builder's spec: logo crossing center, bold name, secondary text, blue-on-black Login,
 *  lighter-gray Sign Up, bottom line "Live collaboration features require you to be logged in."
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { IOverlayPage, IOverlayNav, OverlayPageId } from './livecollabOverlay.js';

export class LiveCollabSignInPage implements IOverlayPage {

	readonly id: OverlayPageId = 'signin';

	constructor(
		private readonly onLogin: () => void,
		private readonly onSignUp: () => void,
	) { }

	render(container: HTMLElement, _nav: IOverlayNav): void {
		const center = append(container, $('div'));
		center.style.cssText = `
			display: flex; flex-direction: column; align-items: center;
			max-width: 360px; width: 100%; padding: 0 24px;
			transform: translateY(-6%);
		`;

		// Logo — crosses the center line, sits slightly above middle.
		const logo = append(center, $('div'));
		logo.style.cssText = `width: 64px; height: 64px; margin-bottom: 22px; display: flex; align-items: center; justify-content: center;`;
		// Two-pin collaboration mark, hints of blue.
		logo.innerHTML = `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
			<circle cx="24" cy="26" r="9" fill="#007ACC"/>
			<circle cx="40" cy="38" r="9" fill="#FAFCFF" fill-opacity="0.92"/>
		</svg>`;

		// Name — bold.
		const name = append(center, $('div'));
		name.textContent = 'LiveCollab';
		name.style.cssText = `font-size: 30px; font-weight: 700; letter-spacing: -0.5px; color: #FAFCFF; margin-bottom: 8px;`;

		// Secondary text.
		const sub = append(center, $('div'));
		sub.textContent = 'The best way to code together.';
		sub.style.cssText = `font-size: 14px; color: #9D9D9D; margin-bottom: 30px;`;

		// Login button — light blue rounded rectangle, blue text on black feel.
		const login = append(center, $('div'));
		login.textContent = 'Log In';
		login.style.cssText = `
			width: 100%; height: 40px; display: flex; align-items: center; justify-content: center;
			background: #0E639C; color: #FAFCFF; border-radius: 8px; cursor: pointer;
			font-size: 14px; font-weight: 600; margin-bottom: 12px;
			transition: background 120ms ease;
		`;
		login.onmouseenter = () => login.style.background = '#1177BB';
		login.onmouseleave = () => login.style.background = '#0E639C';
		login.onclick = () => this.onLogin();

		// Sign Up button — gray, lighter-gray text.
		const signup = append(center, $('div'));
		signup.textContent = 'Sign Up';
		signup.style.cssText = `
			width: 100%; height: 40px; display: flex; align-items: center; justify-content: center;
			background: #2A2D2E; color: #C8C8C8; border-radius: 8px; cursor: pointer;
			font-size: 14px; font-weight: 500;
			transition: background 120ms ease;
		`;
		signup.onmouseenter = () => signup.style.background = '#333739';
		signup.onmouseleave = () => signup.style.background = '#2A2D2E';
		signup.onclick = () => this.onSignUp();

		// Bottom line.
		const foot = append(container, $('div'));
		foot.textContent = 'Live collaboration features require you to be logged in.';
		foot.style.cssText = `
			position: absolute; bottom: 28px; left: 0; right: 0;
			text-align: center; font-size: 12px; color: #6E6E6E;
		`;
	}
}
