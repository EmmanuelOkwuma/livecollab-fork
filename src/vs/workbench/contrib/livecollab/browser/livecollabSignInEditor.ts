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
		this._container = append(parent, $('div.livecollab-signin-page'));
		this._container.style.cssText = `
			display: flex;
			height: 100%;
			background: var(--vscode-editor-background);
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			overflow: hidden;
		`;
		this._render();
	}

	private _render(): void {
		if (!this._container) { return; }
		clearNode(this._container);

		// Left column — sign in form
		const left = append(this._container, $('div.livecollab-signin-left'));
		left.style.cssText = `
			flex: 1;
			padding: 60px 80px;
			display: flex;
			flex-direction: column;
			justify-content: flex-start;
			max-width: 500px;
			padding-top: 160px;
		`;

		// LiveCollab heading
		const heading = append(left, $('div'));
		heading.style.cssText = `
			font-size: 42px;
			font-weight: 300;
			color: var(--vscode-foreground);
			margin-bottom: 10px;
			letter-spacing: -0.5px;
		`;
		heading.textContent = 'LiveCollab';

		const subheading = append(left, $('div'));
		subheading.style.cssText = `
			font-size: 13px;
			color: var(--vscode-descriptionForeground);
			margin-bottom: 40px;
		`;
		subheading.textContent = 'Code together, in real time.';

		// Email label and input
		const emailLabel = append(left, $('div'));
		emailLabel.style.cssText = 'font-size: 11px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;';
		emailLabel.textContent = 'Email';

		const emailInput = append(left, $('input')) as HTMLInputElement;
		emailInput.type = 'email';
		emailInput.placeholder = 'your@email.com';
		emailInput.style.cssText = `
			width: 100%;
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, #2b2b2b);
			border-radius: 2px;
			padding: 7px 10px;
			color: var(--vscode-input-foreground);
			font-size: 13px;
			outline: none;
			margin-bottom: 16px;
			box-sizing: border-box;
		`;
		emailInput.onfocus = () => { emailInput.style.borderColor = 'var(--vscode-focusBorder)'; };
		emailInput.onblur = () => { emailInput.style.borderColor = 'var(--vscode-input-border, #2b2b2b)'; };

		// Password label and input
		const passwordLabel = append(left, $('div'));
		passwordLabel.style.cssText = 'font-size: 11px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;';
		passwordLabel.textContent = 'Password';

		const passwordInput = append(left, $('input')) as HTMLInputElement;
		passwordInput.type = 'password';
		passwordInput.placeholder = 'Your password';
		passwordInput.style.cssText = `
			width: 100%;
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, #2b2b2b);
			border-radius: 2px;
			padding: 7px 10px;
			color: var(--vscode-input-foreground);
			font-size: 13px;
			outline: none;
			margin-bottom: 8px;
			box-sizing: border-box;
		`;
		passwordInput.onfocus = () => { passwordInput.style.borderColor = 'var(--vscode-focusBorder)'; };
		passwordInput.onblur = () => { passwordInput.style.borderColor = 'var(--vscode-input-border, #2b2b2b)'; };

		// Error message
		const errorEl = append(left, $('div'));
		errorEl.style.cssText = 'color: var(--vscode-errorForeground); font-size: 12px; margin-bottom: 16px; min-height: 18px;';

		// Sign In button
		const signInBtn = append(left, $('button')) as HTMLButtonElement;
		signInBtn.style.cssText = `
			background: var(--vscode-button-background);
			border: none;
			border-radius: 2px;
			padding: 8px 16px;
			color: var(--vscode-button-foreground);
			font-size: 13px;
			font-weight: 500;
			cursor: pointer;
			margin-bottom: 24px;
			width: 100%;
		`;
		signInBtn.textContent = 'Sign In';
		signInBtn.onmouseenter = () => { signInBtn.style.background = 'var(--vscode-button-hoverBackground)'; };
		signInBtn.onmouseleave = () => { signInBtn.style.background = 'var(--vscode-button-background)'; };

		// Divider
		const divider = append(left, $('div'));
		divider.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 16px;';
		const line1 = append(divider, $('div'));
		line1.style.cssText = 'flex: 1; height: 1px; background: var(--vscode-widget-border, #2b2b2b);';
		const orText = append(divider, $('div'));
		orText.style.cssText = 'font-size: 11px; color: var(--vscode-descriptionForeground);';
		orText.textContent = 'or continue with';
		const line2 = append(divider, $('div'));
		line2.style.cssText = 'flex: 1; height: 1px; background: var(--vscode-widget-border, #2b2b2b);';

		// Social buttons
		const socialRow = append(left, $('div'));
		socialRow.style.cssText = 'display: flex; gap: 12px;';

		const googleBtn = append(socialRow, $('button')) as HTMLButtonElement;
		googleBtn.style.cssText = `
			flex: 1;
			background: transparent;
			border: 1px solid var(--vscode-widget-border, #2b2b2b);
			border-radius: 2px;
			padding: 8px;
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			cursor: not-allowed;
			opacity: 0.5;
		`;
		googleBtn.textContent = 'G  Google';
		googleBtn.title = 'Coming soon';
		googleBtn.disabled = true;

		const appleBtn = append(socialRow, $('button')) as HTMLButtonElement;
		appleBtn.style.cssText = `
			flex: 1;
			background: transparent;
			border: 1px solid var(--vscode-widget-border, #2b2b2b);
			border-radius: 2px;
			padding: 8px;
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			cursor: not-allowed;
			opacity: 0.5;
		`;
		appleBtn.textContent = '  Apple';
		appleBtn.title = 'Coming soon';
		appleBtn.disabled = true;

		// Right column — logo placeholder
		const right = append(this._container, $('div.livecollab-signin-right'));
		right.style.cssText = `
			flex: 1;
			display: flex;
			align-items: center;
			justify-content: center;
			background: var(--vscode-sideBar-background);
			
		`;

		const logoPlaceholder = append(right, $('div'));
		logoPlaceholder.style.cssText = `
			font-size: 64px;
			font-weight: 700;
			color: var(--vscode-widget-border, #2b2b2b);
			letter-spacing: -2px;
			user-select: none;
		`;
		logoPlaceholder.textContent = 'LC';

		// Sign in logic
		const doSignIn = async () => {
			const email = emailInput.value.trim();
			const password = passwordInput.value;
			if (!email || !password) {
				errorEl.textContent = 'Please enter your email and password.';
				return;
			}
			signInBtn.textContent = 'Signing in...';
			signInBtn.disabled = true;
			errorEl.textContent = '';

			const result = await livecollabService.login(email, password);
			if (result.success) {
				await this.secretStorageService.set('livecollab.token', livecollabService.token!);
				await livecollabService.connect();
				signInBtn.textContent = 'Signed in!';
				setTimeout(async () => {
					const activeEditor = this.editorService.activeEditor;
					if (activeEditor) { await this.group.closeEditor(activeEditor); }
				}, 800);
			} else {
				errorEl.textContent = result.error || 'Invalid credentials. Please try again.';
				signInBtn.textContent = 'Sign In';
				signInBtn.disabled = false;
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
