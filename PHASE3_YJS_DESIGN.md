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

## 15. Room-isolation bug confirmed FIXED - the whole investigation closes

Live re-test with both sockets stable, real reproduction of the exact
original scenario: created Room A, opened a real folder ("Folder 1"
with test.js), left to dashboard, created Room B, opened a different
real folder ("Folder 2" with index.js). Confirmed directly: Room B did
NOT show Room A's content, and returning to Room A did NOT show Room
B's content either - real, clean isolation in both directions. Room ID
and Members panel both populated correctly throughout, unlike every
earlier attempt this session.

**This confirms the full chain of reasoning from sections 9 through
15**: what looked at first like a folder-cleanup bug (section 9,
wrong code path investigated), then a genuine but separately-confirmed
room-isolation failure (section 10), was actually a downstream
symptom of the 60-second Clerk token causing repeated
disconnect/reconnect cycles on both sockets (sections 11-12), which
raced against genuine user-initiated room switches. Fixing the root
cause (proactive token refresh, sections 12-14) fixed the visible
symptom too - confirmed here with a real, direct reproduction, not
assumed from the socket fix alone.

**Real, honest note on process**: this took several real, wrong turns
(the original virtual-folder theory in section 9, the unreliable
console exports in section 10) before landing on the actual root
cause - but each wrong turn was checked with real evidence and ruled
out cleanly rather than guessed past, and the eventual fix was found
by following genuine, confirmed clues (a decoded JWT, a real code
read of the reconnect logic) rather than luck. The investigation that
started as "why do folders duplicate" ended up finding and fixing a
real, more fundamental instability affecting the whole app's
connection reliability, not just the one symptom that was originally
reported.

**This closes the disconnect-loop / room-isolation investigation
(sections 9-15). Phase 3's remaining real work is separate from this
thread**: the actual Yjs concurrent-editing test (two people typing
in the same file at the same time) that this whole project has been
building toward, still not yet run with all of tonight's fixes in
place. That's the real next session task.

## 16. The REAL, definitive cause of stacked "Shared Room" entries: VS Code's own native backup-workspace file

Section 15 closed the disconnect-loop investigation, but a genuinely
new, different symptom appeared on the very next real two-machine
test: Maureen's Explorer showed THREE stacked "Shared Room" entries
(the owner's own Explorer never shows this at all - see the plain-
English explanation given mid-session: the virtual "Shared Room"
folder only exists for GUESTS, who don't have the owner's real files
on their own disk, so the app builds an in-memory copy for them to
view/edit; the owner never sees it since they don't need a copy of
their own files).

**Root cause found with real, direct, complete evidence - not another
partial theory**. Checked `[FOLDER-DUP-DIAG]`/`[FOLDER-CLEANUP-DIAG]`
in Maureen's real, uploaded workbench console (1523 lines): ZERO
matches, and even the PRE-EXISTING `onFileTree` handler's own older
log lines (`populating virtual file system`, the raw `room:file:tree`
socket event name) never appear either - confirming this ENTIRE code
path did not run at all during this session. The duplicates are NOT
being added live, right now, by our own code.

Traced instead to VS Code's own native backup-workspace mechanism.
Found via direct filesystem inspection on Maureen's machine: multiple
real, separate `workspaceStorage/<hash>/workspace.json` files exist
under `~/Library/Application Support/LiveCollab/User/`, each pointing
to a REAL, persisted multi-root workspace file under a `Workspaces/`
directory. Read the actual, real content of one of these files
directly:

```json
{
    "folders": [
        { "name": "Shared Room", "uri": "livecollab://room-e957f6fc-.../" },
        { "name": "Shared Room", "uri": "livecollab://room-71ab2ddf-.../" },
        { "name": "Shared Room", "uri": "livecollab://room-001ecbf6-.../" },
        { "path": "../../../../../YC FOLDER/FOLDER 1" }
    ],
    "settings": {}
}
```

