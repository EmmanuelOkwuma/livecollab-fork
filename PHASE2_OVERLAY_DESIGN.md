# Phase 2 — Overlay Design Doc

## Problem

Every dashboard↔room transition currently does a full `loadURL()` reload
of the entire Electron window (`windowImpl.ts`, IPC handlers
`vscode:livecollab-load-dashboard` / `vscode:livecollab-load-workbench`).
This destroys and rebuilds the whole page each time: flashes, is slow,
and is the confirmed root cause of #4. There is real correlated evidence
(from Phase 1's #3 diagnostic work) that it is also Door #2's trigger —
a socket reconnect alone does not corrupt files, but a full reload does.

The room ID is currently passed across the reload via a main-process
global variable (`_livecollabPendingRoomId`), which the freshly-loaded
page then queries back out over IPC on startup. This is a workaround
for the fact that `loadURL()` provides no other way to hand data into
the new page — itself a symptom of the reload architecture, not a
design choice.

## Decision: Option B — two persistent WebContents (BrowserView), not a merged single page

**Rejected: merging dashboard + workbench into one HTML document.**
VS Code's `workbench.html` has its own deeply specific bootstrap
sequence (extension host init, IPC bridge setup, service worker
registration) that assumes it is the only thing running in that
context. Embedding it inside a parent document means fighting
assumptions baked into Microsoft's own initialization code — the kind
of thing that works locally and breaks unpredictably on other machines,
other Electron versions, or when pulling upstream VS Code changes. This
would mean maintaining a de facto fork of VS Code's bootstrap, which is
not sustainable on top of everything else this project already
maintains.

**Chosen: keep dashboard and workbench as separate documents, each in
its own WebContents, and toggle visibility between them.** This
respects the boundary VS Code already has — the workbench initializes
exactly once, exactly as designed, and stays alive. The window manages
*visibility*, not *existence*. This is the standard desktop-app pattern
(e.g. how Slack manages multiple workspaces, each in its own
WebContents) and it holds up in production because it doesn't fight the
underlying platform or accumulate hidden debt inside someone else's
bootstrap code.

Known complexity this introduces (manageable, not novel): memory (both
WebContents run simultaneously), IPC routing (messages need to reach the
correct WebContents, not just "the window"), and lifecycle handling
(what happens if one WebContents crashes independently of the other).
These are documented, standard Electron problems with established
solutions — unlike Option A's risk, which has no established solution
because it requires modifying VS Code's own internals.

## 1. What does a room own, independent of any connected client?

The server is already the authoritative owner of room state:
- Room identity: name, owner, members, roles (SQLite `rooms`,
  `room_members` tables + in-memory `roomStates` map)
- File tree and file contents (SQLite `files` table, synced via
  `roomStates`)
- Delete status (`deletedAt`/`deletedBy`, confirmed correct as of the
  #7 fix)

This does not need to change. The client (either WebContents) is always
a *view* onto this server-owned state, never the source of truth. What
changes with the overlay is *how* a view gets handed a room to display:
instead of a full reload smuggling a room ID through a global variable,
the already-running workbench WebContents receives the room ID directly
(via IPC to a live context) and hydrates from the server exactly as it
does today — just without tearing itself down first.

## 2. What currently lives only in the client and is lost on every reload?

- Open editor tabs and which file is active
- Cursor position and unsaved in-editor state
- The in-memory virtual filesystem (`InMemoryFileSystemProvider`-based,
  for `livecollab://` virtual rooms)
- Any local UI state (panel layout, scroll position, etc.)

None of this is currently persisted anywhere — it's simply rebuilt from
scratch (or lost) on every reload, because the whole document is
destroyed. With two persistent WebContents, none of this needs to be
saved and restored, because the WebContents never actually goes away.
This is the direct payoff of the overlay: things that reset today would
simply continue existing.

## 3. IPC routing with two WebContents

Today, `windowImpl.ts` manages a single `BrowserWindow` with one
implicit `WebContents`, and IPC handlers attach to `this._win` directly.
With two WebContents (dashboard + workbench) living in the same window,
IPC handlers need to know *which* WebContents a message is for and
*which* WebContents to send a response/command to — "the window" is no
longer a sufficient target.

Concrete implication for the existing handlers found in this session's
trace (`windowImpl.ts` ~line 725-765):
- `vscode:livecollab-load-dashboard` currently does `this._win.loadURL(...)`.
  Under the overlay, this becomes: show the dashboard WebContents, hide
  the workbench WebContents. No reload.
- `vscode:livecollab-load-workbench` currently does `this._win.loadURL(...)`
  plus the global-variable roomId handoff. Under the overlay, this
  becomes: send the roomId directly to the (already-alive) workbench
  WebContents via IPC, then show it and hide the dashboard WebContents.
  The global-variable workaround (`_livecollabPendingRoomId`) is
  eliminated entirely — it only existed because `loadURL()` gave no
  other way to pass data into a fresh page.

This routing logic (which WebContents owns which IPC channel, how to
target a `sender.send()` at a specific WebContents rather than the
window) is the concrete design surface for Stage 1's implementation.

## Build order (from the roadmap, unchanged)

Stage 1: empty BrowserView mounting shell — get two WebContents coexisting
in one window with basic show/hide toggling, no real room logic yet.
Stages 2-4: wire the real dashboard/workbench content into each view,
replace the loadURL-based IPC handlers with the show/hide + direct-IPC
pattern described above, remove the global-variable roomId workaround.

## Verification target

Once the overlay ships, re-run Door #2's exact reproduction (leave room,
re-enter, repeat) and confirm whether the metadata-as-content corruption
still occurs. Per Phase 1's correlation finding (reconnect-alone stays
clean, reload reliably corrupts), if the overlay eliminates the reload
entirely, Door #2 should not reproduce. If it still reproduces post-
overlay, the correlation was coincidental and Door #2 needs its own
standalone fix (the VS Code core breakpoint trace, previously deferred
in favor of this higher-leverage path).
