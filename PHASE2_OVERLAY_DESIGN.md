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

## 4. Room switching inside a persistent workbench: the _boot() problem

`LiveCollabStartupOwner._boot()` (livecollab.contribution.ts) currently
runs exactly once, triggered by LifecyclePhase.Restored when the
workbench page first loads. It does two genuinely different things,
mixed together in one sequential function:

1. ONE-TIME SETUP: mint a Clerk auth token from the stored dvb_ JWT, set
   the display name, connect the socket, wait for the connection to be
   live.
2. ROOM-SPECIFIC LOGIC: read a pending room ID (today, from the global-
   variable workaround this doc already plans to eliminate), join that
   room, fetch its name, fetch its members.

Under a `loadURL()`-reload architecture this was never a problem — the
whole page, and therefore the whole class instance, gets destroyed and
recreated on every room change, so "runs once" and "runs once per room
visit" were accidentally the same thing.

**This breaks under the persistent overlay.** With the workbench
WebContents alive for the life of the app, `_boot()` fires exactly once,
ever. Open Room A: works correctly, `_boot()` joins it. Go back to the
dashboard and open Room B: nothing re-triggers, because the class was
already constructed and `_boot()` already ran. The workbench is left
silently believing it is still in Room A - a real, load-bearing bug, not
a cosmetic one, and it would surface on literally the second room a user
ever opens.

### The fix: split _boot() into two pieces

**One-time init (fires once, unchanged from today):** mint the Clerk
token, set the display name, connect the socket, wait for connection.
This part is genuinely one-time - the token and socket connection are
not room-scoped, they belong to the session as a whole.

**Re-callable room-join (new):** a separate function, NOT tied to
LifecyclePhase.Restored, that performs: leave-current-room cleanup (see
below) → join new room → fetch room name → fetch members. This function
runs every time the user opens a room, not just the first time.

### Triggering the room-join from the main process

Under the overlay, the flow becomes: main process shows the (already-
alive) workbench WebContents and sends a NEW, dedicated IPC message
directly to it - `vscode:livecollab-join-room`, payload `{ roomId,
roomName }` - instead of the current `loadURL()` + global-variable
handoff. The workbench's IPC listener for this message calls the
re-callable room-join function above. This message can fire any number
of times over the workbench's lifetime, once per room the user opens,
which is the entire point of the split.

### What must be cleaned up between rooms (the part most likely to cause bugs if skipped)

Switching from Room A to Room B is not just "join B" - it must first
leave A cleanly, or state bleeds across rooms. Concretely, before
joining the new room:
- Socket room membership: explicitly leave A's room on the socket/
  server side (not just stop listening client-side - the server needs
  to know this client left, for accurate member counts and to stop
  routing A's events to a client that's no longer viewing A).
- File tree / virtual filesystem: A's files must be cleared from the
  in-memory `InMemoryFileSystemProvider`-based virtual filesystem before
  B's files populate it. Leaving A's tree present would let a user
  briefly (or not-so-briefly, if something fails silently) see or edit
  A's files while believing they're in B.
- Open editors / active file: any editor tabs open to A's files must be
  closed. A stale tab pointing at a file that no longer belongs to the
  currently-joined room is a real correctness hazard, not just visual
  clutter - it's the same shape of bug as #3's file corruption, applied
  to room identity instead of content.
- Room-scoped UI state: room name display, member list/avatars, any
  per-room settings or panel state must reset to B's values, not
  continue showing A's until B's data arrives and happens to overwrite
  it.

This cleanup sequence needs to be a single, explicit function (e.g.
`leaveCurrentRoom()`) called at the start of the room-join handler,
before any of B's data is requested - not scattered inline, and not
assumed to happen "naturally" as a side effect of joining B.

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
