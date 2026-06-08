/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IContentWidget, IContentWidgetPosition } from '../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { Range } from '../../../../editor/common/core/range.js';
import { livecollabService } from './livecollabService.js';

const USER_COLORS = [
	'#93c5fd', '#60a5fa', '#38bdf8', '#3b82f6', '#2563eb', '#818cf8',
];

function colorForIndex(index: number): string {
	return USER_COLORS[index % USER_COLORS.length];
}

function colorIndexFromSocketId(socketId: string): number {
	let hash = 0;
	for (let i = 0; i < socketId.length; i++) {
		hash = socketId.charCodeAt(i) + ((hash << 5) - hash);
	}
	return Math.abs(hash) % USER_COLORS.length;
}

interface IRemoteCursorInfo {
	fileId: string;
	name: string;
	colorIndex: number;
	position: { lineNumber: number; column: number };
}

export class LiveCollabCursorContribution extends Disposable implements IEditorContribution {

	static readonly ID = 'editor.contrib.livecollabCursor';

	private readonly _remoteCursors = new Map<string, IRemoteCursorInfo>();
	private readonly _decorations = new Map<string, string[]>();
	private readonly _labelWidgets = new Map<string, { widget: IContentWidget; dom: HTMLElement }>();
	private _styleEl: HTMLStyleElement | undefined;

	constructor(
		private readonly editor: ICodeEditor,
	) {
		super();

		this._injectStyles();

		// Emit cursor position on move
		this._register(this.editor.onDidChangeCursorPosition(() => {
			this._emitCursor();
		}));

		// Emit cursor on selection change
		this._register(this.editor.onDidChangeCursorSelection(() => {
			this._emitCursor();
		}));

		// Repaint cursors when file changes
		this._register(this.editor.onDidChangeModel(() => {
			this._repaintAll();
		}));

		// Receive cursor updates from socket
		this._register(livecollabService.onCursorUpdate((payload) => {
			if (!livecollabService.roomId) { return; }
			this._remoteCursors.set(payload.socketId, {
				fileId: payload.fileId,
				name: payload.name || 'Anonymous',
				colorIndex: colorIndexFromSocketId(payload.socketId),
				position: payload.position,
			});
			this._paintCursor(payload.socketId);
		}));

		// Clear cursor when user leaves
		this._register(livecollabService.onCursorLeave((payload) => {
			this._clearCursor(payload.socketId);
		}));
	}

	private _emitCursor(): void {
		if (!livecollabService.isConnected) { return; }
		if (!livecollabService.roomId) { return; }
		const model = this.editor.getModel();
		if (!model) { return; }
		const position = this.editor.getPosition();
		if (!position) { return; }
		const fileId = model.uri.path.split('/').pop() || model.uri.path;
		livecollabService.emitCursorUpdate(
			livecollabService.roomId,
			fileId,
			{ lineNumber: position.lineNumber, column: position.column }
		);
	}

	private _paintCursor(socketId: string): void {
		const info = this._remoteCursors.get(socketId);
		if (!info) { return; }
		const model = this.editor.getModel();
		if (!model) { return; }
		const modelFileId = model.uri.path.split('/').pop() || model.uri.path;
		if (modelFileId !== info.fileId) {
			this._clearCursorDecorations(socketId);
			return;
		}

		const { lineNumber, column } = info.position;
		const color = colorForIndex(info.colorIndex);
		const className = `lc-remote-cursor-${socketId.replace(/[^a-zA-Z0-9]/g, '_')}`;

		// Inject per-cursor style
		this._injectCursorStyle(socketId, color, className, info.name || "User");

		const range = new Range(lineNumber, column, lineNumber, column);
		const prev = this._decorations.get(socketId) || [];
		const next = this.editor.deltaDecorations(prev, [
			{
				range,
				options: {
					description: "livecollab-remote-cursor",
						beforeContentClassName: className,
					stickiness: 1,
				},
			},
		]);
		this._decorations.set(socketId, next);
		this._ensureLabelWidget(socketId, info.name, color, { lineNumber, column });
	}

	private _clearCursor(socketId: string): void {
		this._clearCursorDecorations(socketId);
		this._remoteCursors.delete(socketId);
		this._removeLabelWidget(socketId);
	}

	private _clearCursorDecorations(socketId: string): void {
		const prev = this._decorations.get(socketId) || [];
		if (prev.length) {
			this.editor.deltaDecorations(prev, []);
			this._decorations.set(socketId, []);
		}
	}

