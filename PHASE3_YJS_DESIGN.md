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

## Next step

Build a small, isolated prototype (same discipline as Stage 1's overlay
test earlier in this project): y-monaco + a minimal custom Socket.io
provider, in isolation, proving real two-client character-level merge
works correctly before touching the real `code:change` production path.
