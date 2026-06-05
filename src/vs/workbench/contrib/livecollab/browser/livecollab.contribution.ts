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
import { VIEW_CONTAINER } from '../../files/browser/explorerViewlet.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';

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

class LiveCollabContribution {
	constructor() {
		console.log('[LiveCollab] Collaboration layer initialized');
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	LiveCollabContribution,
	LifecyclePhase.Restored
);
