/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { livecollabService } from './livecollabService.js';

export const LIVECOLLAB_SCHEME = 'livecollab';

export class LiveCollabFileSystemProvider extends InMemoryFileSystemProvider {

	private _roomId: string = '';
	private _pendingRequests = new Map<string, (content: string) => void>();

	constructor() {
		super();
		// When file content arrives from host, resolve pending request
		livecollabService.onFileContent(({ path, content }) => {
			const resolve = this._pendingRequests.get(path);
			if (resolve) {
				this._pendingRequests.delete(path);
				resolve(content);
			}
		});
	}

	setRoomId(roomId: string): void {
		this._roomId = roomId;
	}

	async populateFromTree(tree: any[], basePath: string = ''): Promise<void> {
		for (const item of tree) {
			const itemPath = basePath ? `${basePath}/${item.name}` : item.name;
			const uri = URI.from({ scheme: LIVECOLLAB_SCHEME, authority: this._roomId, path: `/${itemPath}` });
			if (item.type === 'directory') {
				try { await this.mkdir(uri); } catch { }
				if (item.children?.length > 0) {
					await this.populateFromTree(item.children, itemPath);
				}
			} else {
				// Write empty placeholder — content loaded on demand
				try { await this.writeFile(uri, VSBuffer.fromString('').buffer, { create: true, overwrite: true, unlock: false, atomic: false }); } catch { }
			}
		}
	}

	async loadFileContent(path: string, filePath: string): Promise<void> {
		return new Promise<void>((resolve) => {
			this._pendingRequests.set(path, async (content: string) => {
				const uri = URI.from({ scheme: LIVECOLLAB_SCHEME, authority: this._roomId, path: filePath });
				try {
					await this.writeFile(uri, VSBuffer.fromString(content).buffer, { create: true, overwrite: true, unlock: false, atomic: false });
				} catch { }
				resolve();
			});
			livecollabService.requestFileContent(path);
		});
	}
}

export const livecollabFileSystemProvider = new LiveCollabFileSystemProvider();
