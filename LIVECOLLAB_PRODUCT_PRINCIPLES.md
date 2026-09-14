# LIVECOLLAB PRODUCT PRINCIPLES — COMPLETE BEHAVIORAL SPECIFICATION

Based on established patterns from VS Code Live Share, Figma, Google Docs,
Replit, and Discord. Where LiveCollab is genuinely new territory, principles
are marked as LiveCollab-specific.

## PRINCIPLE TO APPLY TO EVERYTHING

Before building or changing any feature, ask three questions:

1. What does the established pattern say this should do? (Look at Live Share,
   Figma, Google Docs, Discord for reference)
2. What are we actually doing?
3. If we're deviating, is it deliberate and recorded, or accidental?

Any deviation from established patterns must be recorded as a deliberate
decision with a reason. Not a bug to fix later. A choice that is owned.

---

## 1. ROOM LIFECYCLE

Established pattern: a room is an explicit object with a defined start,
active state, and end. When it ends, everything tears down identically
regardless of how it ended.

How it should work:
- Room is created -> host gets a unique room ID and invite code immediately
- Room is active -> all members are connected, file tree is live, chat is live
- Room ends -> one single `room:ended` event fires to every connected client
  simultaneously; every client tears down identically: file tree clears,
  editors close, socket disconnects, UI returns to dashboard
- It does not matter why the room ended: host clicked "end room," host's
  internet dropped, server restarted, host closed the laptop. The teardown is
  identical every time.

Current gap: different exit paths produce different behavior. Host closing via
button works differently from host disconnecting unexpectedly.

## 2. INVITE CODES AND ROOM ACCESS

Established pattern: any member of a room can generate and share an invite
link. The invite grants access to the room, not ownership of it. Generating an
invite does not change your role.

How it should work:
- Owner: can generate invite codes, set invite expiry, revoke invites, close
  the room
- Member: can generate invite codes and share them. Cannot set expiry or
  revoke other invites
- Guest (view-only, future role): can see the room but cannot invite others
- Invite codes should have a default expiry (24 hours is standard) with the
  owner able to make them permanent or single-use
- An invite code already used by someone should still work for others unless
  it is single-use
- When someone joins via invite, all current members see: "[Name] joined the
  room"

Current gap: only the owner can generate invite codes. Members cannot. This is
a real friction point for collaborative work.

## 3. ROLES AND PERMISSIONS

Established pattern: roles are clearly defined, permissions follow the role,
and role changes are announced to the room.

| Action              | Guest | Member | Owner |
|---------------------|-------|--------|-------|
| View files          | yes   | yes    | yes   |
| Edit files          | no    | yes    | yes   |
| Create files        | no    | yes    | yes   |
| Delete files        | no    | no     | yes   |
| Invite others       | no    | yes    | yes   |
| Kick members        | no    | no     | yes   |
| Transfer ownership  | no    | no     | yes   |
| End room            | no    | no     | yes   |
| Change member roles | no    | no     | yes   |

When a role changes, the affected member sees "Your role has been changed to
[role]" and all other members see "[Name]'s role was changed to [role] by
[Owner]."

## 4. MEMBERSHIP AND PRESENCE

Established pattern: membership state is always accurate, always visible, and
always announced.

How it should work:
- Members panel shows every person currently connected, with a clear
  online/offline indicator
- When someone joins: "[Name] joined" appears in the room chat as a system
  message
