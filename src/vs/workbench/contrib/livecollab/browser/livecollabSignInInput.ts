/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { Schemas } from '../../../../base/common/network.js';
import { localize } from '../../../../nls.js';

export const livecollabSignInInputTypeId = 'workbench.editors.livecollabSignInInput';

export class LiveCollabSignInInput extends EditorInput {

	static readonly ID = livecollabSignInInputTypeId;
	static readonly RESOURCE = URI.from({ scheme: Schemas.walkThrough, authority: 'livecollab_signin_page' });

	override get typeId(): string {
		return LiveCollabSignInInput.ID;
	}

	override get resource(): URI {
		return LiveCollabSignInInput.RESOURCE;
	}

	override getName(): string {
		return localize('livecollabSignIn', 'Sign in to LiveCollab');
	}

	override matches(other: EditorInput): boolean {
		return other instanceof LiveCollabSignInInput;
	}
}
