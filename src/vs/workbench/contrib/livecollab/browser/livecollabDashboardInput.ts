/*---------------------------------------------------------------------------------------------
 *  LiveCollab Dashboard — editor input (Phase D week 1)
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { URI } from '../../../../base/common/uri.js';
import { IUntypedEditorInput } from '../../../common/editor.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';

export const livecollabDashboardInputTypeId = 'workbench.editors.livecollabDashboardInput';

const dashboardIcon = registerIcon('livecollab-dashboard', Codicon.home, localize('livecollabDashboardIcon', 'Icon for the LiveCollab Dashboard.'));

export class LiveCollabDashboardInput extends EditorInput {

	static readonly ID = livecollabDashboardInputTypeId;
	static readonly RESOURCE = URI.from({ scheme: 'livecollab-dashboard', authority: 'dashboard' });

	override get typeId(): string {
		return LiveCollabDashboardInput.ID;
	}

	override get editorId(): string | undefined {
		return this.typeId;
	}

	override getIcon(): ThemeIcon {
		return dashboardIcon;
	}

	get resource(): URI | undefined {
		return LiveCollabDashboardInput.RESOURCE;
	}

	override getName(): string {
		return localize('livecollabDashboard', "Dashboard");
	}

	override toUntyped(): IUntypedEditorInput {
		return {
			resource: LiveCollabDashboardInput.RESOURCE,
			options: { override: LiveCollabDashboardInput.ID, pinned: true }
		};
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) { return true; }
		return other instanceof LiveCollabDashboardInput;
	}

	override dispose(): void {
		super.dispose();
	}
}
