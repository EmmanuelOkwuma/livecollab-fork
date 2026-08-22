# Phase 3 — Yjs/CRDT Design Doc

## The question, per the roadmap's own words

"The biggest unknown on the whole roadmap": does Yjs replace the
current Socket.io sync system for file content, or run alongside it?
Answered here with real evidence checked against actual code and
Yjs's actual documented integration story, before any implementation.

## 1. The current sync flow, traced end to end (real code, 2026-08-15)

Keystroke to other user's screen, traced through the actual source:

1. `livecollabEditorContribution.ts` line 18: `editor.onDidChangeModelContent`
   fires on every keystroke.
2. Line 26: `const code = model.getValue();` - reads the ENTIRE file's
   current content, not a diff of what changed.
3. `livecollabService.ts` `emitCodeChange()`: attaches a nonce (for
   filtering our own echo, the Door #1 fix from earlier this project),
   emits `code:change` with the FULL file content over the socket.
4. Server relays it (not traced in this doc - client behavior is what
   matters for this decision).
5. Receiving client, `livecollabService.ts` line 199: `code:change`
   listener fires, updates a local cache, fires `onCodeChange`.
6. `livecollabEditorContribution.ts` line 59-76: the listener does
   `model.pushEditOperations([], [{ range: fullRange, text: code }], ...)`
   - replaces the ENTIRE visible document with whatever full-file
   content arrived, wholesale.

CONFIRMED: this is whole-document broadcast-and-overwrite, not a merge
of any kind. Zero diffing, zero operational transform, zero conflict
resolution anywhere in this chain. This directly explains the roadmap's
own documented "last-write-wins" problem: two people editing different
parts of a file, whoever's full-file message is processed LAST simply
replaces everything, silently discarding the other person's changes.

## 2. Yjs's real, documented integration story (checked 2026-08-15)

**Editor binding:** `y-monaco`, an official, actively maintained binding
from the Yjs team itself (github.com/yjs/y-monaco), specifically for
Monaco - the exact editor LiveCollab is built on (VS Code/Code-OSS is
Monaco). Real API, confirmed from the official docs and README:

```js
const binding = new MonacoBinding(
  yText,                    // the Yjs shared text type
  editorModel,               // a real monaco.editor.ITextModel
  new Set([editor]),          // editors to bind
  provider.awareness          // presence/cursor info
)
```

Per the docs: "The MonacoBinding automatically synchronizes changes
between the editor and the Yjs document, handling all the complexity
of collaborative editing." This is a real, existing, maintained library
doing the hard character-level merge work - not something LiveCollab
would need to hand-write.

**Transport ("provider"):** confirmed via Yjs's own official docs -
"Yjs is truly network agnostic... Since the 'network provider' is
clearly separated from Yjs and the various integrations, it is pretty
easy to switch to different providers." There is an official tutorial
("Custom Provider") showing exactly how to build one: listen for
`update` events on the Yjs document, relay the update bytes over
whatever transport you choose, apply incoming update bytes back into
the document. `y-websocket` (Yjs's own reference server) is ONE option,
not a requirement - a provider can be built on top of ANY existing
transport, including our existing Socket.io connection.

**Robustness property, directly relevant to LiveCollab's real history
tonight:** Yjs document updates are officially documented as
"commutative, associative, and idempotent... Yjs doesn't care in which
order document updates are applied, as long as all changes are applied
eventually." This is a real, meaningful guarantee given how much of
tonight's session dealt with reconnects, out-of-order messages, and
socket race conditions (Door #1's nonce-based dedup fix exists
specifically because of this class of problem) - Yjs is built to
handle exactly this robustly, by design, not as an afterthought.

**Presence:** `provider.awareness` is Yjs's own, separate, documented
system for cursor/presence data - conceptually the same role our
existing `cursor:update`/`room:members` events already play.

## 3. The decision: NOT a binary "replace everything" vs. "run two
   independent systems" - a precise, evidence-based split

Given the evidence above, framing this as "replace Socket.io entirely"
vs. "run Socket.io and Yjs as two separate systems that have to agree"
is a false choice. The real, correct split, based on what each system
is actually good at and how Yjs's own architecture is designed to be
used:

**KEEP Socket.io for:** room membership, presence events, chat, file-
tree broadcasts, and - critically - AS THE TRANSPORT ITSELF. A custom
Yjs provider can be built on top of the existing Socket.io connection
(per the official "Custom Provider" tutorial's pattern), meaning no new
server infrastructure, no new connection, no second system to keep in
sync with the first. Socket.io keeps doing exactly what it already does
well.

**REPLACE specifically:** the `code:change` full-file-overwrite content
sync mechanism (`emitCodeChange`, the `code:change` listener, and the
`pushEditOperations` full-range-replace in
`livecollabEditorContribution.ts`) with Yjs + `y-monaco`'s
`MonacoBinding` + a custom Socket.io-based provider. This is the
specific, narrow piece Yjs is actually designed to solve - correct,
automatic, character-level merge conflict resolution - handled by a
real, maintained library, not hand-rolled.

**Door #1's nonce-based dedup fix likely becomes unnecessary** once
this lands - Yjs's own update model is idempotent by design (applying
the same update twice is a documented no-op), which is a more robust,
built-in version of what the nonce fix was manually working around.
This should be RE-TESTED once Yjs lands, not assumed - if the nonce
fix is still needed for some other reason, keep it; if it's genuinely
redundant, remove it as cleanup, not before.

## 4. What still needs real, hands-on verification before full build-out

This design doc answers the architectural question with real evidence.
It does NOT yet answer, and these need real testing, not more research,
before the full implementation:
- Exact persistence model: when does Yjs's in-memory CRDT state get
  written to the database, and what's authoritative if the server
  restarts - Yjs's live state, or the last DB write? (Flagged in the
  original roadmap item, still unanswered, needs a real prototype to
  test against, not just documentation reading.)
- Real performance/behavior of a Socket.io-based custom provider under
  the same real-world conditions this project has already stress-tested
  everything else against (reconnects, multiple rapid edits, etc.).
- How the custom provider interacts with LiveCollab's existing room-
  join/leave lifecycle (a Yjs document presumably needs to be created/
  torn down in sync with a room being joined/left, similar to how
  `leaveCurrentRoom()`/`_joinRoom()` already manage other state).

## 5. Real integration attempt (2026-08-15/16): the loading mechanism, resolved

Wired the minimal viable integration into the real editor (getOrCreateYjsDoc,
MonacoBinding, the _isApplyingYjsChange guard - all as planned above).
First attempt used a plain `import * as Y from 'yjs'`, which compiled
clean but was WRONG - this codebase requires third-party npm packages to
load via `importAMDNodeModule` (confirmed by comparing to real, working
code: markedKatexSupport.ts's use of this exact pattern for 'katex').
Rewrote both files to use it correctly (type-only references for
compile-time types, real async-loaded+cached module access for
runtime), compiled clean at baseline (37).

**Live two-machine test with a real second user (2026-08-16) failed**:
`Uncaught ReferenceError: require is not defined`, then `Cannot read
properties of undefined (reading 'Doc')` at getOrCreateYjsDoc. Root
cause fully traced with real evidence, not guessed at a second time:

- `importAMDNodeModule` calls `AMDModuleImporter.INSTANCE.load(...)` -
  confirmed by reading its actual implementation in `src/vs/amdX.ts`.
  This is a genuine AMD script loader; the target file MUST use AMD's
  `define()` semantics (or a UMD wrapper that detects and uses AMD).
- Checked EVERY real, non-test file in this codebase that successfully
  calls `importAMDNodeModule` (16 total, `grep -rln` confirmed). Spot-
  checked three independently: katex, and an @xterm addon
  (`addon-search`). Both start with the EXACT SAME UMD wrapper pattern:
  `!function(e,t){"object"==typeof exports...`. This is universal, not
  situational - every successful use in this codebase loads a file the
  UPSTREAM PACKAGE MAINTAINERS shipped as UMD.
- Checked yjs's actual shipped files directly: `dist/yjs.cjs` is pure
  CommonJS (`require('lib0/observable')` on line 1, no wrapper -
  exactly matching the crash). `dist/yjs.mjs` is pure native ESM
  (`import { ObservableV2 } from 'lib0/observable'`, also no wrapper).
  Searched the ENTIRE yjs package for the UMD-detection string
  (`define.amd`) - zero matches anywhere in the package.

**Conclusion, confirmed not assumed: yjs, y-monaco, and yjs's own
`lib0` dependency do not ship a UMD build. This codebase has no
existing pattern for loading a package in this situation, because
every other third-party dependency it currently loads this way happens
to already ship one.** This is a real, structural gap, not a wrong file
path - trying a different path inside node_modules/yjs will not fix
this; no such file exists there.

**The real fix, scoped and ready to build next session:** bundle yjs +
lib0 + y-monaco into our own UMD-wrapped output file(s) using esbuild,
the same way this project already vendors other third-party code (see
`socket.io.esm.min.js` and the Sentry renderer bundle, both already
committed under `src/vs/workbench/contrib/livecollab/browser/vendor/`
- this is an established, already-proven pattern in this exact
project, not a new one). Commit the bundled output(s) to that same
vendor directory, then update the `importAMDNodeModule` calls in
`livecollabService.ts` and `livecollabEditorContribution.ts` to point
at the new vendored files instead of raw `node_modules` paths.

**Discipline note for next session:** the first live test failed with
a real user waiting. The correct response, per this project's own
standing practice all session, is not a second rushed guess under the
same pressure - it's understanding the failure completely (done above,
with real evidence at every step) and building the actual fix
carefully, separately from live-test conditions. That is what happens
next session, not this one.

## 6. Bundling attempt (2026-08-16): a second, deeper real blocker found

Corrected course from section 5's plan mid-session: discovered this
project ALREADY has a simpler, proven pattern than UMD/AMD for vendoring
third-party code - `socket.io.esm.min.js` (already in the same vendor
directory) is genuine native ESM (real `export{}` statement, confirmed
by reading its actual last bytes), loaded via a PLAIN dynamic
`import()` in livecollabService.ts's own existing code - no
importAMDNodeModule involved. This is simpler and already proven
working in this exact file. Switched the plan to bundle yjs+y-monaco
as native ESM instead of UMD.

Real dual-package-hazard risk identified and designed around BEFORE
bundling: bundling yjs and y-monaco as two SEPARATE files would give
each its own independent copy of yjs's code, which could break
instanceof-style identity checks between a Y.Doc created by one copy
and consumed by the other. Fix: single combined entry point
(`vendor/_livecollab-yjs-entry.mjs`, committed) re-exporting both under
one shared module, ensuring only one copy of yjs exists in the final
bundle.

**Running the actual esbuild bundle surfaced a real, second, deeper
blocker**: `y-monaco/src/y-monaco.js` imports
`monaco-editor/esm/vs/editor/editor.api.js` and `y-protocols/awareness`,
neither of which exist as real, resolvable packages in this project
(we don't depend on the standalone `monaco-editor` npm package at all -
this VS Code fork IS Monaco, structured completely differently, as its
own internal `vs/editor/*` module tree, not a separate npm package).

Checked whether the `monaco` import is safely markable as a compile-
time-only type reference (which would make this a non-issue) or a
genuine runtime dependency: CONFIRMED GENUINE RUNTIME USAGE via direct
grep of y-monaco's source - real calls like
`monaco.Selection.createWithDirection(...)`, `new monaco.Range(...)`,
`monaco.SelectionDirection.RTL`. Not just JSDoc types; this needs a
real, working object at runtime.

Checked whether this codebase already exposes a global `monaco` object
matching what y-monaco expects (which would let us mark the import
external and point it at that global): found exactly ONE such
exposure, `globalThis.monaco = createMonacoBaseAPI()` in
`editorWebWorker.ts` - but this is INSIDE A WEB WORKER context, a
separate thread from where our actual editor code
(livecollabEditorContribution.ts) runs. No equivalent exists in the
main renderer/workbench thread. Ruled out as a ready-made fix, not
abandoned as a direction - see below.

**Real, promising lead for next session, found via evidence not
guessed**: checked `createMonacoBaseAPI()`'s actual implementation in
`src/vs/editor/common/services/editorBaseApi.ts`. It builds an object
with EXACTLY the shape y-monaco needs - real `Range`, `Selection`, and
`SelectionDirection` properties, using this codebase's own actual,
real editor classes (the SAME ones our real editor instances already
use, confirmed: `Range: Range` and `Selection: Selection` directly
reference the imports at the top of that same file, not a separate,
incompatible copy). This function is exported and callable from our
own code - it is simply not currently invoked anywhere in the main
thread, only inside the worker file.

**The real, concrete plan for next session**: call
`createMonacoBaseAPI()` from our own code in the main thread (likely
from `livecollabEditorContribution.ts`, before the bundle's code
executes), and make its result available to the bundled y-monaco code
in place of the unresolvable `monaco-editor` npm import - either via a
small shim module that esbuild's `--external` + `--alias` resolves the
import path to, or by setting `globalThis.monaco` in the main thread
before the bundle loads (matching the SAME pattern the web worker file
already uses, just in a different thread). `y-protocols/awareness`
needs a similar check - either install it as a real, small dependency
(it is a real, separate npm package, not something requiring VS Code's
internal APIs) and bundle it in normally, or confirm it can be safely
stubbed since this minimal first integration doesn't use awareness/
cursor features yet.

**Discipline held again**: stopped here rather than guessing through
an increasingly long, unverified chain (bundle → mark external → shim
a global → hope the shape matches → hope awareness stubs safely) after
already having one live-test failure this session. Real evidence
gathered at each step; the actual fix is deferred to a session with a
clear head, not attempted under continued pressure.

## 7. Real bundle works, live test (2026-08-19) finds a third real blocker: no initial-state sync

The compile-and-loading fix from section 6 genuinely worked - packaged
and launched, the exact crash from the two-machine test (`require is
not defined`, `Cannot read properties of undefined (reading 'Doc')`)
is CONFIRMED GONE. Room join, folder attach, and file tree broadcast
all worked normally in solo testing. Typing alone in a file also
worked cleanly.

**Real two-machine re-test (Emmanuel + Maureen, corrected build on
both machines) surfaced a genuine, different, third blocker**, found
before the actual concurrent-typing test could even begin: Emmanuel
typed "Hello World" into a file BEFORE inviting Maureen. Maureen
joined, her Explorer correctly showed the same folder/file (the
existing, unrelated file-tree broadcast mechanism), but her EDITOR
showed the file as EMPTY - the "Hello World" Emmanuel typed before she
joined was not there.

**Root cause confirmed with the exact line of code, not guessed**:
checked `y-monaco`'s real source directly. Its `MonacoBinding`
constructor's initial sync logic:

```js
const ytextValue = ytext.toString()
if (monacoModel.getValue() !== ytextValue) {
  monacoModel.setValue(ytextValue)
}
```

Maureen's `getOrCreateYjsDoc(fileId)` call creates a BRAND NEW,
EMPTY `Y.Doc` for this file (she has never received any `yjs:update`
for it - Emmanuel's edit happened before she connected, so the
`doc.on('update', ...)` broadcast in `livecollabService.ts` fired with
nobody listening). Her editor's REAL content ("Hello World") was
correctly loaded by the OLD, separate virtual-filesystem mechanism
(`livecollabFileSystemProvider.ts`'s `onFileContent`/
`requestFileContent`, unrelated to Yjs). But the moment `MonacoBinding`
attaches, the code above runs: `ytext.toString()` is `""` (her empty
doc), `monacoModel.getValue()` is `"Hello World"` (correctly loaded),
they don't match, so `monacoModel.setValue("")` FORCES the editor back
to empty - the empty Yjs doc overwrites the real content.

**The real, structural gap this exposes**: the current implementation
only relays LIVE, FUTURE Yjs updates (`doc.on('update', ...)` firing
after a peer is connected and listening). There is no mechanism at all
for a newly-created `Y.Doc` to learn about content that existed before
it was created. This is a broader, more urgent version of the open
item already flagged in section 4 ("what's authoritative if the server
restarts") - the same underlying question (where does a Y.Doc's
correct starting state come from?) applies just as much to a normal
peer joining an active room as it does to a server restart.

**Real options for next session, not yet decided or attempted**:
- Seed a newly-created `Y.Doc` with the existing content (from the
  SAME file-content source the old system already uses) via
  `ytext.insert(0, existingContent)` BEFORE the `MonacoBinding` is
  created, so the initial sync check above finds them already equal.
  Real open question: what if two peers create the Y.Doc for the same
  file at nearly the same time - which one's seed wins, and could this
  race with a genuine concurrent edit?
- Have the SERVER (not each client) own one authoritative Y.Doc per
  file/room, sending its current full state (`Y.encodeStateAsUpdate`)
  to any newly-joining client, rather than each client creating its
  own independent `Y.Doc` locally. This is a more correct long-term
  architecture but a bigger change than the minimal-first-integration
  scope this session was working within.
- Something narrower: only create/bind the `Y.Doc` AFTER the old
  system's real content has loaded, and seed it from that real content
  at creation time (a specific version of the first option).

**Discipline held a third time this session**: found via a real live
test with a real second person, root-caused with the exact offending
line of code (not inferred or guessed), and the actual fix deferred to
proper design work rather than patched live under pressure. Two
crashes found and fixed correctly earlier this session; this is a
different class of problem (silent data-loss risk, not a crash) found
by the same disciplined testing approach.

## 8. Fourth blocker fixed, fifth (different, older-system) blocker found before it could be cleanly verified

Section 7's seed-race gap: fixed with `trySeedYjsDoc`, wired into
`onCodeChange`, matching the mechanism that empirically "fixed" it by
accident in the prior test. A separate, more serious gap was ALSO found
and fixed in the same session: Yjs docs were keyed ONLY by bare
filename (confirmed: `model.uri.path.split('/').pop()`), never
room-scoped, and NEVER cleared anywhere (confirmed: zero calls to
`_yjsDocs.clear/delete` existed). A filename reused across a different
room later in the same running session silently inherited the old
room's stale content - confirmed by a live test where leftover
characters from an unrelated earlier test appeared in a brand-new
room's file sharing the same filename. Fixed: both `_yjsDocs` and
`_yjsDocsSeeded` are now cleared in `leaveCurrentRoom()`, calling the
real `Y.Doc.destroy()` method (confirmed via yjs's own source, not
assumed by analogy).

**Re-test with a fresh app restart on both machines (2026-08-20)
surfaced a FIFTH, different, real bug - before the Yjs fix itself
could be cleanly verified.** Maureen's Explorer showed MULTIPLE
"Shared Room" folder entries stacked up simultaneously (confirmed via
a real screenshot, not a guess), despite both her and Emmanuel
confirming they were in the exact same room (matching Room ID,
`room-e95...`, checked directly in the Members panel on both sides).
No "Hello World" appeared in any visible `test.js`.

**This is NOT a Yjs bug** - it lives in the older folder-attachment
system (`livecollabFolderContribution.ts` / the real-folder
`updateFolders` mechanism used throughout tonight's earlier Stage 2
work), not anything touched in tonight's Yjs fixes. Real, working
theory, NOT yet confirmed with code-level evidence: multiple room
folders are accumulating in Maureen's workspace across the several
room-join/leave cycles tonight's live testing required, rather than
being cleanly replaced each time - likely a gap in the SAME
folder-removal logic fixed earlier this project (see the Stage 2
milestone commit `eba114ba262` for the original real-folder-removal
fix) that either doesn't cover this specific sequence of events, or
has a separate, new edge case.

**Discipline held, deliberately, under real pressure**: stopped here
rather than chasing a fifth, newly-discovered, different-system bug
live, late, with two tired people. The Yjs seed/room-isolation fixes
in this section are real, committed, and compile clean - they are
simply NOT YET cleanly verified live, because THIS separate,
pre-existing folder-duplication bug got in the way of a clean test
before they could be. Next session's real first task: root-cause the
folder-duplication bug with real evidence (likely starting by tracing
every real call site of `updateFolders` and `populateFromTree`
across a full multi-room-join sequence), fix it, THEN re-attempt the
Yjs live verification that this session's fixes still need.

## 9. Folder-duplication bug: two plausible theories ruled out with real evidence, diagnostic added for next session

Traced the two most likely explanations for the multiple stacked
"Shared Room" folder entries with real evidence, not assumption:

**Theory 1 - the room-leave folder removal only cleans up the REAL
folder, not the virtual one.** Confirmed real: `onRoomLeft`'s cleanup
(`updateFolders(realFolderIndex, 1)`) explicitly filters for
`f.uri.scheme !== LIVECOLLAB_SCHEME` - it only ever removes the real
(file://) folder, never the virtual (livecollab://) one added by the
`onFileTree` handler. This asymmetry is real and worth fixing
regardless, but does NOT by itself explain repeated duplication - see
Theory 2.

**Theory 2 - multiple live instances of LiveCollabFolderContribution,
each with independent state.** Checked and RULED OUT with real
evidence: `grep` confirms this contribution is registered exactly
once (`registerWorkbenchContribution(..., LiveCollabFolderContribution, ...)`,
a single call), consistent with this project's own persistent-workbench
architecture (the whole point of Phase 2 was to never reload/recreate
the workbench across room switches). Also confirmed the
`_virtualFolderAdded` flag itself never resets anywhere (`grep`: set
in exactly two places, both inside the same block, no reset). Given
both of these, straightforward static reading says this exact code
path should only ever add ONE virtual folder for the entire app
session - directly contradicting the observed multiple-entries bug.

**Conclusion: the real cause is not yet confirmed.** Static code
reading has reached its useful limit here - the evidence available
this way actively contradicts what's being observed, meaning either
the analysis above is wrong in a way not yet found, or the duplicates
come from an entirely different, not-yet-located code path. Rather
than keep guessing without new information, added temporary,
targeted diagnostic logging (`[FOLDER-DUP-DIAG]`) directly at this
exact check - logs the flag's state and whether the add actually runs,
every time `onFileTree` fires. Not yet run - needs a real live
multi-room test (join, leave, join a different room) with this log
active to see the ACTUAL runtime behavior, which will show directly
whether this specific code path really does run more than once
(meaning the static analysis missed something) or whether the true
cause lies elsewhere entirely.

**Real next session task, precisely**: run a live test with this
diagnostic active, read the actual log output, and let real behavior
- not more theorizing - determine where to look next. Once the true
mechanism is found and fixed, also fix Theory 1's real, confirmed
asymmetry (virtual folder never removed on leave) regardless of
whether it turns out to be the primary cause, since it's a genuine gap
either way.

## 10. Session close-out: real symptom confirmed visually, console log capture unreliable tonight

Real, directly-observed symptom (no console needed - seen with the
user's own eyes): entering Room B immediately showed Room A's real
folder and file already present, with the Room ID and Members panel
both empty. This is a genuinely serious, real bug - room state is not
isolating correctly between rooms in at least this scenario. It has
NOT yet been root-caused with code-level evidence.

**Console log capture was unreliable this session and did not produce
usable diagnostic data.** Two separate export attempts were made:

- First export: zero matches for `FOLDER-CLEANUP-DIAG` (the new,
  correctly-targeted diagnostic from section 9) despite the bug being
  reproduced. Also zero matches for basic `[LiveCollab]` messages that
  reliably appeared in every earlier session tonight - strongly
  suggesting this export was missing real output entirely (a DevTools
  console log-level filter is the likely cause, not that nothing
  happened), rather than genuine absence of activity.
- Second export: confirmed to be the DASHBOARD console (identifiable
  via `[LC-MODULE]`/`dashRender` messages), not the workbench one
  where the folder-cleanup diagnostic actually lives.

**One real, separate, useful finding did come out of the dashboard
export**: the dashboard's socket connection is repeatedly disconnecting
and reconnecting - many cycles of `dashboard socket disconnected` /
`dashboard socket connected` - while sitting idle on the dashboard
screen, not during any room activity. This is a genuine, real
instability worth investigating on its own, and plausibly related to
tonight's confusing symptoms (a connection dropping and reconnecting
at the wrong moment could easily produce stale or missing data - empty
Room ID/Members panels are exactly the kind of symptom a connection
gap would produce).

**Discipline note**: rather than keep asking for more DevTools
exports/settings adjustments with unreliable results this late in a
long session, stopped here and recorded what's actually confirmed
(the real, visually-observed bug; the connection-instability finding)
rather than continue troubleshooting the LOGGING TOOLING itself
indefinitely. The [FOLDER-CLEANUP-DIAG] diagnostic added in section 9
is still real and still in place - it simply hasn't produced a clean,
verified data capture yet.

**Real next session tasks, in order**:
1. Investigate the dashboard socket disconnect/reconnect loop first -
   it's a real, confirmed instability that could be a root cause (or
   contributing factor) for multiple symptoms seen tonight, not just
   folder duplication/isolation.
2. Before attempting another live test, confirm DevTools console
   capture actually works cleanly - verify a simple, known message
   (e.g. add a fresh, obvious one-time test log) shows up correctly in
   an exported file BEFORE relying on it for real diagnosis again.
3. Once console capture is confirmed reliable, re-run the room A/B
   isolation test with the existing [FOLDER-CLEANUP-DIAG] logging
   active, specifically capturing the WORKBENCH console (not the
   dashboard one), to get the real before/after folder-list evidence
   this session was trying to obtain.

## 11. Dashboard reconnect loop: real cause found - a 60-second Clerk token lifetime

Traced the dashboard socket's repeated disconnect/reconnect cycle to
its actual source code, not guessed. Real file location, worth noting
since it's genuinely separate from everything else touched this
session: `src/vs/code/electron-browser/workbench/livecollab-bootstrap.html`
(the dashboard is a standalone HTML/JS page, not part of the
TypeScript-compiled `src/vs/workbench/contrib/livecollab/` code the
rest of tonight's work lived in).

Confirmed: `lcConnect()` mints a fresh auth token (`lcMintToken()`, via
the same `vscode:livecollab-mint-token` IPC call traced earlier this
project) on every connection AND on every reconnection (it's passed as
the socket.io `auth` callback, which re-runs on each reconnect
attempt). The socket is configured with `reconnection: true`, so any
disconnect is followed by an automatic reconnect using a freshly-minted
token.

**Real root cause, confirmed by decoding an actual JWT from tonight's
own console output**: the Clerk session token has an exact 60-second
lifetime (`exp - iat = 60` seconds, verified by direct decode, not
approximated). This is Clerk's own token design (short-lived session
tokens, meant to be refreshed frequently), not something this project's
own code chose. This directly explains the repeating
`disconnected`/`connected` pattern seen in tonight's dashboard console
export - it lines up with a roughly-60-second cycle.

**Not yet confirmed**: whether the disconnect is caused by the SERVER
actively dropping the connection once it detects the token has expired
(most likely, given standard JWT-auth patterns), or something else.
Also not yet confirmed: whether this SAME mechanism is responsible for
tonight's more serious room-isolation symptom (Room B showing Room A's
content, empty Room ID/Members) - it's a real, plausible contributing
factor (a connection dropping mid-room-switch could easily produce
stale/empty UI state), but this is not yet proven as that bug's root
cause, only a credible, evidence-backed lead.

