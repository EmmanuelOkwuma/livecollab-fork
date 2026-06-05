/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { livecollabService } from './livecollabService.js';

export class LiveCollabLoginPanel extends Disposable {

	static async show(
		quickInputService: IQuickInputService,
		notificationService: INotificationService,
	): Promise<void> {
		const panel = new LiveCollabLoginPanel(quickInputService, notificationService);
		await panel.open();
	}

	private constructor(
		private readonly quickInputService: IQuickInputService,
		private readonly notificationService: INotificationService,
	) {
		super();
	}

	async open(): Promise<void> {
		const picked = await this.quickInputService.pick(
			[
				{ label: 'Sign in with Email', id: 'email' },
				{ label: 'Sign in with Google', id: 'google', description: 'coming soon' },
				{ label: 'Sign in with Apple', id: 'apple', description: 'coming soon' },
			],
			{ placeHolder: localize('livecollab.signIn.placeholder', 'Choose how to sign in to LiveCollab') }
		);

		if (!picked) { return; }

		if (picked.id !== 'email') {
			this.notificationService.notify({
				severity: Severity.Info,
				message: localize('livecollab.signIn.comingSoon', 'Google and Apple sign in coming soon.'),
			});
			return;
		}

		let lastError = '';
		while (true) {
			const email = await this.quickInputService.input({
				prompt: lastError ? lastError : localize('livecollab.signIn.emailPrompt', 'Email address'),
				placeHolder: 'your@email.com',
			});
			if (!email) { return; }

			const password = await this.quickInputService.input({
				prompt: localize('livecollab.signIn.passwordPrompt', 'Password'),
				placeHolder: 'Your password',
				password: true,
			});
			if (!password) { return; }

			const result = await livecollabService.login(email.trim(), password);
			if (result.success) {
				await livecollabService.connect();
				this.notificationService.notify({
					severity: Severity.Info,
					message: 'Signed in to LiveCollab successfully!',
				});
				return;
			} else {
				lastError = (result.error || 'Invalid credentials') + ' — try again';
			}
		}
	}
}