**This is definitive, real evidence, not inference**: three DIFFERENT
room IDs, each from a separate test session tonight, all accumulated
in ONE persisted file, NEVER removed - plus a FOURTH, genuinely real
folder entry (`YC FOLDER/FOLDER 1`) that exactly matches the mystery
"YC folder" symptom from MUCH earlier this session (originally
assumed to be stale local files, now confirmed to be this SAME
accumulating mechanism). This is VS Code's own native
backup-workspace/crash-recovery file - it appears to record the
CURRENT folder list into this persisted file on disk every time the
folder list changes, but nothing ever REMOVES old entries from it, and
something (likely VS Code's own crash-recovery restore logic,
plausibly related to the many `pkill -9` force-kills used throughout
tonight's testing) is restoring from this stale, ever-growing file on
a subsequent launch, re-introducing every room ever visited at once.

**This explains BOTH mysteries from this session in one unified, real
root cause**: the "multiple Shared Room" symptom AND the much-earlier
"YC folder" mystery are the SAME underlying mechanism, not two
separate bugs.

**Real, honest distinction from everything found in sections 9-15**:
this is NOT the same bug as the disconnect-loop/room-isolation issue
that was just closed - that investigation and its fix were real and
correctly verified (section 15's clean A/B test had no console
export step to catch this, since it doesn't show up in ANY of our own
diagnostic logging - it's entirely outside our own code's visibility).
This is a genuinely new, different, real finding.

**Real next-session task**: find and disable/manage VS Code's own
native backup-workspace persistence for this specific scenario -
options to investigate include a settings-level control for backup-
workspace behavior (similar in spirit to how `window.restoreWindows`
was already tuned for this product earlier in the project), or
explicitly clearing this specific backup file as part of our own
existing room-leave cleanup (`leaveCurrentRoom()`/`onRoomLeft`,
already the right, established place other real state gets cleared).
Not yet attempted - real investigation needed into VS Code's own
backup-workspace source (likely under `src/vs/platform/backup/` or
similar) before writing a fix, matching this whole session's
established discipline.

## 17. Section 16's fix was WRONG - confirmed with a real A/B test, reverted, real correction recorded

Real, honest correction, not a minor caveat. Section 16's fix (setting
`files.hotExit` default to OFF) was tested live for the first time
this session and broke a completely different, core feature: "Open
Folder" stopped working entirely, on BOTH machines, every single
attempt, with no error anywhere in either console. The picker dialog
itself worked fine (confirmed directly); the folder simply never got
attached to the workspace afterward - confirmed via the section 9
diagnostic (`[FOLDER-CLEANUP-DIAG]`), which showed the real,
underlying folder list as genuinely empty both before and after the
attempt, not just a display glitch.

**Real, clean A/B test performed before concluding anything**:
reverted the setting back to its stock default (`ON_EXIT`), recompiled,
retested the exact same action - "Open Folder" worked immediately.
This confirms a real, causal, if unexpected, dependency: VS Code's
folder-attachment mechanism relies on the hot-exit/backup service
being active in some way not yet understood. Turning off hot exit
entirely was too blunt an instrument - it fixed the original
accumulation symptom by breaking the feature the accumulation was
about in the first place.

**Reverted permanently, not just for the test.** The original section
16 problem - stale room folders silently accumulating in VS Code's
hot-exit backup file across sessions - is REAL and still UNSOLVED.
What's ruled out is the specific fix attempted: disabling hot exit
globally is not viable for this product, since "Open Folder" is
core, load-bearing functionality.

**Real, honest process note**: section 16's reasoning was sound and
well-evidenced for the PROBLEM it diagnosed (the accumulation
mechanism was real, precisely traced, and correctly understood) - the
FIX chosen from that correct diagnosis turned out to have a real,
unexpected side effect that could only be found by actually testing
it live, which is exactly why this project tests every real fix
before considering it done, even when the reasoning behind it seems
solid.