**Real, concrete next-session fix candidate**: proactively refresh the
token and reconnect BEFORE the 60-second expiry (e.g. a timer that
re-authenticates a few seconds early), rather than only reacting AFTER
a disconnect already happened. This would eliminate the repeated
disconnect cycle entirely rather than just handling it gracefully
after the fact. Real open question to resolve first: does the ACTUAL
room-workbench socket (in `livecollabService.ts`, separate from this
dashboard one) have the SAME 60-second-token vulnerability, and if so,
could a token expiring mid-room-session explain the room-isolation
symptom directly? This needs to be checked with real evidence, not
assumed, before writing a fix.

## 12. The workbench socket has the SAME 60-second-token vulnerability, with a real auto-rejoin race

Checked the real, actual `connect()` method in `livecollabService.ts`
(not the dashboard's separate code) directly - confirmed it uses the
identical pattern: the socket's `auth` callback re-mints a fresh token
via `refreshToken()` on every connection AND every reconnection. Given
section 11's confirmed 60-second Clerk token lifetime, this socket is
subject to the exact same repeated disconnect/reconnect cycle - this
directly explains a pattern already seen and logged as unexplained
EARLIER this project (`socket disconnected, reason: transport close` /
`socket connected` / `reconnected - re-joining room` repeating in the
workbench console).

**Real, structurally significant detail found in the same code**: on
every `connect` event, if `this._roomId` is currently set, the code
automatically re-emits `room:join` for that room ID - this is
INTENTIONAL, documented behavior (comment references issue #19,
ensuring a reconnected socket gets re-subscribed to its room
server-side). This is correct behavior in isolation.

**Real, concrete hypothesis connecting this to the room-isolation bug
observed this session** (Room B showing Room A's content, empty Room
ID/Members panel): if an automatic reconnect (triggered by the
60-second token expiry, NOT by user action) happens to fire during or
immediately around a genuine, user-initiated room switch (leaving
Room A, joining Room B), there is a real, plausible race between two
things trying to control the SAME `this._roomId`/join state at once -
the deliberate switch, and the automatic reconnect's own re-join
logic (which could fire using a STALE `_roomId` value if the timing
lines up wrong). This is NOT yet confirmed with runtime evidence -
it's a genuinely stronger, more precise, code-evidenced hypothesis
than before, not a proven root cause.

**Real next-session task, concrete and ordered**:
1. Confirm whether this race is real: reproduce the room A/B
   isolation bug WHILE deliberately watching the clock - if it
   reliably happens (or happens MORE often) when a room switch occurs
   close to a 60-second boundary since the last connect/reconnect,
   that's real, strong evidence for this exact mechanism.
2. If confirmed, the real fix is the SAME one proposed in section 11
   for the dashboard: proactively refresh the token and reconnect
   BEFORE the 60-second expiry, removing the reactive
   disconnect-then-reconnect cycle (and its associated auto-rejoin
   race) entirely, rather than trying to make the reactive path safe
   under racing conditions.
3. Regardless of whether this specific race is confirmed, the
   60-second reactive reconnect cycle itself is real, confirmed, and
   worth fixing on its own merits (it's real, unnecessary network/auth
   overhead every single minute, socket or no socket).

## 13. Real, confirmed success: proactive token refresh eliminates the workbench socket disconnect cycle

Live test result, real evidence not assumed: exported the workbench
console after joining a room and letting it sit idle for several
minutes. Confirmed via direct grep: ZERO occurrences of "socket
disconnected" anywhere in the entire log. The socket connected exactly
once, joined the room once, and stayed connected throughout - the
repeating disconnect/connect/re-join cycle observed in every earlier
session is genuinely gone for the room-workbench socket.

This confirms the section 11-12 hypothesis was correct: the 60-second
Clerk token lifetime WAS the real, primary cause of the repeated
disconnects, not some other, separate instability. The proactive
45-second refresh (section 12's fix) genuinely solves it.

**Real, remaining open items**:
- The DASHBOARD socket (separate file,
  `livecollab-bootstrap.html`, NOT touched by this fix) still shows
  the same repeating disconnect/connect cycle - confirmed in the same
  test round, a separate log from the dashboard console. This is
  EXPECTED, not a failure - the same fix needs to be applied there
  too, using the same pattern (proactive refresh timer), as a
  follow-up.
- Whether this also resolves or reduces the room-isolation bug (Room B
  showing Room A's content) is not yet directly re-tested - the
  hypothesized race depended on a reconnect firing during a room
  switch, which should now be far less likely with disconnects
  eliminated, but this needs its own real confirmation via a fresh
  A/B room-switch test, not assumed from this result alone.

## 14. Both sockets confirmed fixed - the disconnect-loop thread is closed

Live re-test, real evidence: exported both consoles after applying the
same proactive-refresh fix to the dashboard socket. Dashboard log: 5
lines total, connected once, zero disconnects. Workbench log: 1040
lines, zero disconnects (confirmed via direct grep on both files, not
skimmed). Both sockets - the two separate places this bug existed -
are now confirmed fixed with real data across two independent test
rounds.

This closes the disconnect-loop investigation from sections 11-13.
The real, remaining, still-open thread from this whole investigation
is whether this also resolves the original room-isolation symptom
(Room B showing Room A's content, empty Room ID/Members) - that was
always a hypothesis connected to this bug, not proven itself. Real
next session task: re-run the original room A/B switching test now
that both sockets are stable, and confirm directly whether that
symptom is gone, unchanged, or improved.

## Next step

Build a small, isolated prototype (same discipline as Stage 1's overlay
test earlier in this project): y-monaco + a minimal custom Socket.io
provider, in isolation, proving real two-client character-level merge
works correctly before touching the real `code:change` production path.
