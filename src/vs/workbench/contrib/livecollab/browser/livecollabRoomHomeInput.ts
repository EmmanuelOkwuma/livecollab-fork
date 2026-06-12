/*---------------------------------------------------------------------------------------------
 *  LiveCollab Room Home — the room's narrator (welcome states, working form). Phase D week 3.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { URI } from '../../../../base/common/uri.js';
import { IUntypedEditorInput } from '../../../common/editor.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { livecollabService } from './livecollabService.js';

export const livecollabRoomHomeInputTypeId = 'workbench.editors.livecollabRoomHomeInput';

const roomHomeIcon = registerIcon('livecollab-room-home', Codicon.organization, localize('livecollabRoomHomeIcon', 'Icon for the LiveCollab Room Home.'));

export class LiveCollabRoomHomeInput extends EditorInput {

	static readonly ID = livecollabRoomHomeInputTypeId;
	static readonly RESOURCE = URI.from({ scheme: 'livecollab-room', authority: 'room_home' });

	override get typeId(): string { return LiveCollabRoomHomeInput.ID; }
	override get editorId(): string | undefined { return this.typeId; }
	override getIcon(): ThemeIcon { return roomHomeIcon; }
	get resource(): URI | undefined { return LiveCollabRoomHomeInput.RESOURCE; }

	override getName(): string {
		return livecollabService.roomName || localize('livecollabRoom', "Room");
	}

	override toUntyped(): IUntypedEditorInput {
		return {
			resource: LiveCollabRoomHomeInput.RESOURCE,
			options: { override: LiveCollabRoomHomeInput.ID, pinned: true }
		};
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) { return true; }
		return other instanceof LiveCollabRoomHomeInput;
	}
}
