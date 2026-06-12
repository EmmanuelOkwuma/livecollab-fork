/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IViewsRegistry, Extensions as ViewExtensions, IViewDescriptor, ViewContainerLocation, IViewContainersRegistry, Extensions as ViewContainerExtensions } from '../../../common/views.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { LiveCollabMembersView } from './livecollabMembersView.js';
import { LiveCollabChatPanel } from './livecollabChatPanel.js';
import { LiveCollabStatusBarContribution } from './livecollabStatusBar.js';
import { VIEW_CONTAINER } from '../../files/browser/explorerViewlet.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { livecollabService } from './livecollabService.js';
import { LiveCollabSignInInput } from './livecollabSignInInput.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import './livecollabEditorContribution.js';
import { LiveCollabFolderContribution } from './livecollabFolderContribution.js';
import './livecollabCursorContribution.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

// Bootstrap contribution — runs at startup to wire IRequestService into livecollabService
class LiveCollabBootstrap extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.livecollabBootstrap';
	constructor(
		@IRequestService requestService: IRequestService,
	) {
		super();
		livecollabService.setRequestService(requestService);
			livecollabService.connect().catch(console.error);
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	LiveCollabBootstrap,
	LifecyclePhase.Restored
);

// Members icon
const livecollabMembersIcon = registerIcon(
	'livecollab-members',
	Codicon.person,
	localize('livecollabMembersIcon', 'LiveCollab members icon')
);

// Members panel in Explorer sidebar
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

// Chat panel in bottom panel area
const livecollabChatIcon = registerIcon(
	'livecollab-chat',
	Codicon.comment,
	localize('livecollabChatIcon', 'LiveCollab chat icon')
);

const CHAT_PANEL_CONTAINER = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer(
	{
		id: 'workbench.panel.livecollab.chatContainer',
		title: { value: localize('livecollabChatPanel', 'Chat'), original: 'Chat' },
		icon: livecollabChatIcon,
		order: 100,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['workbench.panel.livecollab.chatContainer', { mergeViewWithContainerWhenSingleView: true }]),
		storageId: 'workbench.panel.livecollab.chatContainer.state',
		hideIfEmpty: false,
	},
	ViewContainerLocation.Panel,
	{ doNotRegisterOpenCommand: false, isDefault: false }
);

const chatViewDescriptor: IViewDescriptor = {
	id: LiveCollabChatPanel.ID,
	name: { value: LiveCollabChatPanel.TITLE, original: 'Chat' },
	containerIcon: livecollabChatIcon,
	ctorDescriptor: new SyncDescriptor(LiveCollabChatPanel),
	order: 1,
	weight: 100,
	canToggleVisibility: false,
	canMoveView: true,
};

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews(
	[chatViewDescriptor],
	CHAT_PANEL_CONTAINER
);

// Status bar
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	LiveCollabStatusBarContribution,
	LifecyclePhase.Restored
);

// Join Session command
CommandsRegistry.registerCommand('livecollab.joinSession', async (accessor) => {
	const quickInputService = accessor.get(IQuickInputService);
	const notificationService = accessor.get(INotificationService);

	const code = await quickInputService.input({
		prompt: localize('livecollab.joinSession.prompt', 'Enter invite code'),
		placeHolder: localize('livecollab.joinSession.placeholder', 'Paste your invite code here...'),
	});

	if (!code) { return; }

	await livecollabService.connect();
	const result = await livecollabService.joinRoom(code.trim());

	if (result.success) {
		notificationService.notify({
			severity: Severity.Info,
			message: localize('livecollab.joinSession.success', 'Joined session successfully!'),
		});
	} else {
		notificationService.notify({
			severity: Severity.Error,
			message: localize('livecollab.joinSession.error', 'Could not join session: {0}', result.error || 'Unknown error'),
		});
	}
});

// Sign In command - opens sign in tab
CommandsRegistry.registerCommand('livecollab.signIn', async (accessor) => {
	const editorService = accessor.get(IEditorService);
	const instantiationService = accessor.get(IInstantiationService);
	const input = instantiationService.createInstance(LiveCollabSignInInput);
	await editorService.openEditor(input, { pinned: false });
});

// Sign In Editor Registration
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions } from '../../../common/editor.js';
import { LiveCollabSignInEditor } from './livecollabSignInEditor.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(LiveCollabSignInEditor, LiveCollabSignInEditor.ID, 'Sign in to LiveCollab'),
	[new SyncDescriptor(LiveCollabSignInInput)]
);