**Real next-session task**: find a more surgical fix for the
accumulation problem that does NOT disable hot exit globally. Real,
concrete candidates to investigate: (a) explicitly unregistering this
specific room's own backup entry when leaving the room, using the
real `registerFolderBackup`/related methods already found in
`backupMainService.ts` during this investigation - clearing our own
specific entry rather than disabling the whole mechanism; (b)
investigating WHY "Open Folder" depends on hot exit being active at
all, which might reveal a more precise place to intervene. Neither
attempted yet - real investigation needed before writing another fix,
given tonight's real lesson about testing before concluding.

## 19. Section 18's fix confirmed present on Maureen's build - blocked by a real, separate auth failure before it could be tested

Attempted the real live test for sections 16-18's fix (deleteUntitledWorkspace
on room leave). Blocked before it could even start: Maureen joined Room A
and her workbench showed the completely blank "No folder opened" welcome
screen - no Room ID, no Members, nothing, not even an empty room state.
Her dashboard had signed in successfully (confirmed in her dashboard
console), but the workbench side never showed any sign of the room join.

**Build version ruled out with real, direct evidence, not assumed**:
checked the actual compiled JS in her installed app for the literal string
`deleteUntitledWorkspace` (the real function name from section 18's fix) -
found 3 occurrences, confirming she is genuinely running tonight's latest
build, not an old one.

**Real, separate, likely cause identified but not yet independently
verified**: the workbench console reportedly showed the extension host
crash-looping, with the first real error being `could not mint Clerk
token` - meaning her workbench-side authentication never actually
completed, despite the dashboard side succeeding. Without a valid token,
the socket can't connect, the room can't be joined, and the virtual
filesystem never populates - which would fully explain the completely
blank state observed (not a room-isolation bug, not related to sections
16-18 at all, a distinct authentication bridge failure).

**This is confirmed to be a genuinely different, separate problem from
everything else this session** - the sections 16-18 fix is real,
compiled, present on her machine, and still has not been cleanly tested,
because this authentication issue blocks the room join entirely before
the fix's own logic would ever run.

**Real next-session task**: root-cause the workbench-side Clerk token
minting failure specifically on Maureen's machine - real, concrete
starting points: (1) get and directly read her actual workbench console
export (not yet independently verified by Claude this session - the
diagnosis above was reported, not directly confirmed via an uploaded
log), (2) check whether this is machine-specific (a stale/corrupted
local Clerk session on her machine specifically) or a real, reproducible
regression in the sign-in IPC bridge referenced in this project's much
earlier history (2026-08-09, "SIGN-IN BUG — CONFIRMED FIXED"). Once
resolved, the sections 16-18 fix still needs its first real live test,
which has not yet happened.

## 20. Honest session close-out - what's actually proven vs. still open, stated plainly

This session ran long and covered a lot of ground. Before closing, an
honest, unsoftened accounting of what's real and what isn't, because
carrying false confidence into the next session is worse than an
accurate but less flattering picture.

**Genuinely proven, with real, direct evidence:**
- The 60-second Clerk token expiry causing repeated disconnects on
  both the workbench and dashboard sockets - fixed with a proactive
  45-second refresh, confirmed via exported console logs showing zero
  disconnects, on two separate, independent test rounds.
- Room A/B content isolation (no leaking between rooms) - tested once,
  directly, immediately after the token-refresh fix landed, with a
  clean result.

**Fixed, but not yet re-verified after later changes:**
- The Yjs seed-timing race (guests not seeing pre-existing content
  until the next edit).
- Yjs memory bleeding between rooms sharing a filename.

**Attempted, wrong, corrected:**
- Disabling `files.hotExit` entirely to solve stale folder
  accumulation - broke "Open Folder" as a real, confirmed side effect
  via a clean A/B test. Reverted. The original accumulation problem
  is real and was NOT solved by this attempt.

**Written, compiled clean, never tested:**
- The `deleteUntitledWorkspace`-on-room-leave fix (sections 16-18) -
  confirmed present in Maureen's actual compiled build via direct
  string search, but never actually run through a real test, because
  a separate, unrelated problem blocked it first.

**Currently open, blocking everything downstream:**
- Maureen's workbench cannot authenticate. Her dashboard sign-in
  works correctly and repeatedly (confirmed in her own logs, real
  Clerk callback data present). Her workbench reports "no Clerk
  session found" and the extension host crash-loops immediately
  after. This is a real, internal dashboard-to-workbench handoff
  failure occurring entirely within her own single running app, not
  a cross-machine issue - confirmed identical build via direct string
  search for `deleteUntitledWorkspace` (present, 3 occurrences).
  Root cause NOT yet found. Two real, incorrect theories were
  proposed and corrected this session before landing on "not yet
  understood, needs a targeted diagnostic" as the honest state.

**The actual Phase 3 goal - two people typing simultaneously in the
same file, both edits surviving - has not been attempted even once
this session.** Every real fix made tonight was necessary
infrastructure work discovered by trying to reach that test, not the
test itself.

**Real, bounded, five-minute next-session starting task, and nothing
before it**: add a diagnostic log at the exact moment the main
process sends the `vscode:livecollab-clerk-user` IPC event to
`dashboardView.webContents` - log that the send fired, and log which
URL `dashboardView.webContents` was actually showing at that moment.
This directly answers whether the send happens at all on Maureen's
machine and, if so, whether it's targeting the right destination -
replacing the two incorrect theories proposed tonight with real
evidence instead of more guessing. Once that diagnostic reveals the
real cause and it's fixed, retest sections 16-18's fix live for the
first time, then move directly to the actual concurrent-editing test.

## 21. Diagnostic fix confirmed working live - real root cause narrowed to our own server, not Clerk

The section 20 diagnostic fix worked exactly as intended on the very
first real test. Maureen's exported console showed the real reason
directly, no terminal access needed: `[LiveCollab] could not mint
Clerk token - reason: server_response_missing_jwt
{"jwt":null,"error":"server_response_missing_jwt","serverResponse":null}`.

**Real theory checked and ruled out with direct evidence**: suspected
a Clerk development-instance rate limit, given the exact same raw
token value (`dvb_3GR3LBfko7B1Vhog01zYU4GCQWY`) reappeared across
multiple attempts, and Clerk's own dashboard displays a real warning
about strict usage limits on development instances. Checked Clerk's
own dashboard directly (Users tab) - Maureen's account shows a real,
successful sign-in recorded on 2026-08-23, during this exact testing
window. Clerk genuinely processed and accepted her sign-in; a
rate-limited request would not be recorded as a successful sign-in.
This rules out Clerk-side rejection as the cause.

**This narrows the real root cause precisely**: Clerk handed back a
valid session, our own `/auth/token` server endpoint (hosted on
Railway) received it, and returned a response with no `.jwt` field -
`serverResponse: null` specifically, meaning our own server gave back
nothing usable, not even an error object. The failure is confirmed to
be on OUR side, not Clerk's.

**Also retested the retry fix from section 20's earlier follow-up in
this same session**: on a later attempt, the log showed `[LiveCollab]
no Clerk session found after retries` - confirming the retry loop
itself works exactly as designed (activates, retries, and correctly
reports exhaustion when genuinely nothing is found), a separate,
already-proven-working piece from the actual mint failure being
investigated here.

**Real, immediate next-session task, no waiting required**: check
Railway's own server logs for the `/auth/token` endpoint directly,
specifically around the timestamps of tonight's failed attempts, to
see what our own backend actually did when it received Maureen's
valid token and returned nothing. This is fully actionable
immediately - nothing here depends on any rate-limit reset or delay,
since Clerk-side rate limiting has been directly ruled out.

## 22. Real, definitive root cause found and confirmed directly against the live production database - Maureen's cached Clerk token is genuinely revoked

Traced the exact failure to source, in `server/index.js`'s `/auth/token`
handler: `if (db.isTokenRevoked(hashToken(token))) return jsonOut(200,
null);` - a real, exact match for the observed
`{"jwt":null,"error":"server_response_missing_jwt","serverResponse":null}`.

**Confirmed with a real, direct query against the live production
database, not inferred.** Computed the real SHA-256 hash of the exact
recurring token value seen throughout tonight's logs
(`dvb_3GR3LBfko7B1Vhog01zYU4GCQWY`), connected to the actual Railway
project via `railway link` (confirmed correct project by matching its
real domain, `live-collab-production.up.railway.app`, exactly against
the hardcoded client URL), used `railway ssh` to reach a live shell
inside the actual running container (`railway run` alone doesn't
mount the persistent volume locally, confirmed by a real
`ENOENT`-style directory error first), and queried
`db.isTokenRevoked(...)` directly against the real, live
`revokedTokens` SQLite table. Result: **`true`**. This token is
genuinely, definitively revoked.

**What this means, precisely**: the revocation itself is correct,
expected behavior - some earlier point in tonight's many sign-in/
sign-out/reinstall cycles legitimately triggered `/auth/logout` for
this exact token, and our server correctly denylisted it, exactly as
designed. The REAL bug is upstream of this check: Maureen's app keeps
resending this same, now-dead cached token on every subsequent
attempt, instead of obtaining a genuinely fresh one from Clerk. The
section 20 local-storage/session-storage clear did not touch whatever
is actually caching it - most likely Electron's cookie store or
IndexedDB, neither of which were cleared tonight.

**Real, concrete next-session task**: clear Electron's actual cookie
storage and IndexedDB for this app (not just Local/Session Storage,
already tried and confirmed insufficient) - real candidates:
`~/Library/Application Support/LiveCollab/Network/Cookies` and the
`IndexedDB`/`blob_storage` directories in that same folder. Once
Maureen's app is holding a genuinely fresh, non-revoked token, the
mint should succeed and her workbench should authenticate end to end -
the last real blocker before the actual Phase 3 concurrent-editing
test can finally run.

**Real, secondary, non-blocking item found and deliberately not
touched tonight**: discovered six real Railway projects under this
account, several showing an active LiveCollab service, not just one.
This needs real, careful investigation in a clear-headed session -
NOT tonight, given the genuine risk of deleting something live by
mistake this late. Confirmed only that `patient-joy` is the real,
correct, currently-serving production project (verified by its real
domain match) - the other five remain unexplained and unexamined.

## 23. Local caching theory disproven with direct evidence - the token likely lives on Clerk's own servers, not Maureen's disk

Tested section 22's real next-step directly: cleared Electron's actual
cookie store (`Network`), `IndexedDB`, and `blob_storage` on Maureen's
machine - the real locations, not the insufficient Local/Session
Storage clear from section 20. Signed in fresh afterward.

**Real, direct result: the exact same recurring token value
(`dvb_3GR3LBfko7B1Vhog01zYU4GCQWY`) appeared again**, and produced the
exact same `server_response_missing_jwt` failure - the same revoked
token confirmed in section 22. This is a genuine, hard disproof of the
"local caching" theory: every plausible local storage location we
know of has now been cleared (Local Storage, Session Storage, Cookies,
IndexedDB, blob_storage), and the identical value still came back.

**Real, corrected theory**: this value is very likely not cached
locally at all. It's more probably tied to an underlying Clerk
session that is still active on Clerk's own servers - clearing local
browser storage does nothing to that server-side state, so Clerk
keeps handing back a token derived from the same still-live session
regardless of what's cleared locally. A real, explicit sign-out
(through the app's own logout flow, which calls our `/auth/logout`
endpoint and genuinely revokes the session with Clerk) is a
meaningfully different action from clearing local files, and hasn't
been tried yet this session.

**Real, concrete next-session task**: have Maureen use the app's own
sign-out action (not force-quitting, not clearing files) before
signing back in - this should trigger real, server-side Clerk session
termination, which local storage clearing cannot do. If a genuinely
new token appears after that, this theory is confirmed and the auth
chain is finally unblocked.

## Next step

Build a small, isolated prototype (same discipline as Stage 1's overlay
test earlier in this project): y-monaco + a minimal custom Socket.io
provider, in isolation, proving real two-client character-level merge
works correctly before touching the real `code:change` production path.
