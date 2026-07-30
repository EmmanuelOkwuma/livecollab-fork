# LiveCollab — Pre-Launch Roadmap

Single source of truth for what's left before closed alpha. Every working session
should end by updating this file (mark items done, add anything new discovered)
and committing + pushing it alongside code changes. If you're asking "where are
we," the answer lives here, not in chat history.

Last updated: 2026-07-20 — after #2 (logout migration) shipped and verified live.

---

## Status Snapshot

**Verified done tonight/recently (root-cause fixes, not patches):**
- #12 — connection resilience: sockets mint a fresh token on every reconnect
  instead of replaying a dead 60s Clerk JWT. Verified with a real WiFi-cut test
  across two networks.
- #19 — socket re-joins its room on reconnect (was only joining once, on first
  connect). Verified: edit made after reconnect crossed machines.
- #1 — onboarding + display name persist. Server resolves user from token
  (not client-supplied userId), writes to Clerk's /metadata endpoint. Verified
  via curl against a live account: {"onboarded":true,"displayName":"MO_"}.
- #2 — logout migrated off the dead CLERK_SECRET_KEY path. Server resolves the
  actual session from the token (not a client-supplied sessionId — closes a
  spoofing hole). Verified live: console showed logout: true, confirmed by
  Clerk, hash 54027041484 on origin/overlay-shell.
- Full auth migration (check-session, mint-token, fresh-sign-in) off the
  packaged app (which has no Clerk secret) onto server-side endpoints.
- Identity race fix — event-driven identity-ready replacing a dead 20s poll.
- Invite input fix — six-box code entry replaced with one field, works.
- Two-machine sync — verified across two separate networks, not just two
  windows on one laptop.

**Interim mitigation, NOT the root fix (labeled honestly per the new standard):**
- #4 (partial) — routing now requires a definitive check-session answer before
  showing onboarding, so a returning user isn't bounced through onboarding
  during a room-open reload. This does NOT stop the reload itself. The real
  fix is Phase 2 (the overlay) below.

---

## PHASE 0 — Instrumentation (do first, unblocks everything after)

Nothing else is safe to test at real-user scale without this. Every bug found
so far was found by manually watching a laptop with DevTools open. That does
not scale to closed alpha.

- [ ] Uncaught-error / crash reporting: app POSTs uncaught errors + a rolling
      buffer of recent console/sync events to the server, logged somewhere
      Manny can check without standing next to the machine.
- [ ] Minimum viable version is fine to start: a global error handler that
      fires on uncaught exceptions and unhandled promise rejections, POSTs
      {message, stack, recentLogBuffer, userId, roomId, timestamp} to a new
      /telemetry/error server endpoint, server just logs it (file or DB row)
      for now — no dashboard needed yet.

## PHASE 1 — Diagnose before building (cheap, decides Phase 2's order)

- [ ] #3 corruption timing check — does the file corruption (VS Code stat
      metadata written into file bodies, stray duplicate content blocks)
      correlate with room transitions/reloads, or does it happen even sitting
      in one file with no navigation?
      - If it correlates with reloads → shares a root cause with #4, the
        overlay fix (Phase 2) likely fixes both. Overlay work jumps in priority.
      - If it happens independently → #3 needs its own fast, separate
        root-cause fix before/alongside Phase 2, because it's active data loss.
- [ ] #7 phantom rooms — is delete failing to reach the server, or is the
      dashboard rendering stale/cached reads? Observed: room count roughly
      stable (38-39) across sessions, not climbing — a data point suggesting
      deletes are landing and this is a stale-read/render bug, not a broken
      delete. Confirm with a direct check of what the server's room list
      actually contains vs. what the dashboard renders.

## PHASE 2 — The architectural root (the big one)

Root cause, confirmed: opening a room or returning to the dashboard is a full
separate-page loadURL() navigation — the entire renderer tears down and
rebuilds from zero every time. Identity, room list, folder names, and room
name are all re-derived from scratch on every transition instead of persisting.
This is very likely the shared root of #4, #5, #7, #14, #15, #20, the missing
status-bar room name, and plausibly #3.