	private _repaintAll(): void {
		for (const [socketId] of this._remoteCursors) {
			this._clearCursorDecorations(socketId);
			this._removeLabelWidget(socketId);
			this._paintCursor(socketId);
		}
	}

	private _ensureLabelWidget(
		socketId: string,
		name: string,
		color: string,
		position: { lineNumber: number; column: number }
	): void {
		const existing = this._labelWidgets.get(socketId);
		if (existing) {
			existing.dom.textContent = name;
			existing.dom.style.background = color;
			const w = existing.widget as any;
			if (typeof w.__setPos === 'function') { w.__setPos(position); }
			this.editor.layoutContentWidget(existing.widget);
			return;
		}

		const dom = document.createElement('div');
		dom.style.position = 'absolute';
		dom.style.transform = 'translateY(-85%)';
		dom.style.fontSize = '10px';
		dom.style.padding = '1px 4px';
		dom.style.borderRadius = '2px 2px 2px 0';
		dom.style.color = 'white';
		dom.style.whiteSpace = 'nowrap';
		dom.style.pointerEvents = 'none';
		dom.style.userSelect = 'none';
		dom.style.background = color;
		dom.style.fontWeight = '600';
		dom.style.letterSpacing = '0.02em';
		dom.style.transition = 'opacity 0.3s ease';
		dom.style.opacity = '1';
		dom.textContent = name;

		let pos: { lineNumber: number; column: number } | null = position;

		const widget: IContentWidget = {
			getId: () => `lc-cursor-label-${socketId}`,
			getDomNode: () => dom,
			getPosition: (): IContentWidgetPosition | null => {
				if (!pos) { return null; }
				return {
					position: pos,
					preference: [1], // ABOVE
				};
			},
		};

		(widget as any).__setPos = (p: { lineNumber: number; column: number }) => {
			pos = p;
		};

		this._labelWidgets.set(socketId, { widget, dom });
		this.editor.addContentWidget(widget);
		(widget as any).__fadeTimer = setTimeout(() => { dom.style.opacity = '0'; }, 2000);
	}

	private _removeLabelWidget(socketId: string): void {
		const entry = this._labelWidgets.get(socketId);
		if (!entry) { return; }
		try { this.editor.removeContentWidget(entry.widget); } catch { }
		this._labelWidgets.delete(socketId);
	}

	private _injectStyles(): void {
		this._styleEl = document.createElement('style');
		this._styleEl.textContent = `
			.lc-remote-cursor-base {
				border-left: 1px solid;
				margin-left: -1px;
				height: 1.2em;
				display: inline-block;
				position: relative;
			}
			.lc-remote-cursor-base::before {
				content: '';
				position: absolute;
				top: -4px;
				left: -2px;
				width: 6px;
				height: 3px;
				border-radius: 2px 2px 0 0;
				background: inherit;
			}
		`;
		document.head.appendChild(this._styleEl);
	}

	private _injectCursorStyle(socketId: string, color: string, className: string, name: string): void {
		const styleId = `lc-cursor-style-${socketId.replace(/[^a-zA-Z0-9]/g, '_')}`;
		const existing = document.getElementById(styleId);
		if (existing) { existing.remove(); }
		const style = document.createElement('style');
		style.id = styleId;
		style.textContent = `
			.${className} {
				border-left: 1px solid ${color};
				margin-left: -1px;
				height: 1.2em;
				display: inline-block;
				position: relative;
			}
			.${className}::before {
				content: '';
				position: absolute;
				top: -3px;
				left: -2px;
				width: 5px;
				height: 3px;
				background: ${color};
				border-radius: 1px 1px 0 0;
			}
			.${className}::after {
				content: '${name}';
				position: absolute;
				top: -20px;
				left: -1px;
				font-size: 12px;
				font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
				font-weight: 600;
				padding: 2px 6px;
				border-radius: 3px 3px 3px 0;
				background: ${color};
				color: white;
				white-space: nowrap;
				pointer-events: none;
				opacity: 0;
				transition: opacity 0.15s ease;
				z-index: 999;
			}
			.${className}:hover::after {
				opacity: 1;
			}
		`;
		document.head.appendChild(style);
	}

	override dispose(): void {
		for (const [socketId] of this._remoteCursors) {
			this._clearCursor(socketId);
		}
		if (this._styleEl) {
			this._styleEl.remove();
		}
		super.dispose();
	}
}

registerEditorContribution(
	LiveCollabCursorContribution.ID,
	LiveCollabCursorContribution,
	EditorContributionInstantiation.AfterFirstRender
);
