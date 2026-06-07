/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { LiveCollabSignInInput } from './livecollabSignInInput.js';
import { livecollabService } from './livecollabService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';

export class LiveCollabSignInEditor extends EditorPane {

	static readonly ID = 'workbench.editors.livecollabSignInEditor';

	private _container: HTMLElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(LiveCollabSignInEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this._container = append(parent, $('div.livecollab-signin-container'));
		this._container.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: center;
			height: 100%;
			background: #1e1e1e;
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		`;
		this._render();
	}

	private _render(): void {
		if (!this._container) { return; }
		clearNode(this._container);

		const card = append(this._container, $('div.livecollab-signin-card'));
		card.style.cssText = `
			background: #252526;
			border: 1px solid #2b2b2b;
			border-radius: 8px;
			padding: 40px;
			width: 100%;
			max-width: 400px;
		`;

		// Logo area
		const logo = append(card, $('div'));
		logo.style.cssText = 'text-align: center; margin-bottom: 24px;';
		const logoText = append(logo, $('div'));
		logoText.style.cssText = 'font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;';
		logoText.textContent = 'LiveCollab';
		const subtitle = append(logo, $('div'));
		subtitle.style.cssText = 'font-size: 13px; color: #858585; margin-top: 4px;';
		subtitle.textContent = 'Code together, in real time.';

		// Email field
		const emailLabel = append(card, $('div'));
		emailLabel.style.cssText = 'font-size: 11px; color: #858585; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;';
		emailLabel.textContent = 'Email';
		const emailInput = append(card, $('input')) as HTMLInputElement;
		emailInput.type = 'email';
		emailInput.placeholder = 'your@email.com';
		emailInput.style.cssText = `
			width: 100%;
			background: #1e1e1e;
			border: 1px solid #2b2b2b;
			border-radius: 4px;
			padding: 8px 12px;
			color: #cccccc;
			font-size: 13px;
			outline: none;
			margin-bottom: 16px;
			box-sizing: border-box;
			transition: border-color 0.15s;
		`;
		emailInput.onfocus = () => { emailInput.style.borderColor = '#007ACC'; };
		emailInput.onblur = () => { emailInput.style.borderColor = '#2b2b2b'; };

		// Password field
		const passwordLabel = append(card, $('div'));
		passwordLabel.style.cssText = 'font-size: 11px; color: #858585; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;';
		passwordLabel.textContent = 'Password';
		const passwordInput = append(card, $('input')) as HTMLInputElement;
		passwordInput.type = 'password';
		passwordInput.placeholder = 'Your password';
		passwordInput.style.cssText = `
			width: 100%;
			background: #1e1e1e;
			border: 1px solid #2b2b2b;
			border-radius: 4px;
			padding: 8px 12px;
			color: #cccccc;
			font-size: 13px;
			outline: none;
			margin-bottom: 8px;
			box-sizing: border-box;
			transition: border-color 0.15s;
		`;
		passwordInput.onfocus = () => { passwordInput.style.borderColor = '#007ACC'; };
		passwordInput.onblur = () => { passwordInput.style.borderColor = '#2b2b2b'; };

		// Error message
		const errorEl = append(card, $('div'));
		errorEl.style.cssText = 'color: #F14C4C; font-size: 12px; margin-bottom: 16px; min-height: 18px;';

		// Sign In button
		const signInBtn = append(card, $('button'));
		signInBtn.style.cssText = `
			width: 100%;
			background: #007ACC;
			border: none;
			border-radius: 4px;
			padding: 10px;
			color: #ffffff;
			font-size: 13px;
			font-weight: 600;
			cursor: pointer;
			margin-bottom: 20px;
			transition: background 0.15s;
		`;
		signInBtn.textContent = 'Sign In';
		signInBtn.onmouseenter = () => { signInBtn.style.background = '#005fa3'; };
		signInBtn.onmouseleave = () => { signInBtn.style.background = '#007ACC'; };

		// Divider
		const divider = append(card, $('div'));
		divider.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 16px;';
		const line1 = append(divider, $('div'));
		line1.style.cssText = 'flex: 1; height: 1px; background: #2b2b2b;';
		const orText = append(divider, $('div'));
		orText.style.cssText = 'font-size: 11px; color: #555;';
		orText.textContent = 'or continue with';
		const line2 = append(divider, $('div'));
		line2.style.cssText = 'flex: 1; height: 1px; background: #2b2b2b;';

		// Social buttons row
		const socialRow = append(card, $('div'));
		socialRow.style.cssText = 'display: flex; gap: 12px;';

		const googleBtn = append(socialRow, $('button'));
		googleBtn.style.cssText = `
			flex: 1;
			background: transparent;
			border: 1px solid #2b2b2b;
			border-radius: 4px;
			padding: 10px;
			color: #858585;
			font-size: 12px;
			cursor: not-allowed;
			opacity: 0.5;
		`;
		googleBtn.textContent = 'G  Google';
		googleBtn.title = 'Coming soon';

		const appleBtn = append(socialRow, $('button'));
		appleBtn.style.cssText = `
			flex: 1;
			background: transparent;
			border: 1px solid #2b2b2b;
			border-radius: 4px;
			padding: 10px;
			color: #858585;
			font-size: 12px;
			cursor: not-allowed;
			opacity: 0.5;
		`;
		appleBtn.textContent = '  Apple';
		appleBtn.title = 'Coming soon';

		// Sign in handler
		const doSignIn = async () => {
			const email = emailInput.value.trim();
			const password = passwordInput.value;
			if (!email || !password) {
				errorEl.textContent = 'Please enter your email and password.';
				return;
			}
			signInBtn.textContent = 'Signing in...';
			(signInBtn as HTMLButtonElement).disabled = true;
			errorEl.textContent = '';

			const result = await livecollabService.login(email, password);
			if (result.success) {
				await this.secretStorageService.set('livecollab.token', livecollabService.token!);
				await livecollabService.connect();
				signInBtn.textContent = 'Signed in!';
				signInBtn.style.background = '#2EA043';
				setTimeout(async () => {
					const activeEditor = this.editorService.activeEditor;
if (activeEditor) { await this.group.closeEditor(activeEditor); }
				}, 800);
			} else {
				errorEl.textContent = result.error || 'Invalid credentials. Please try again.';
				signInBtn.textContent = 'Sign In';
				(signInBtn as HTMLButtonElement).disabled = false;
			}
		};

		signInBtn.onclick = doSignIn;
		passwordInput.onkeydown = (e) => { if (e.key === 'Enter') { doSignIn(); } };
		emailInput.onkeydown = (e) => { if (e.key === 'Enter') { passwordInput.focus(); } };
	}

	override async setInput(input: LiveCollabSignInInput, options: any, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this._render();
	}

	override layout(_dimension: any): void { }
}
