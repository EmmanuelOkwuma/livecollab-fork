# LiveCollab

**Real-time collaborative coding, built into the editor you already use.**

LiveCollab is a collaborative IDE where developers write, review, and build code together, in the same codebase, in real time, with live cursors, presence, and shared rooms. It is built on the open-source core of VS Code, so it keeps the editor, the interface, and the full extension ecosystem developers already know, and makes real-time collaboration a native, first-class part of it.

---

## Why LiveCollab

### The problem

Software is built by teams, but code editors were built for one person at a time. Working together means constantly switching between the editor, chat, screen-share, and version control, and that friction is measurable:

- Around **47 million developers** worldwide, and roughly **80% collaborate** with others.
- Developers lose **nearly a full day every week** to context-switching between disconnected tools.
- The average developer juggles about **14 tools** to get work done, and teams using more than 10 apps report communication problems **54% of the time**, versus 34% for teams under 5 apps.
- As AI writes more code (around **55% faster**), a new friction appears: **53% of developers** say reviewing AI-generated code is a top pain point, and reviewing code together is exactly what today's editors are not built for.

### The landscape

Others are pushing on this, which means the problem is real. VS Code's **Live Share** does it as an extension you bolt on. **Zed** does it natively, but makes you leave the VS Code ecosystem. **LiveCollab's bet is different: native collaboration, without leaving the full VS Code world developers already know.** Most developers will not switch editors. LiveCollab meets them where they already are.

### Our solution

LiveCollab is the full editor developers already rely on, with editing, extensions, version control, and terminal, now with real-time co-editing, in-room chat and voice, shared presence, and a native AI that has full context of your entire codebase and the whole room and can carry out tasks for the team on command, all in one place instead of scattered across a dozen tools.

> **LiveCollab is built to eliminate up to 80% of collaborative-coding friction, and that's just the foundation.**

The entry point is students and learners, people collaborating on code for the first time. The vision expands outward from there: remote teams, pair programming, code reviews, hackathons, bootcamps, and classrooms. Anywhere people build software together, from a startup team shipping through an accelerator to two students on their first project.

---

## What it does

**Working now:**
- A full desktop IDE built on the VS Code (Code - OSS) core
- User authentication
- A dashboard of collaborative rooms: create, join by invite code, search, pin, and manage rooms
- Room system: members panel, roles (owner, editor, viewer), presence, room IDs, and invites
- Real-time editing infrastructure with shared cursors and live code sync between members
- A persistent backend hosting live collaboration sessions

**In progress:**
- Verified multi-user real-time sync across machines
- In-room chat (text and voice)
- Native AI with full codebase and room context
- Shared terminals and environment sync
- Cross-platform distribution (macOS, Windows, Linux)

Actively developed and built in public. Early and evolving quickly.

---

## How it is built

LiveCollab is built on the open-source core of VS Code (Code - OSS), running as an Electron desktop app. The collaboration layer (rooms, members, presence, real-time sync, and the backend) is original work built natively into the editor, not added as an extension. Code runs locally on each user's machine, and the server relays collaboration events between members rather than executing code, which keeps it lightweight to run.

---

## Status

Pre-launch and under active development. The core editor and room infrastructure are built. Real-time collaboration is being hardened and verified ahead of a first public release.

---

## About

Built by [Emmanuel Okwuma](https://github.com/EmmanuelOkwuma), a Computer Science student, as a solo founder building in public.

Built on the open-source core of VS Code (Code - OSS). LiveCollab is an independent project, not affiliated with or endorsed by Microsoft. Licensed under the MIT License.