- [ ] Research the correct pattern first: single-page-app-inside-a-native-shell
      — one window loaded once, views show/hide, state persists in memory.
      (Same pattern Slack/Discord/VS Code itself use.)
- [ ] Write a short state-ownership design doc BEFORE building: what does a
      room own independent of any connected client? What lives on the server
      as authoritative vs. what's derived client-side on load?
- [ ] Build stages 2-4 of the overlay (stage 1 — an empty mounting shell —
      already exists and is confirmed working in logs: "dashboard overlay
      mounted"). Make dashboard + room a persistent layer, kill the full
      page reload.
- [ ] Re-test the interim #4 routing patch's necessity once the overlay lands
      — it may become dead code if the reload it was mitigating no longer
      happens.

## PHASE 3 — Data integrity

- [ ] #3 file corruption — if not already resolved as a side effect of Phase 2,
      root-cause and fix independently. This cannot ship to real users unfixed.
- [ ] Yjs/CRDT for concurrent edits. Currently last-write-wins — two people
      editing the same region silently clobber each other.
      - [ ] Decide on paper first: does Yjs replace the custom Socket.io sync
            layer entirely, or run alongside it? (Biggest unknown on the
            whole roadmap — this decision shapes the entire implementation.)
      - [ ] Decide the persistence source of truth: when does Yjs's in-memory
            CRDT state get written to the database, and what's authoritative
            if the server restarts — Yjs's live state or the last DB write?
      - [ ] Then build.

## PHASE 4 — Infrastructure

- [ ] SQLite → Postgres migration.
- [ ] #9 — remove the committed livecollab.sqlite file from the server git
      repo (it's real production data sitting in version control), add to
      .gitignore.
- [ ] Rate limiting — AI requests and socket connections. Currently unbuilt
      anywhere. Even a handful of aggressive users could run costs or
      connection counts into a bad place with zero protection.
- [ ] Deletion system — rooms/accounts/files/invites/memberships, soft-delete
      + grace period. Design for the sharp edges up front:
      - [ ] Concurrent deletion (two people delete the same room at once, or
            one deletes it while another is inside it).
      - [ ] Owner-account-deleted state (currently undefined — have
            ownership-transfer and kick, don't have "the owner is gone").

## PHASE 5 — Features

- [ ] In-room text chat.
- [ ] AI review box (the wedge feature — intentionally built last, after
      rooms/sync are trustworthy).
      - [ ] Design the concurrency model on paper FIRST, before building:
            if N members in a shared room use the AI simultaneously in
            different files, does it serve them in parallel or queue them
            one at a time? How does each member's individual subscription/
            usage tier gate their access within the same shared room?
            This decision affects pricing model and infra cost curve —
            it is a product decision, not an implementation detail.

## PHASE 6 — Cleanup pass (batched at the end, not one-by-one)

- [ ] #6 — dashboard shows the wrong (workbench) menu bar.
- [ ] #16 — cursor flickers between arrow/pointer on buttons, never settles.
- [ ] #22 — account panel shows display name where full name should show
      (full name is never actually erased, this is a render-order fix).
- [ ] #13/#18 — member count divergence between clients. Self-corrects on
      reconnect currently; underlying "doesn't reliably update on join/leave"
      bug is unfixed.
- [ ] #17 — app freeze / "??" avatar initials / won't quit. Untested since
      #12/#19 landed — unknown if already resolved as a side effect.
- [ ] #21 — ENOPRO: No file system provider found for livecollab:// thrown
      on reconnect/room re-init.

---

## The Daily Rule

Every working session ends with:
1. A commit and push (confirm with git log origin/<branch> --oneline -1
   matching local HEAD — committed locally is not the same as pushed).
2. An update to this file — check off what moved, add anything newly
   discovered. This file is the plan. If it's not written here, it didn't
   happen and will get lost the way things were getting lost before it existed.
