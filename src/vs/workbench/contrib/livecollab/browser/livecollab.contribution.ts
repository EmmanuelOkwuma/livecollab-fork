/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IViewsRegistry, Extensions as ViewExtensions, IViewDescriptor } from '../../../common/views.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { LiveCollabMembersView } from './livecollabMembersView.js';
import { LiveCollabStatusBarContribution } from './livecollabStatusBar.js';
import { VIEW_CONTAINER } from '../../files/browser/explorerViewlet.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';

const livecollabMembersIcon = registerIcon(
	'livecollab-members',
	Codicon.person,
	localize('livecollabMembersIcon', 'LiveCollab members icon')
);

const membersViewDescriptor: IViewDescriptor = {
	id: LiveCollabMembersView.ID,
	name: { value: LiveCollabMembersView.TITLE, original: 'Members' },
	containerIcon: livecollabMembersIcon,
	ctorDescriptor: new SyncDescriptor(LiveCollabMembersView),
	order: 10,
	weight: 30,
	collapsed: true,
	canToggleVisibility: true,
	canMoveView: true,
};

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews(
	[membersViewDescriptor],
	VIEW_CONTAINER
);

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	LiveCollabStatusBarContribution,
	LifecyclePhase.Restored
);

CommandsRegistry.registerCommand('livecollab.joinSession', async (accessor) => {
	const quickInputService = accessor.get(IQuickInputService);
	const code = await quickInputService.input({
		prompt: localize('livecollab.joinSession.prompt', 'Enter invite code'),
		placeHolder: localize('livecollab.joinSession.placeholder', 'Paste your invite code here...'),
	});
	if (code) {
		// TODO: connect to backend with invite code
		console.log('[LiveCollab] Joining session with code:', code);
	}
});