class LiveCollabSignInEditorResolver extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.livecollabSignInEditorResolver';
	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,

	) {
		super();
		this._register(editorResolverService.registerEditor(
			`${LiveCollabSignInInput.RESOURCE.scheme}://**`,
			{
				id: LiveCollabSignInEditor.ID,
				label: 'Sign in to LiveCollab',
				priority: RegisteredEditorPriority.builtin,
			},
			{ singlePerResource: true, canSupportResource: uri => uri.scheme === LiveCollabSignInInput.RESOURCE.scheme && uri.authority === 'livecollab_signin_page' },
			{
				createEditorInput: () => ({
					editor: this.instantiationService.createInstance(LiveCollabSignInInput),
					options: { pinned: false }
				})
			}
		));

	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	LiveCollabSignInEditorResolver,
	LifecyclePhase.Restored
);

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	LiveCollabFolderContribution,
	LifecyclePhase.Restored
);

// ===== LiveCollab Room Home (Phase D week 3) =====
import { LiveCollabRoomHomeInput } from './livecollabRoomHomeInput.js';
import { LiveCollabRoomHomeEditor } from './livecollabRoomHomeEditor.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(LiveCollabRoomHomeEditor, LiveCollabRoomHomeEditor.ID, 'LiveCollab Room'),
	[new SyncDescriptor(LiveCollabRoomHomeInput)]
);

// ===== LiveCollab Dashboard (Phase D week 1) =====
import { LiveCollabDashboardInput } from './livecollabDashboardInput.js';
import { LiveCollabDashboardEditor } from './livecollabDashboardEditor.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';
import { MenuRegistry, MenuId } from '../../../../platform/actions/common/actions.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(LiveCollabDashboardEditor, LiveCollabDashboardEditor.ID, 'LiveCollab Dashboard'),
	[new SyncDescriptor(LiveCollabDashboardInput)]
);

CommandsRegistry.registerCommand('livecollab.openDashboard', async (accessor) => {
	const editorService = accessor.get(IEditorService);
	const instantiationService = accessor.get(IInstantiationService);
	const input = instantiationService.createInstance(LiveCollabDashboardInput);
	await editorService.openEditor(input, { pinned: true });
});
MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'livecollab.openDashboard',
		title: { value: 'LiveCollab: Open Dashboard', original: 'LiveCollab: Open Dashboard' },
	}
});

class LiveCollabDashboardContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.livecollabDashboard';
	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		this._register(editorResolverService.registerEditor(
			`${LiveCollabDashboardInput.RESOURCE.scheme}://**`,
			{
				id: LiveCollabDashboardEditor.ID,
				label: 'LiveCollab Dashboard',
				priority: RegisteredEditorPriority.builtin,
			},
			{ singlePerResource: true, canSupportResource: uri => uri.scheme === LiveCollabDashboardInput.RESOURCE.scheme },
			{
				createEditorInput: () => ({
					editor: this.instantiationService.createInstance(LiveCollabDashboardInput),
					options: { pinned: true }
				})
			}
		));
	}
}
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	LiveCollabDashboardContribution,
	LifecyclePhase.Restored
);

// ===== LiveCollab Startup Owner — the ONE startup brain (Page Law, council r3+r4) =====
class LiveCollabStartupOwner extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.livecollabStartupOwner';
	constructor(
		@ISecretStorageService secretStorageService: ISecretStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IEditorService editorService: IEditorService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
	) {
		super();
		(async () => {
			// Ghost suppression: livecollab:// virtual folders are session artifacts —
			// they must never survive a reload. Strip before deciding doors.
			const ghosts = workspaceContextService.getWorkspace().folders.filter(f => f.uri.scheme === 'livecollab');
			if (ghosts.length) {
				const workspaceEditingService = instantiationService.invokeFunction(accessor => accessor.get(IWorkspaceEditingService));
				await workspaceEditingService.removeFolders(ghosts.map(g => g.uri)).catch(console.error);
			}
			const token = await secretStorageService.get('livecollab.token');
			if (!token) {
				// Door 1: signed out — sign-in IS the window
				const signIn = instantiationService.createInstance(LiveCollabSignInInput);
				await editorService.openEditor(signIn, { pinned: true });
				return;
			}
			// Door 2: signed in — connect ONCE, dashboard is the resting state
			livecollabService.setToken(token);
			livecollabService.connect().catch(console.error);
			if (workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY) {
				const dash = instantiationService.createInstance(LiveCollabDashboardInput);
				await editorService.openEditor(dash, { pinned: true });
			}
		})().catch(console.error);
	}
}
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	LiveCollabStartupOwner,
	LifecyclePhase.Restored
);