- When someone leaves: "[Name] left" appears as a system message
- When someone is kicked: "[Name] was removed from the room" appears as a
  system message (only the kicked person sees "You were removed from this
  room")
- Member count in the UI updates in real time, never shows stale numbers
- If a member disconnects unexpectedly (internet drop), they show as
  "reconnecting" for 30 seconds before being shown as offline. They are not
  immediately removed from the room.
- A member who reconnects within the session window rejoins automatically
  without needing to re-enter the invite code

Current gap: member count sync has been noted as unreliable. Unexpected
disconnects are not distinguished from intentional leaves.

## 5. FILE TREE AND FOLDER STRUCTURE

Established pattern: the guest sees exactly what the host sees. No wrapper
folders, no synthesized roots, no structural differences.

How it should work:
- Host opens a folder called `my-project`. Guest sees `my-project` with the
  exact same structure.
- Files the host creates appear in the guest's tree immediately, in the
  correct location
- Files the guest creates (if they have permission) appear in the host's tree
  immediately
- Deleting a file removes it from everyone's tree simultaneously
- Renaming a file updates it for everyone simultaneously
- The file tree is never "rebuilt from scratch" on reconnect. It receives
  delta updates: file added, file removed, file renamed

Current gap: the wrapper folder bug has been the source of multiple
regressions. The root cause is synthesizing workspace roots instead of
mirroring the host's real structure directly.

## 6. FILE IDENTITY

Established pattern: a file's identity is stable, server-assigned, and does
not change for the lifetime of the room session.

How it should work:
- When the host broadcasts the file tree, the server assigns a stable ID to
  each file
- That ID is the same for the host and every guest
- The ID does not change if the host reconnects, if the room state is
  refreshed, or if a new member joins
- Two files with the same name in different folders have different IDs always
- If a file is deleted and a new file is created with the same name in the
  same location, it gets a new ID (it is a new file)

Current gap: IDs are currently reassigned on re-broadcast, meaning any Yjs
state stored under old IDs becomes orphaned.

> EDITOR'S NOTE (2026-09-14, unverified): the code in `assignTreeIds`
> (server/index.js) keeps a per-room Map keyed by file path and reuses the
> existing ID on re-broadcast, which was written specifically to keep IDs
> stable. So the gap as stated may not match current behavior. If ID
> instability is real, the likely causes are: the in-memory map being lost on
> server restart, or the file path differing between broadcasts. Needs
> verification before acting on.

## 7. REAL-TIME EDITING (YJS)

Established pattern: the server owns the document, clients are synchronized
views.

How it should work:
- One authoritative Yjs document per file lives on the server
- When a client opens a file, it requests the current document state from the
  server
- All edits go to the server first, the server applies them, then broadcasts
  to all other clients
- A client that joins late gets the full current document state, not just
  future updates
- If two people edit the same character position simultaneously, Yjs resolves
  it automatically. Neither edit is lost.
- Cursor positions are shared in real time (awareness layer). You can see
  where the other person is typing before they type.

Current gap: cursor position sharing (Yjs awareness) is not yet implemented.
Late joiners currently get empty documents if seeding fails.

## 8. CHAT

Established pattern: room chat is persistent for the session, clearly
separated from system messages, and never loses messages.

How it should work:
- User messages appear with name, avatar initial, and timestamp
- System messages (joined, left, kicked, role changed) appear in a different
  visual style, clearly distinguished from user messages
- Chat history is available for the full duration of the room session
- If you disconnect and reconnect, you see all messages you missed while
  disconnected
- Chat input supports @mentions of room members (future feature, but design
  should allow for it)
- Pressing Enter sends, Shift+Enter creates a new line

## 9. RECONNECTION

Established pattern: disconnection is expected, not exceptional. The app
handles it gracefully without user intervention.

How it should work:
- When a socket disconnects, the client immediately shows a "Reconnecting..."
  indicator
- The client attempts to reconnect automatically with exponential backoff
  (1s, 2s, 4s, 8s, up to 30s max)
- On successful reconnect, the client requests a state delta from the server
  (what changed while I was gone), not a full re-broadcast
- If reconnection fails after 2 minutes, the client shows "Connection lost.
  Return to dashboard?" with a button
- The server holds a disconnected member's slot open for 30 seconds before
  marking them as offline

Current gap: reconnection currently triggers a full file tree re-broadcast.
This is why 22 broadcasts appeared in one session.

## 10. ROOM SETTINGS

Established pattern: settings are accessible, clear, and non-destructive by
default.

How it should work:
- Owner can rename the room at any time. All members see the new name
  immediately.
- Owner can change room visibility (invite-only vs. open link)
- Owner can set a member limit
- Owner can enable/disable specific permissions for all members (e.g.
  "members cannot create files in this room")
- Deleting a room is a destructive action that requires confirmation: "This
  will permanently delete the room and all its history. This cannot be
  undone."
- Leaving a room (as a member) should ask "Are you sure you want to leave?"
  if you have unsaved work

## 11. NOTIFICATIONS AND FEEDBACK

Established pattern: every action the user takes gets immediate feedback.
Nothing happens silently.

How it should work:
- Every button click that triggers a server action shows a loading state
  within 200ms
- Success actions show a brief confirmation (toast notification, 2-3 seconds,
  then disappears)
- Failed actions show a clear error message that explains what went wrong and
  what to do: "Could not create room. Check your connection and try again."
- Destructive actions (kick, delete, end room) require confirmation dialogs
- If an invite code is copied, the button changes to "Copied!" for 2 seconds
- If someone tries to do something they don't have permission for, the UI
  should not show them that option at all, not show it and then fail when
  they click it

Current gap: some actions fail silently. The "unauthorized" errors during
testing were invisible to the user.

## 12. THE AI TEAMMATE (LiveCollab-specific principle)

This is genuinely new territory. No direct equivalent exists. Based on the
product principles document already committed.

How it should work:
- The AI teammate belongs to the room, not to any individual user
- When someone triggers `@ai`, every member of the room sees the AI working
  in real time
- Any member can give the AI additional instructions mid-task
- The AI's proposed changes appear as a diff that the room can approve or
  reject collectively
- The owner sets which AI model the room uses
- Each member's subscription determines their ability to invoke premium AI,
  but the AI's context and output is shared by everyone
- If two members give the AI conflicting instructions, the AI surfaces the
  conflict rather than silently choosing one

## 13. ONBOARDING AND EMPTY STATES

Established pattern: every empty state tells the user what to do next.
Nothing is just blank.

How it should work:
- New user lands on dashboard: "Create your first room" with a clear button.
  No empty grid with no guidance.
- Empty room (no folder attached): "Add a folder to start collaborating" with
  the exact button to click
- Empty chat: "Say hello to your team" as placeholder text
- No members in the panel besides yourself: "Invite someone to collaborate"
  with the invite button
- Room with no files created yet: "Create your first file" with a button
